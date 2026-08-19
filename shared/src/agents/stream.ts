// THE AGENT STREAM, IN ONE PLACE.
//
// Claude Code emits newline-delimited JSON when run with --output-format stream-json. Two consumers
// now read it: the web app's SSE route, and the desktop app, which spawns the agent itself and
// renders the same transcript locally. Both need the same two pure transformations — CLI line →
// frames, frames → transcript entries — and a second copy of either would drift precisely where it
// hurts, since the reasoning below is not obvious from the shapes.
//
// Pure and node-free, so it ships to a browser, an Electron renderer, or a test unchanged.

/** A frame is what a consumer receives: one semantic event, already stripped of CLI detail. */
export type Frame =
  | { kind: "session"; sessionId: string; model?: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "tool_result"; ok: boolean; preview: string }
  | { kind: "usage"; contextTokens: number }
  | { kind: "result"; text: string; isError: boolean; costUsd?: number; turns?: number; contextTokens?: number }
  | { kind: "note"; text: string; error?: boolean };

/** Cap on forwarded tool-result text, so one big listApplications doesn't flood a transcript. */
export const PREVIEW = 2000;

/**
 * Tokens fed to the model on one turn.
 *
 * input + cache_read + cache_creation. cache_creation is usually the BULK of the context and
 * dropping it makes a heavily-cached run look nearly empty — the meter reads a few thousand tokens
 * on a session that is actually most of the way through its window.
 */
export function contextOf(usage: Record<string, unknown> | undefined): number {
  if (!usage) return 0;
  const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  return n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
}

/** Flatten a tool result to a short single-line preview. */
export function previewOf(content: unknown): string {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
      .filter(Boolean)
      .join("\n");
  } else if (content != null) {
    text = JSON.stringify(content);
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text;
}

/** Parsing state threaded across lines — the most recent assistant usage, for the context figure. */
export type TranslateState = { lastAssistantUsage?: Record<string, unknown> };

/**
 * One CLI stream-json line → zero or more frames.
 *
 * Returns an array rather than taking a callback so it is testable as a function of its input, and
 * so a consumer that batches (the desktop renderer) does not have to invert control.
 *
 * Non-JSON lines are ignored rather than reported: the CLI interleaves diagnostics with protocol,
 * and a transcript full of parse errors is worse than one missing a line of noise.
 */
export function translate(line: string, state: TranslateState): Frame[] {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  const t = msg.type;
  const out: Frame[] = [];

  if (t === "system" && msg.subtype === "init") {
    if (typeof msg.session_id === "string") {
      out.push({
        kind: "session",
        sessionId: msg.session_id,
        model: typeof msg.model === "string" ? msg.model : undefined,
      });
    }
    return out;
  }

  if (t === "assistant") {
    const message = msg.message as { content?: unknown[]; usage?: Record<string, unknown> } | undefined;
    if (message?.usage) {
      state.lastAssistantUsage = message.usage; // latest turn wins → final context
      // Emitted LIVE per turn, not only bundled into the terminal `result`. A long run can be cut
      // off — auto-stop, stall, Stop, an API blip — before `result` ever arrives, which would leave
      // the token meter blank on a session that burned a whole context window.
      const ctx = contextOf(message.usage);
      if (ctx) out.push({ kind: "usage", contextTokens: ctx });
    }
    for (const block of (message?.content ?? []) as Record<string, unknown>[]) {
      if (block.type === "text" && typeof block.text === "string") out.push({ kind: "text", text: block.text });
      else if (block.type === "tool_use") out.push({ kind: "tool", name: String(block.name), input: block.input });
    }
    return out;
  }

  if (t === "user") {
    for (const block of ((msg.message as { content?: unknown[] } | undefined)?.content ?? []) as Record<
      string,
      unknown
    >[]) {
      if (block.type === "tool_result") {
        out.push({ kind: "tool_result", ok: !block.is_error, preview: previewOf(block.content) });
      }
    }
    return out;
  }

  if (t === "result") {
    // Context pressure is the LAST turn's context, from the final assistant usage — NOT result.usage,
    // which is the session's cumulative total across every turn. That figure climbs with turn count
    // and can reach millions, so it never reflects how full the window actually is.
    out.push({
      kind: "result",
      text: typeof msg.result === "string" ? msg.result : "",
      isError: !!msg.is_error,
      costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
      turns: typeof msg.num_turns === "number" ? msg.num_turns : undefined,
      contextTokens: contextOf(state.lastAssistantUsage) || undefined,
    });
  }

  return out;
}

// ─── Frames → transcript ─────────────────────────────────────────────────────

export type Entry =
  | { id: number; role: "assistant"; text: string; at?: string }
  | { id: number; role: "tool"; name: string; input: unknown; result?: { ok: boolean; preview: string } }
  | { id: number; role: "note"; text: string; error?: boolean };

export type Transcript = {
  entries: Entry[];
  sessionId: string | null;
  model?: string;
  contextTokens?: number;
  costUsd?: number;
  turns?: number;
};

export const emptyTranscript = (): Transcript => ({ entries: [], sessionId: null });

/**
 * Fold one frame into a transcript.
 *
 * Two behaviours carry the readability of the whole view:
 *
 * Consecutive `text` frames MERGE into the last assistant entry. The CLI emits prose in chunks, and
 * appending each as its own entry turns one paragraph into a column of fragments.
 *
 * A `tool_result` attaches to the most recent tool entry that lacks one, searching BACKWARDS.
 * Parallel tool calls resolve out of order, so pairing by position rather than arrival is what keeps
 * a result under the call it belongs to.
 */
export function reduceFrame(t: Transcript, frame: Frame, nextId: () => number, now = () => new Date().toISOString()): Transcript {
  switch (frame.kind) {
    case "session":
      return { ...t, sessionId: frame.sessionId ?? t.sessionId, model: frame.model ?? t.model };

    case "text": {
      const last = t.entries[t.entries.length - 1];
      if (last?.role === "assistant") {
        return { ...t, entries: [...t.entries.slice(0, -1), { ...last, text: last.text + frame.text }] };
      }
      return { ...t, entries: [...t.entries, { id: nextId(), role: "assistant", text: frame.text, at: now() }] };
    }

    case "tool":
      return { ...t, entries: [...t.entries, { id: nextId(), role: "tool", name: frame.name, input: frame.input }] };

    case "tool_result": {
      const entries = [...t.entries];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.role === "tool" && !e.result) {
          entries[i] = { ...e, result: { ok: frame.ok, preview: frame.preview } };
          break;
        }
      }
      return { ...t, entries };
    }

    case "usage":
      return { ...t, contextTokens: frame.contextTokens };

    case "result": {
      const next: Transcript = {
        ...t,
        contextTokens: frame.contextTokens ?? t.contextTokens,
        costUsd: frame.costUsd ?? t.costUsd,
        turns: frame.turns ?? t.turns,
      };
      if (frame.isError) {
        next.entries = [
          ...next.entries,
          { id: nextId(), role: "note", text: frame.text || "the agent reported an error", error: true },
        ];
      }
      return next;
    }

    case "note":
      return { ...t, entries: [...t.entries, { id: nextId(), role: "note", text: frame.text, error: frame.error }] };
  }
}
