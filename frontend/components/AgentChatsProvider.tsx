"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Holds every live agent conversation ABOVE the page tree (mounted in the root layout), so chats —
// and any in-flight stream — survive navigating between pages. Without this, the chat lived inside
// the Agents page and got torn down (losing the transcript and killing the run) on every navigation.
// Transcripts + session ids also persist to localStorage so they survive a full reload.

export type Entry =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; at?: string } // at = ISO time the message started
  | { id: number; role: "tool"; name: string; input: unknown; result?: { ok: boolean; preview: string } }
  | { id: number; role: "note"; text: string; error?: boolean };

export type ChatState = {
  entries: Entry[];
  sessionId: string | null;
  running: boolean;
  // Session context pressure, from the last completed run's usage. contextTokens ≈ input+cache_read
  // on the final turn = how big this agent's resumed context has grown; model sets the window.
  contextTokens?: number;
  model?: string;
  costUsd?: number;
  // Per-agent auto-drain switch. undefined/true = this agent auto-works its queue; false = PAUSED —
  // set when you manually Stop it, so a stopped agent stays stopped even with items queued. Re-armed
  // by "Work queue" (a bare drain) or the header toggle. Read by AutoWorkController.
  autoDrain?: boolean;
};
const EMPTY: ChatState = { entries: [], sessionId: null, running: false };

const ENTRIES_PREFIX = "landed.agent.entries.";
const SESSION_PREFIX = "landed.agent.session.";
const META_PREFIX = "landed.agent.meta."; // { contextTokens, model, costUsd, autoDrain } — meter + auto-drain

// Rehydrate all persisted chats from localStorage at mount (keys written below).
function loadInitial(): Record<string, ChatState> {
  if (typeof window === "undefined") return {};
  const out: Record<string, ChatState> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(ENTRIES_PREFIX)) continue;
    const type = k.slice(ENTRIES_PREFIX.length);
    let entries: Entry[] = [];
    try { const a = JSON.parse(localStorage.getItem(k) || "[]"); if (Array.isArray(a)) entries = a; } catch { /* ignore */ }
    let meta: Partial<ChatState> = {};
    try { meta = JSON.parse(localStorage.getItem(META_PREFIX + type) || "{}"); } catch { /* ignore */ }
    out[type] = { entries, sessionId: localStorage.getItem(SESSION_PREFIX + type), running: false, contextTokens: meta.contextTokens, model: meta.model, costUsd: meta.costUsd, autoDrain: meta.autoDrain };
  }
  return out;
}

type Ctx = {
  get: (type: string) => ChatState;
  lastEventAt: (type: string) => number | undefined; // ms epoch of this agent's last stream event
  open: string | null;
  setOpen: (t: string | null) => void;
  start: (type: string, message?: string) => void;
  stop: (type: string) => void;
  clear: (type: string) => void;
  setAutoDrain: (type: string, on: boolean) => void; // arm/pause this agent's auto-drain
};

const AgentChatsContext = createContext<Ctx | null>(null);

export function useAgentChats(): Ctx {
  const c = useContext(AgentChatsContext);
  if (!c) throw new Error("useAgentChats must be used within AgentChatsProvider");
  return c;
}

export default function AgentChatsProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = useState<Record<string, ChatState>>(loadInitial);
  const [open, setOpen] = useState<string | null>(null);
  const chatsRef = useRef(chats);
  const aborts = useRef<Record<string, AbortController | null>>({});
  const lastEventRef = useRef<Record<string, number>>({}); // last stream-event time per agent (stall detection)
  // One monotonic id source, seeded past any restored history so React keys never collide.
  const idRef = useRef(Object.values(chats).flatMap((c) => c.entries).reduce((m, e) => Math.max(m, e.id), 0));
  const nextId = () => ++idRef.current;

  useEffect(() => { chatsRef.current = chats; }, [chats]);
  // Debounced persistence: coalesce the burst of stream updates into one write per idle tick.
  useEffect(() => {
    const id = setTimeout(() => {
      for (const [type, c] of Object.entries(chats)) {
        try {
          localStorage.setItem(ENTRIES_PREFIX + type, JSON.stringify(c.entries.slice(-400)));
          if (c.sessionId) localStorage.setItem(SESSION_PREFIX + type, c.sessionId);
          localStorage.setItem(META_PREFIX + type, JSON.stringify({ contextTokens: c.contextTokens, model: c.model, costUsd: c.costUsd, autoDrain: c.autoDrain }));
        } catch { /* quota — skip */ }
      }
    }, 400);
    return () => clearTimeout(id);
  }, [chats]);

  const patch = useCallback((type: string, fn: (c: ChatState) => ChatState) => {
    setChats((prev) => ({ ...prev, [type]: fn(prev[type] ?? EMPTY) }));
  }, []);

  const pushNote = useCallback((type: string, text: string, error = false) => {
    patch(type, (c) => ({ ...c, entries: [...c.entries, { id: nextId(), role: "note", text, error }] }));
  }, [patch]);

  // One SSE frame → transcript update for `type`.
  const handleEvent = useCallback((type: string, e: { kind: string; [k: string]: unknown }) => {
    lastEventRef.current[type] = Date.now(); // any frame = the run is alive (resets the stall clock)
    switch (e.kind) {
      case "session":
        patch(type, (c) => ({
          ...c,
          sessionId: typeof e.sessionId === "string" ? (e.sessionId as string) : c.sessionId,
          model: typeof e.model === "string" ? (e.model as string) : c.model,
        }));
        break;
      case "text":
        patch(type, (c) => {
          const last = c.entries[c.entries.length - 1];
          if (last?.role === "assistant") return { ...c, entries: [...c.entries.slice(0, -1), { ...last, text: last.text + String(e.text) }] };
          return { ...c, entries: [...c.entries, { id: nextId(), role: "assistant", text: String(e.text), at: new Date().toISOString() }] };
        });
        break;
      case "tool":
        patch(type, (c) => ({ ...c, entries: [...c.entries, { id: nextId(), role: "tool", name: String(e.name), input: e.input }] }));
        break;
      case "tool_result":
        patch(type, (c) => {
          const es = [...c.entries];
          for (let i = es.length - 1; i >= 0; i--) {
            const en = es[i];
            if (en.role === "tool" && !en.result) { es[i] = { ...en, result: { ok: !!e.ok, preview: String(e.preview ?? "") } }; break; }
          }
          return { ...c, entries: es };
        });
        break;
      case "usage":
        // Live per-turn context figure (see the live route) — keeps the token meter current even for
        // a long run that never reaches a terminal `result`.
        patch(type, (c) => ({
          ...c,
          contextTokens: typeof e.contextTokens === "number" ? (e.contextTokens as number) : c.contextTokens,
        }));
        break;
      case "result":
        patch(type, (c) => ({
          ...c,
          contextTokens: typeof e.contextTokens === "number" ? (e.contextTokens as number) : c.contextTokens,
          costUsd: typeof e.costUsd === "number" ? (e.costUsd as number) : c.costUsd,
        }));
        if (e.isError) pushNote(type, typeof e.text === "string" && e.text ? e.text : "the agent reported an error", true);
        break;
      case "error": {
        const msg = String(e.message ?? "error");
        // A resume that references a session Claude no longer has → drop the stale id so the next run
        // (or a steer) starts fresh instead of failing the same way.
        if (/no conversation found/i.test(msg)) {
          patch(type, (c) => ({ ...c, sessionId: null }));
          try { localStorage.removeItem(SESSION_PREFIX + type); } catch { /* ignore */ }
          pushNote(type, "the previous session expired — cleared it. Click “Work queue” to start fresh.", true);
        } else {
          pushNote(type, msg, true);
        }
        break;
      }
      case "note":
        pushNote(type, String(e.text ?? ""));
        break;
      case "exit":
        if (e.code && e.code !== 0) pushNote(type, `agent exited (code ${e.code})`, true);
        break;
    }
  }, [patch, pushNote]);

  const start = useCallback((type: string, message?: string) => {
    // Don't double-spawn a genuinely-running agent (two rapid clicks — e.g. the floating button + the
    // Agents page). BUT a leftover AbortController with no live run (a wedged previous start) must NOT
    // block a fresh start — that's the "won't start" bug — so clear it and proceed instead of no-op'ing.
    if (chatsRef.current[type]?.running) return;
    if (aborts.current[type]) { try { aborts.current[type]!.abort(); } catch { /* already done */ } aborts.current[type] = null; }
    const ac = new AbortController();
    aborts.current[type] = ac;
    lastEventRef.current[type] = Date.now(); // start the stall clock at launch
    // A bare "Work queue" run is a stateless drain (its state lives in the DB, reached via MCP), so it
    // starts a FRESH session — that keeps context from bloating across runs. A typed message resumes
    // the conversation, where continuity actually matters. On a fresh drain, drop the old session and
    // reset the context meter now, so the reset is visible (the server mints + returns a new id).
    const freshDrain = !message?.trim();
    patch(type, (c) => {
      const entries = [...c.entries];
      if (freshDrain && c.sessionId) entries.push({ id: nextId(), role: "note", text: "↻ fresh session — a drain doesn't carry the previous context" });
      if (message) entries.push({ id: nextId(), role: "user", text: message });
      // A bare "Work queue" drain re-arms auto-drain (this IS the "click Work queue to turn it back
      // on" gesture). A typed steer leaves the paused/armed state as-is.
      return { ...c, running: true, entries, ...(freshDrain ? { sessionId: null, contextTokens: undefined, autoDrain: true } : {}) };
    });
    // One connection to the run: consume the SSE stream until it ends. Returns whether the server
    // closed it cleanly (an `exit` frame) or the stream just dropped — the run is DECOUPLED from this
    // request (see the route), so a drop usually means the dev server recompiled, not that the agent
    // stopped. `gotData` lets the caller reset its retry budget when a reconnect made real progress.
    const runOnce = async (payload: Record<string, unknown>): Promise<{ ended: boolean; gotData: boolean }> => {
      const res = await fetch("/api/agents/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      if (res.status === 204) return { ended: true, gotData: false }; // attach: the run already finished
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        pushNote(type, err.error || `failed to start (${res.status})`, true);
        return { ended: true, gotData: false };
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let ended = false;
      let gotData = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const ev = JSON.parse(dataLine.slice(5).trim());
            gotData = true;
            if (ev.kind === "exit") ended = true; // the server closed the stream on purpose (run done)
            handleEvent(type, ev);
          } catch { /* skip malformed */ }
        }
      }
      return { ended, gotData };
    };

    (async () => {
      try {
        // Resume the conversation ONLY when steering (a typed message). A bare "Work queue" drain
        // starts a FRESH session — otherwise it tries to resume a stored sessionId that may no longer
        // exist on Claude's side (after a restart), which fails with "No conversation found" and the
        // agent can't start at all. (The server mints + returns a new id, which we then store.)
        let payload: Record<string, unknown> = { type, message, sessionId: message ? (chatsRef.current[type]?.sessionId ?? undefined) : undefined };
        let retries = 0;
        for (;;) {
          const { ended, gotData } = await runOnce(payload);
          if (ended || ac.signal.aborted) break;
          // The stream dropped without an `exit` (dev-server recompile cut it). The detached run
          // survives — reconnect and keep watching it. `attach` NEVER respawns: if the run has since
          // finished, the server answers 204 and we stop.
          if (gotData) retries = 0;
          if (++retries > 60) break; // safety bound against a reload storm
          await new Promise((r) => setTimeout(r, 400));
          if (ac.signal.aborted) break;
          payload = { type, action: "attach" };
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") pushNote(type, String((err as Error).message ?? err), true);
      } finally {
        patch(type, (c) => ({ ...c, running: false }));
        aborts.current[type] = null;
      }
    })();
  }, [patch, pushNote, handleEvent]);

  // Abort the stream AND force `running` false + clear the controller immediately — don't rely solely
  // on the fetch's `finally` (a wedged/already-dead stream might never reach it, leaving Stop stuck and
  // the agent un-restartable). The fetch's own finally is idempotent with this.
  const stop = useCallback((type: string) => {
    aborts.current[type]?.abort();
    aborts.current[type] = null;
    // Aborting the fetch only stops US watching — the run is detached, so it keeps going. Tell the
    // server to actually kill it (fire-and-forget).
    fetch("/api/agents/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, action: "stop" }) }).catch(() => {});
    // Manual Stop = pause auto-drain: a stopped agent stays stopped even with items queued, until you
    // re-arm it with "Work queue" or the header toggle.
    patch(type, (c) => ({ ...c, running: false, autoDrain: false }));
  }, [patch]);

  const setAutoDrain = useCallback((type: string, on: boolean) => {
    patch(type, (c) => ({ ...c, autoDrain: on }));
  }, [patch]);

  const clear = useCallback((type: string) => {
    aborts.current[type]?.abort();
    aborts.current[type] = null;
    // Eraser = wipe this agent: kill any live run AND delete its on-disk journal, on top of the
    // local transcript + session id.
    fetch("/api/agents/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, action: "clear" }) }).catch(() => {});
    setChats((prev) => { const n = { ...prev }; delete n[type]; return n; });
    try { localStorage.removeItem(ENTRIES_PREFIX + type); localStorage.removeItem(SESSION_PREFIX + type); } catch { /* ignore */ }
  }, []);

  const get = useCallback((type: string) => chats[type] ?? EMPTY, [chats]);
  const lastEventAt = useCallback((type: string) => lastEventRef.current[type], []);

  return (
    <AgentChatsContext.Provider value={{ get, lastEventAt, open, setOpen, start, stop, clear, setAutoDrain }}>
      {children}
    </AgentChatsContext.Provider>
  );
}
