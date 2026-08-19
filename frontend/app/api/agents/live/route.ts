import fs from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { jobDef } from "@landed/backend/jobs/registry";
import { CLAUDE_BIN, mcpConfigPath, claudeEnv, baseArgs } from "@landed/backend/agents/claude-code";
import { drainPrompt } from "@landed/shared/agents/personas";
import { translate, type TranslateState } from "@landed/shared/agents/stream";
import { runPaths, ensureRunDir, splitFrames, isTerminalLine, readLivePid } from "@landed/backend/agents/run-log";
import { REPO_ROOT } from "@landed/backend/paths";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // a full queue drain + tool calls can run for minutes

// POST /api/agents/live  body: { type, message?, sessionId?, action? }
//
// Launch (or re-attach to) a Claude Code agent scoped to one job type and STREAM everything it does
// back to the browser as Server-Sent Events.
//
// The run is DECOUPLED from this request: the `claude` child is spawned *detached*, with its stdout
// redirected straight to a per-type log file (see backend/src/agents/run-log.ts). This request only *tails*
// that file. So when the always-on `next dev` server recompiles — which happens every time code is
// edited (e.g. by Claude Code) and drops the SSE connection, sometimes restarting the node process —
// the agent KEEPS RUNNING and finishes its work. Aborting this request no longer kills the agent;
// only an explicit `stop`/`clear` action does (it kills the pid recorded on disk).
//
// Actions (body.action):
//   (none)   — spawn a fresh run, OR attach to one already live for this type (self-heal after a drop)
//   "attach" — attach ONLY; if nothing is live, return 204 (used by the client to reconnect a dropped
//              stream without ever respawning a run that already finished)
//   "stop"   — kill the live run for this type
//   "clear"  — kill it and delete its journal files (the eraser button)
//
// Emitted SSE frames (one JSON object per `data:` line):
//   { kind: "session", sessionId, model? }                 — resume handle (first thing out, fresh runs)
//   { kind: "note", text }                                 — a status line (e.g. reconnected)
//   { kind: "text", text }                                 — a chunk of assistant prose
//   { kind: "tool", name, input }                          — an MCP/native tool call
//   { kind: "tool_result", ok, preview }                   — that tool's result (truncated)
//   { kind: "usage", contextTokens }                       — live per-turn context (before `result`)
//   { kind: "result", text, isError, costUsd, turns }      — the turn finished
//   { kind: "error", message }  |  { kind: "exit", code }  — failure / stream end

const POLL_MS = 250; // how often the tailer re-reads the growing log file
const IDLE_MS = 300_000; // kill a run whose log hasn't grown for 5 min (stalled tool/model) while watched

export async function POST(request: Request) {
  let body: { type?: string; message?: string; sessionId?: string; action?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }

  const type = body.type;
  if (!type || !jobDef(type)) return Response.json({ error: `unknown or missing type: ${type}` }, { status: 400 });
  const paths = runPaths(type);

  // Control actions kill / wipe the detached run and return immediately (no stream).
  if (body.action === "stop" || body.action === "clear") {
    const pid = readLivePid(type);
    if (pid) { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
    try { fs.rmSync(paths.pid, { force: true }); } catch { /* ignore */ }
    if (body.action === "clear") {
      try { fs.rmSync(paths.log, { force: true }); } catch { /* ignore */ }
      try { fs.rmSync(paths.err, { force: true }); } catch { /* ignore */ }
    }
    return Response.json({ ok: true, killed: !!pid });
  }

  const livePid = readLivePid(type);

  // Attach-only reconnect: if the run already ended, tell the client so it stops retrying.
  if (body.action === "attach" && !livePid) return new Response(null, { status: 204 });

  const attaching = !!livePid; // a run is already going → watch it, don't spawn a second one
  const sid = body.sessionId || randomUUID();

  if (!attaching) {
    // Fresh launch. Truncate the journal, then spawn claude DETACHED with stdout→log, stderr→err so
    // the child owns the files and survives this request (and the whole dev server) being torn down.
    ensureRunDir();
    const prompt = body.message?.trim() || drainPrompt(type);
    const args = [
      "-p", prompt,
      ...(body.sessionId ? ["-r", body.sessionId] : ["--session-id", sid]),
      "--output-format", "stream-json",
      "--verbose", // required by the CLI for stream-json in print (-p) mode
      ...baseArgs(mcpConfigPath()),
    ];
    const logFd = fs.openSync(paths.log, "w");
    const errFd = fs.openSync(paths.err, "w");
    let child;
    try {
      child = spawn(CLAUDE_BIN, args, {
        cwd: REPO_ROOT,
        env: claudeEnv(),
        detached: true,
        stdio: ["ignore", logFd, errFd],
      });
    } finally {
      fs.closeSync(logFd);
      fs.closeSync(errFd);
    }
    // Record the pid so Stop (and the stale-run check) can find the child after a recompile, then
    // let it outlive us.
    if (child.pid) fs.writeFileSync(paths.pid, String(child.pid));
    child.unref();
    // If the binary can't launch, no `result` line will ever appear — write a synthetic terminal
    // frame so the tailer (below) closes instead of hanging until the idle timeout.
    child.on("error", (e) => {
      try { fs.appendFileSync(paths.log, JSON.stringify({ type: "result", is_error: true, result: `failed to launch claude: ${e.message}` }) + "\n"); } catch { /* ignore */ }
      try { fs.rmSync(paths.pid, { force: true }); } catch { /* ignore */ }
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* stream gone */ }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
        try { controller.close(); } catch { /* already closed */ }
      };

      // Client disconnect / recompile: stop tailing, but LEAVE THE CHILD RUNNING (the whole point).
      const onAbort = () => { close(); };
      request.signal.addEventListener("abort", onAbort);

      // On a fresh launch the client needs the resume handle up front. On attach it already has one
      // (from localStorage), and re-sending would be redundant — instead note the reconnect so the
      // transcript gap is visible.
      if (attaching) send({ kind: "note", text: "· reconnected to the running agent" });
      else send({ kind: "session", sessionId: sid });

      // Tail the log file: attach picks up from the current end (skip history the client already has);
      // a fresh run reads from the top. Poll rather than fs.watch — watch is unreliable on macOS.
      let offset = attaching ? safeSize(paths.log) : 0;
      let buf = "";
      const state: TranslateState = {};
      let idleMs = 0;

      const finish = (code: number) => {
        try { fs.rmSync(paths.pid, { force: true }); } catch { /* ignore */ }
        send({ kind: "exit", code });
        close();
      };

      const tick = () => {
        if (closed) return;
        let chunk = "";
        try {
          const size = safeSize(paths.log);
          if (size > offset) {
            const fd = fs.openSync(paths.log, "r");
            try {
              const b = Buffer.alloc(size - offset);
              fs.readSync(fd, b, 0, b.length, offset);
              chunk = b.toString("utf8");
            } finally { fs.closeSync(fd); }
            offset = size;
          }
        } catch { /* log not created yet — keep polling */ }

        if (chunk) {
          idleMs = 0;
          buf += chunk;
          const { lines, rest } = splitFrames(buf);
          buf = rest;
          let done = false;
          for (const line of lines) {
            for (const frame of translate(line, state)) send(frame);
            if (isTerminalLine(line)) done = true;
          }
          if (done) { finish(0); return; }
        } else {
          // No new output. If the process is gone, the run ended (finished, killed, or crashed);
          // surface stderr on a crash-with-no-result and close.
          if (!readLivePid(type)) {
            const err = tailFile(paths.err, 600);
            if (err) send({ kind: "error", message: err });
            finish(0);
            return;
          }
          idleMs += POLL_MS;
          if (idleMs >= IDLE_MS) {
            const pid = readLivePid(type);
            if (pid) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
            send({ kind: "error", message: `no activity for ${Math.round(IDLE_MS / 60000)} min — stopping the stalled run.` });
            finish(0);
            return;
          }
        }
        timer = setTimeout(tick, POLL_MS);
      };
      tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// Current byte size of a file, or 0 if it doesn't exist yet.
function safeSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// Last `max` chars of a (usually small) text file, trimmed — used to surface stderr on a crash.
function tailFile(p: string, max: number): string {
  try {
    const s = fs.readFileSync(p, "utf8").trim();
    return s.length > max ? s.slice(-max) : s;
  } catch { return ""; }
}

