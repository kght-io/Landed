#!/usr/bin/env node
// Zero-dependency stdio MCP server bridging the agent ⇄ the job-hunt app.
//
// Transport: stdio JSON-RPC (newline-delimited). stdout is RESERVED for protocol frames;
// all logging goes to stderr. Registered as an MCP server for the Claude Code runner (project
// `.mcp.json` / `--mcp-config`) under "jobhunt".
//
// Backing: option A — this server is a thin client over the always-on local API
// (launchd keeps `next dev` on :3000). It holds no state and opens no DB; the Next
// process remains the single owner of the SQLite file. Override the base URL with
// JOBHUNT_URL.
//
// Tool contract: the schema half (name / description / inputSchema) is NOT defined here — it lives
// in shared/src/mcp/tool-schemas.mjs so a hosted chat layer calling the Anthropic API directly gets
// the exact same catalog. This file owns the runners that dispatch each call to /api/*.
//
// READ tools (the app→agent half of the old file bridge):
//   listWatchlist     ← the companies discovery scans (watchlist=true)
//   listCompanies     ← every tracked company (full universe; tier + watchlist + config)
//   scanWatchlist / scanCompany ← mechanical ATS board fetch+filter (no LLM); returns shortlists
//   listApplications  ← app-export/tracker-current.csv
//   getContext        ← inbox sync watermark (inboxLastSynced)
//   listJobs          ← agent-jobs/queue/<id>.json  (work the agent should pick up)
//   getPlaybook       ← instructions/<playbook>.md
// WRITE tools (the agent→app half):
//   submitJobResult   → replaces dropping agent-jobs/results/<id>.json (reconcile inline)
//   createJob         → replaces writing agent-jobs/queue/<id>.json (self-queue work)
//   upsertCompanies   → add/update company records (tier + scrape config)
//   addToWatchlist / removeFromWatchlist → manage the discovery scan list (separate concern)
//   updateApplication → manual posting corrections
//   logMockInterview  → capture a mock-interview session into interview-prep/GLOBAL/mock-interviews/
// The job queue + ledger now live in the app's DB; the agent-jobs/ and app-export/ files
// are retired. Resume bundles in resume/<slug>/ stay on disk by design (binary artifacts).

// The one shared tool contract (plain .mjs so this zero-dep server can import it — see that file).
import { TOOL_SCHEMAS, TOOL_SCHEMA_BY_NAME, MCP_SERVER } from "@landed/shared/mcp/tool-schemas.mjs";

const BASE_URL = (process.env.JOBHUNT_URL || "http://localhost:3000").replace(/\/$/, "");
const SERVER = MCP_SERVER;

// THREAD IDENTITY. The Claude Code runner spawns a fresh copy of this server per agent session, so
// this process *is* one session ("thread"). Mint a stable id at boot and tag every call with it
// (header below) — the app uses it to group the jobs this session claims and to record a per-call
// trace, so the Agents page can visualize what each session is doing. Correlation is server-side:
// the agent never has to remember or pass the id.
const THREAD_ID = process.env.JOBHUNT_THREAD || `th_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const THREAD_LABEL = process.env.JOBHUNT_THREAD_LABEL || "CoWork";

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const log = (s) => process.stderr.write(`[jobhunt] ${s}\n`);

// Thread headers ride on every HTTP call so the app can attribute claims + reads to this chat.
const threadHeaders = () => ({ "x-jobhunt-thread": THREAD_ID, "x-jobhunt-thread-label": THREAD_LABEL });

// Fire-and-forget telemetry to the app's thread endpoints. NEVER throws and NEVER writes to stdout
// (reserved for protocol frames) — observability must not perturb the tool flow or the JSON-RPC stream.
function fireTelemetry(pathWithQuery, payload) {
  try {
    fetch(`${BASE_URL}${pathWithQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...threadHeaders() },
      body: JSON.stringify(payload ?? {}),
    }).catch(() => {});
  } catch {
    // ignore — telemetry is best-effort
  }
}

// The job id a tool call touched, when knowable from args/result (claim + submit are job-scoped;
// other tools act on postings/companies, not jobs, so they have no job id).
function stepJobId(tool, args, data) {
  if (tool === "submitJobResult") return args?.jobId ?? null;
  if (tool === "claimJob") return data?.job?.id ?? args?.id ?? null;
  if (tool === "claimNext") return data?.job?.id ?? null;
  return null;
}

// Human label for the role(s) a claim grabbed — e.g. "Amazon — Senior Engineer (no location)".
// Pulled from the claimed job's params so the chat bubble shows the actual posting, not just "fit".
function postingLabel(job) {
  const ps = job?.params?.postings;
  if (!Array.isArray(ps) || ps.length === 0) return undefined;
  const p = ps[0] ?? {};
  const co = p.company ?? p.companyName ?? "?";
  const role = p.role ?? p.title ?? "role";
  const loc = p.location ? ` (${p.location})` : ""; // omit entirely when unknown — no "(no location)" noise
  const more = ps.length > 1 ? ` +${ps.length - 1} more` : "";
  return `${co} — ${role}${loc}${more}`;
}

// A short human blurb for the step trace (what the call was about).
function stepSummary(tool, args) {
  const a = args || {};
  const bits = [];
  if (a.type) bits.push(String(a.type));
  if (a.company) bits.push(String(a.company));
  if (a.path) bits.push(String(a.path));
  if (a.id != null) bits.push(`#${a.id}`);
  if (Array.isArray(a.records)) bits.push(`${a.records.length} records`);
  if (Array.isArray(a.verdicts)) bits.push(`${a.verdicts.length} verdicts`);
  if (Array.isArray(a.companies)) bits.push(`${a.companies.length} companies`);
  return bits.join(" · ") || undefined;
}

// --- HTTP helper ---------------------------------------------------------------
// Returns parsed JSON, or throws a message that explains the most likely cause
// (the always-on server being down) so the agent gets an actionable error.
async function api(pathWithQuery) {
  const url = `${BASE_URL}${pathWithQuery}`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json", ...threadHeaders() } });
  } catch (e) {
    throw new Error(
      `cannot reach the job-hunt app at ${BASE_URL} (${e?.message ?? e}). ` +
        `Is the always-on server up? Check: launchctl kickstart -k gui/$(id -u)/com.jobhunt`
    );
  }
  const body = await res.text();
  if (!res.ok) throw new Error(`GET ${pathWithQuery} → ${res.status}: ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`GET ${pathWithQuery} returned non-JSON: ${body.slice(0, 200)}`);
  }
}

// Write helper (POST/PATCH JSON). Same down-server diagnostics as api().
async function apiSend(method, pathWithQuery, payload) {
  const url = `${BASE_URL}${pathWithQuery}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      // Every MCP write is the agent's — tag it so the app attributes the change-log event to the agent,
      // not the human default (You). Routes that don't read this header simply ignore it. The
      // thread headers let the app group claims under this chat (see THREAD_ID).
      headers: { "content-type": "application/json", accept: "application/json", "x-jobhunt-actor": "CoWork", ...threadHeaders() },
      body: JSON.stringify(payload ?? {}),
    });
  } catch (e) {
    throw new Error(
      `cannot reach the job-hunt app at ${BASE_URL} (${e?.message ?? e}). ` +
        `Is the always-on server up? Check: launchctl kickstart -k gui/$(id -u)/com.jobhunt`
    );
  }
  const body = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathWithQuery} → ${res.status}: ${body.slice(0, 300)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${method} ${pathWithQuery} returned non-JSON: ${body.slice(0, 200)}`);
  }
}

// --- tools ---------------------------------------------------------------------
// The SCHEMA half of every tool (name / description / inputSchema) lives in the shared contract
// module so the hosted chat layer can hand the same catalog to the Anthropic API without going
// through MCP. This file owns the other half: the RUNNER that turns a call into an /api/* request.
// Keep the two in lockstep by `name` — the binding below throws at boot on any mismatch, so a tool
// added to the contract without a runner (or vice versa) fails loudly instead of silently missing.
const RUNNERS = {
  listWatchlist: async () => (await api("/api/watchlist")).watchlist,

  listCompanies: async () => (await api("/api/companies")).companies,

  scanWatchlist: async () => (await apiSend("POST", "/api/scan", {})).results,

  scanCompany: async (args) => (await apiSend("POST", "/api/scan", { company: args.company })).result,

  listApplications: async (args) => {
    const { postings } = await api("/api/applications");
    return args?.status ? postings.filter((p) => p.status === args.status) : postings;
  },

  getContext: async () => api("/api/context"),

  searchGmail: async (args) => {
    const qs = new URLSearchParams({ q: args.query });
    if (args.limit != null) qs.set("limit", String(args.limit));
    const { threads } = await api(`/api/gmail/search?${qs.toString()}`);
    return threads;
  },

  getGmailThread: async (args) => {
    const { thread } = await api(`/api/gmail/thread/${encodeURIComponent(args.id)}`);
    return thread;
  },

  downloadGmailAttachments: async (args) => {
    return await apiSend("POST", `/api/gmail/thread/${encodeURIComponent(args.id)}/attachments`, { slug: args.slug });
  },

  listJobs: async (args) => {
    const status = (args?.status ?? "queued").trim();
    const parts = ["lean=1"]; // queued rows come back without task/params — lease to get them
    if (status && status !== "all") parts.push(`status=${encodeURIComponent(status)}`);
    const { types, jobs } = await api(`/api/jobs?${parts.join("&")}`);
    return { types, jobs };
  },

  claimNext: async (args) => apiSend("POST", "/api/jobs/claim-next", { by: args?.by, type: args?.type }),

  waitForWork: async (args) => api(`/api/jobs/wait?type=${encodeURIComponent(args.type)}`),

  claimJob: async (args) => apiSend("POST", `/api/jobs/${encodeURIComponent(args.id)}/claim`, { by: args.by }),

  getPlaybook: async (args) => {
    if (args?.path) return api(`/api/instructions/file?path=${encodeURIComponent(args.path)}`);
    const { files } = await api("/api/instructions");
    return { files };
  },

  // --- write tools -------------------------------------------------------------
  submitJobResult: async (args) =>
    (
      await apiSend("POST", "/api/jobs/submit", {
        type: args.type,
        records: args.records,
        jobId: args.jobId,
        createdBy: "CoWork",
        dryRun: args.dryRun,
      })
    ).result,

  submitGlance: async (args) => apiSend("POST", "/api/scanned/glance", { verdicts: args.verdicts }),

  savePostingJd: async (args) => apiSend("PUT", `/api/scanned/${encodeURIComponent(args.id)}`, { jd: args.jd }),

  updateApplication: async (args) => apiSend("PATCH", `/api/applications/${encodeURIComponent(args.id)}`, args.patch ?? {}),

  createJob: async (args) =>
    apiSend("POST", "/api/jobs", { type: args.type, params: args.params, task: args.task, createdBy: "CoWork" }),

  upsertCompanies: async (args) => apiSend("POST", "/api/companies", { companies: args.companies }),

  addToWatchlist: async (args) => (await apiSend("POST", "/api/watchlist", { company: args.company })).company,

  removeFromWatchlist: async (args) => apiSend("DELETE", `/api/watchlist?company=${encodeURIComponent(args.company)}`),

  logMockInterview: async (args) => apiSend("POST", "/api/prep/global/mock-interview", args),
};

// Bind each shared schema to its runner. A schema with no runner would advertise a tool that can't
// be called; a runner with no schema is dead code the agent can never reach — both are boot errors.
const missingRunner = TOOL_SCHEMAS.filter((t) => typeof RUNNERS[t.name] !== "function").map((t) => t.name);
const orphanRunner = Object.keys(RUNNERS).filter((name) => !TOOL_SCHEMA_BY_NAME[name]);
if (missingRunner.length || orphanRunner.length) {
  throw new Error(
    `tool contract mismatch — schemas without a runner: [${missingRunner.join(", ")}]; ` +
      `runners without a schema: [${orphanRunner.join(", ")}]`
  );
}

const TOOLS = TOOL_SCHEMAS.map((t) => ({ ...t, run: RUNNERS[t.name] }));

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const toolSpecs = TOOL_SCHEMAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

// --- JSON-RPC dispatch ---------------------------------------------------------
async function handle(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: SERVER,
        },
      });
      // Register this chat so it appears in the app the moment it connects, before any tool call.
      fireTelemetry("/api/threads/hello", { threadId: THREAD_ID, label: THREAD_LABEL, pid: process.pid });
      return;

    case "notifications/initialized":
    case "initialized":
      return; // notification — no response

    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      return;

    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: toolSpecs } });
      return;

    case "tools/call": {
      const tool = TOOL_BY_NAME[params?.name];
      if (!tool) {
        send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${params?.name}` } });
        return;
      }
      const args = params?.arguments ?? {};
      const started = Date.now();
      try {
        const data = await tool.run(args);
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] },
        });
        // Trace the call so the app's Agents page can show this chat's live step timeline. For a
        // claim, enrich the summary with the actual role grabbed (from the claimed job's params).
        let summary = stepSummary(tool.name, args);
        if ((tool.name === "claimNext" || tool.name === "claimJob") && data?.job) {
          summary = postingLabel(data.job) ?? summary;
        }
        fireTelemetry("/api/threads/step", {
          threadId: THREAD_ID, tool: tool.name, jobId: stepJobId(tool.name, args, data),
          ok: true, durationMs: Date.now() - started, summary,
        });
      } catch (e) {
        // Tool-level failure → return as tool content with isError so the model can react,
        // rather than a protocol error that aborts the call.
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `error: ${e?.message ?? e}` }], isError: true },
        });
        fireTelemetry("/api/threads/step", {
          threadId: THREAD_ID, tool: tool.name, jobId: stepJobId(tool.name, args, null),
          ok: false, durationMs: Date.now() - started, summary: `error: ${e?.message ?? e}`,
        });
      }
      return;
    }

    default:
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
      }
  }
}

// --- stdio read loop (line-delimited JSON) -------------------------------------
// Track in-flight async handlers so a stdin close (client disconnect, or a piped test)
// drains pending tool calls before exiting instead of truncating their responses.
function startStdio() {
  let buf = "";
  let pending = 0;
  let inputEnded = false;
  const maybeExit = () => {
    if (inputEnded && pending === 0) process.exit(0);
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log(`skipped non-JSON line: ${line.slice(0, 80)}`);
        continue;
      }
      pending++;
      handle(msg)
        .catch((e) => {
          if (msg && msg.id !== undefined) {
            send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e) } });
          }
        })
        .finally(() => {
          pending--;
          maybeExit();
        });
    }
  });

  process.stdin.on("end", () => {
    inputEnded = true;
    maybeExit();
  });
  log(`started; thread ${THREAD_ID} (pid ${process.pid}); ${TOOLS.length} tools (7 read + 2 scan + 7 write); backing ${BASE_URL}`);
}

// Only start the stdio server when launched directly (`node jobhunt-server.mjs`). Importing this
// module elsewhere — e.g. the app's /mcp doc page reading the tool catalog — must NOT attach stdin
// listeners or exit the host process, so it just gets the exported TOOLS.
if (process.argv[1]?.endsWith("jobhunt-server.mjs")) startStdio();

// The bound catalog (the shared schemas + their run closures), exported for anything that wants the
// executable tools. The in-app MCP reference reads the SCHEMAS directly from the shared contract
// module instead, so it never loads this server. The `run` closures are inert until called.
export { TOOLS, SERVER };
