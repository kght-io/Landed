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

const BASE_URL = (process.env.JOBHUNT_URL || "http://localhost:3000").replace(/\/$/, "");
const SERVER = { name: "jobhunt", version: "1.0.0" };

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
const TOOLS = [
  {
    name: "listWatchlist",
    description:
      "List the WATCHLIST — the companies discovery should auto-scan (and ONLY these; scanning " +
      "is expensive). Each has its scrape config (ats, slug, endpoint, careersUrl), criteria " +
      "(titles, location), and lastScrapedAt. Read this before a discovery run. The watchlist " +
      "is independent of tier — a company's tier (tier1/tier2/tier3) is just a tag.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => (await api("/api/watchlist")).watchlist,
  },
  {
    name: "listCompanies",
    description:
      "List EVERY company tracked (the full universe), each with tier, the `watchlist` flag, and " +
      "scrape config (ats, slug, endpoint, careersUrl, titles, location). Use this to see/curate " +
      "the whole set — a company you just upserted shows here even before it's watchlisted or has " +
      "any postings. (listWatchlist returns only the discovery scan subset.)",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => (await api("/api/companies")).companies,
  },
  {
    name: "scanWatchlist",
    description:
      "Per-company fetch PLAN for the whole watchlist. fetchMethod decides each: " +
      "status 'ok' = the app already scanned its ATS API (fetchMethod=api) and returns a " +
      "filtered, deduped shortlist (title/location/url/team) — just glance + createJob(fit). " +
      "status 'manual' = YOU fetch it (fetchMethod careers-get/browser) using the returned " +
      "careersUrl + fetchRecipe, then filter + createJob(fit). status 'unsupported' = needs " +
      "research (no method/slug). No JDs in the overview — use scanCompany for an api company's JDs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => (await apiSend("POST", "/api/scan", {})).results,
  },
  {
    name: "scanCompany",
    description:
      "Scan ONE company. For an `api` company the app fetches its ATS board and returns the " +
      "shortlist WITH job descriptions (filtered by titles/location, deduped) — glance + " +
      "createJob(fit). For a careers-get/browser company it returns status 'manual' with " +
      "careersUrl + fetchRecipe (YOU fetch it). 'unsupported' = needs research. Use after " +
      "scanWatchlist to pull an api company's JDs.",
    inputSchema: {
      type: "object",
      properties: { company: { type: "string", description: "Company name to scan." } },
      required: ["company"],
      additionalProperties: false,
    },
    run: async (args) => (await apiSend("POST", "/api/scan", { company: args.company })).result,
  },
  {
    name: "listApplications",
    description:
      "List the currently tracked applications/postings (the live board state). Use this to " +
      "avoid re-surfacing jobs that are already tracked (dedup) and to see each posting's " +
      "status, tier, and dates. Optional `status` filters to one pipeline status.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Optional pipeline status filter, e.g. discovered, assessed, applied, interview, " +
            "rejected, ghost, company_skipped, expired.",
        },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      const { postings } = await api("/api/applications");
      return args?.status ? postings.filter((p) => p.status === args.status) : postings;
    },
  },
  {
    name: "getContext",
    description:
      "Get the read-context to consult before self-initiating a job: `inboxLastSynced` (only " +
      "fetch mail newer than this watermark).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => api("/api/context"),
  },
  {
    name: "searchGmail",
    description:
      "Search my Gmail (READ-ONLY) — the inbox-sync data source. `query` uses normal Gmail search " +
      "syntax (e.g. \"after:2026-06-18 -category:promotions\", \"from:greenhouse.io\", " +
      "\"filename:invite.ics\"), applied over IMAP via X-GM-RAW. Returns threads newest-first, each " +
      "{ threadId, subject, from, date, snippet, labels, messages } — classify most threads straight " +
      "from the snippet. `threadId` is Gmail's STABLE thread id: use it for emailRefs/emailId and to " +
      "pull the full thread with getGmailThread. `limit` caps threads (default 50, max 100). Requires " +
      "Gmail to be connected in the app's Settings (app password).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query (X-GM-RAW / normal Gmail syntax)." },
        limit: { type: "number", description: "Max threads to return (default 50, max 100)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (args) => {
      const qs = new URLSearchParams({ q: args.query });
      if (args.limit != null) qs.set("limit", String(args.limit));
      const { threads } = await api(`/api/gmail/search?${qs.toString()}`);
      return threads;
    },
  },
  {
    name: "getGmailThread",
    description:
      "Read ONE full Gmail thread (READ-ONLY) by its `id` (the threadId from searchGmail) — every " +
      "message's from/to/date/subject/text, oldest first. Use when a thread's snippet isn't enough to " +
      "classify it (e.g. a borderline rejection vs. next-round email). Requires Gmail connected in Settings.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Gmail thread id (X-GM-THRID), as returned by searchGmail." } },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (args) => {
      const { thread } = await api(`/api/gmail/thread/${encodeURIComponent(args.id)}`);
      return thread;
    },
  },
  {
    name: "downloadGmailAttachments",
    description:
      "Download every file attached to a Gmail thread into a company's interview-prep folder " +
      "(interview-prep/<slug>/attachments/). Use during the interview-emails job when a recruiter/" +
      "interviewer email carries a role PDF, prep guide, or take-home spec. The app fetches + writes " +
      "the files (it holds the IMAP connection); you pass the thread id + the company `slug`. Returns " +
      "the saved filenames. Requires Gmail connected in Settings.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Gmail thread id (X-GM-THRID), as returned by searchGmail." },
        slug: { type: "string", description: "Company folder slug (from the job params) — interview-prep/<slug>/." },
      },
      required: ["id", "slug"],
      additionalProperties: false,
    },
    run: async (args) => {
      return await apiSend("POST", `/api/gmail/thread/${encodeURIComponent(args.id)}/attachments`, { slug: args.slug });
    },
  },
  {
    name: "listJobs",
    description:
      "SURVEY the queue (a read-only menu) — the available job `types` (with their playbooks) and the " +
      "live `jobs`. **Defaults to only `queued` jobs.** For `queued` jobs this returns just the menu " +
      "fields (`id`, `type`, `status`, …) — **NOT** `task`/`params`: you can't see a job's work " +
      "content (the postings, JD, instructions) until you LEASE it. So the normal loop is **not** " +
      "listJobs→claimJob; it's **`claimNext()`** in a loop, which hands you the next job AND its claim " +
      "AND its task/params in one call. Use listJobs only to see what's waiting / how much. Each job " +
      "has a `status`: `queued` (up for grabs), `wip` (claimed by a live agent — leave it alone), " +
      "`ingested` (done), `failed`. A claim is a 60-minute lease; an abandoned `wip` reads back as " +
      "`queued` once it expires. Pass `status` to widen the filter (e.g. `\"queued,wip\"`, or " +
      "`\"all\"`); `wip`/`ingested` rows keep their full fields.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Comma-separated status filter — defaults to \"queued\". Use \"queued,wip\" to also see in-flight jobs, or \"all\" for the entire ledger (incl. ingested/failed history).",
        },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      const status = (args?.status ?? "queued").trim();
      const parts = ["lean=1"]; // queued rows come back without task/params — lease to get them
      if (status && status !== "all") parts.push(`status=${encodeURIComponent(status)}`);
      const { types, jobs } = await api(`/api/jobs?${parts.join("&")}`);
      return { types, jobs };
    },
  },
  {
    name: "claimNext",
    description:
      "LEASE the next job to work — the normal way to drain the queue. Atomically takes the oldest " +
      "claimable `queued` job, flips it to `wip` under a 60-minute lease, and returns it WITH its " +
      "`task` + `params` (the work content listJobs withholds). So you get a job, its claim, and its " +
      "inputs in one call — you can't accidentally start working before claiming. ONE TYPE PER RUN: " +
      "pass `type` (e.g. \"tailoring\") to drain that specific queue and keep passing the SAME type for " +
      "the whole run, so a run never mixes types. Different types CAN run in parallel — another thread " +
      "may work a different `type` at the same time, that's fine. Omit `type` to take the active type " +
      "(joins whatever's already in flight). Loop it: `claimNext({ type })` → do the work per the job's " +
      "playbook → `submitJobResult(jobId)` → repeat with the SAME type. Returns `{ job }` (the claimed " +
      "job) or `{ job: null }` when nothing of that type is left (stop). One job per call, so multiple " +
      "agents share the queue safely. (Use `claimJob(id)` only to claim a specific job you spotted via listJobs.)",
    inputSchema: {
      type: "object",
      properties: {
        by: { type: "string", description: "Optional label for this agent/session (defaults to CoWork)." },
        type: { type: "string", description: "Optional job type to drain (e.g. fit | tailoring | inbox-sync). Omit to take the default next type." },
      },
      additionalProperties: false,
    },
    run: async (args) => apiSend("POST", "/api/jobs/claim-next", { by: args?.by, type: args?.type }),
  },
  {
    name: "waitForWork",
    description:
      "BLOCK until there's work to do — the heartbeat of a pinned, app-driven chat. Call this in a " +
      "loop and the app wakes you: it returns `{ ready:true }` the instant there's claimable work of " +
      "`type` (you handed off jobs) OR the user clicks Drain in the app; otherwise it returns " +
      "`{ ready:false }` after ~25s and you simply call it again. THE LOOP: `waitForWork({ type })` → " +
      "if `ready`, drain with `claimNext({ type })` until it returns no job → call `waitForWork` again. " +
      "Never stop the loop on your own; keep waiting. This lets you stay parked as (say) the fit worker " +
      "and act the moment the app sends work — no need for the user to prompt you each time. Stay quiet " +
      "between polls (don't narrate); just call the tool.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "The job type this chat handles (e.g. fit | tailoring | inbox-sync). Keep it the SAME for the whole chat." },
      },
      required: ["type"],
      additionalProperties: false,
    },
    run: async (args) => api(`/api/jobs/wait?type=${encodeURIComponent(args.type)}`),
  },
  {
    name: "claimJob",
    description:
      "Claim a `queued` job before you work it, so two agents never run the same job. Call this " +
      "with the job's `id` right after picking it from listJobs and BEFORE doing the work. On " +
      "success it returns `{ claimed: true, job }` (the job is now `wip`, stamped with claimedAt) " +
      "— proceed, then finish with submitJobResult(jobId). On `{ claimed: false }` someone else " +
      "already claimed it or it's done — skip it. Any type is claimable (different types may run in " +
      "parallel), but within YOUR run stick to one type — claim jobs of the same type you started with.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The queued job's id (from listJobs)." },
        by: { type: "string", description: "Optional label for this agent/session (defaults to CoWork)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (args) => apiSend("POST", `/api/jobs/${encodeURIComponent(args.id)}/claim`, { by: args.by }),
  },
  {
    name: "getPlaybook",
    description:
      "Fetch an agent instruction playbook by path (e.g. 'watchlist-scan.md'). Call with no " +
      "`path` to list every available playbook first.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Playbook path relative to the instructions root, e.g. 'watchlist-scan.md'.",
        },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      if (args?.path) return api(`/api/instructions/file?path=${encodeURIComponent(args.path)}`);
      const { files } = await api("/api/instructions");
      return { files };
    },
  },

  // --- write tools -------------------------------------------------------------
  {
    name: "submitJobResult",
    description:
      "Hand a job's result back to the app — the write path that REPLACES dropping a " +
      "results/<id>.json file. `type` is the job type (discovery | inbox-sync | fit | " +
      "tailoring | prep | prep-research | interview-brief | interview-emails | peer-comp); `records` is the array of result records (fields per that job's " +
      "playbook Output section). Omit `jobId` for a self-initiated run (the app synthesizes " +
      "a ledger entry); pass it when fulfilling an app-queued job. **You must hold a live claim on " +
      "that job (via claimNext/claimJob) — the app REJECTS a submit for a job you haven't claimed or " +
      "whose lease expired.** The app runs dedup + the review gate and returns a summary. Set " +
      "`dryRun:true` to preview without persisting.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Job type: discovery | inbox-sync | fit | tailoring | prep | prep-research | interview-brief | interview-emails | peer-comp.",
        },
        records: {
          type: "array",
          items: { type: "object" },
          description: "Result records, one per item; fields defined by the job's playbook Output section.",
        },
        jobId: {
          type: "string",
          description: "The app-queued job id this fulfills, if any. Omit for self-initiated runs.",
        },
        dryRun: { type: "boolean", description: "Preview the reconcile without persisting." },
      },
      required: ["type", "records"],
      additionalProperties: false,
    },
    run: async (args) =>
      (
        await apiSend("POST", "/api/jobs/submit", {
          type: args.type,
          records: args.records,
          jobId: args.jobId,
          createdBy: "CoWork",
          dryRun: args.dryRun,
        })
      ).result,
  },
  {
    name: "submitGlance",
    description:
      "Submit your SUPERFICIAL second-pass glance on watchlist-scan candidates — title + location " +
      "only, NO JD. One object per posting: { company, atsId?, url?, title?, location?, glance }. " +
      "glance = 'high' (clear senior+ SWE IC match → the app creates a discovered application + a " +
      "fit job; you fetch the JD when you run that fit job), 'low' (unsure → goes to your review), " +
      "or 'drop' (not a match → discarded). For api companies pass the `atsId` from scanCompany/" +
      "scanWatchlist; for careers-get/browser companies you fetched yourself, pass company + url + " +
      "title (the scanned row is created). Returns counts: {queued, review, discarded, failed}.",
    inputSchema: {
      type: "object",
      properties: {
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string" },
              atsId: { type: "string", description: "ATS job id (api companies) — the dedup key." },
              url: { type: "string", description: "Posting URL (use for careers-get/browser companies)." },
              title: { type: "string" },
              location: { type: "string" },
              glance: { type: "string", enum: ["high", "low", "drop"] },
            },
            required: ["company", "glance"],
            additionalProperties: false,
          },
        },
      },
      required: ["verdicts"],
      additionalProperties: false,
    },
    run: async (args) => apiSend("POST", "/api/scanned/glance", { verdicts: args.verdicts }),
  },
  {
    name: "savePostingJd",
    description:
      "Persist the JD text for one posting (by its candidate `id`). Call this at the FIT stage as " +
      "soon as you have the JD (the one in `params.jd`, or whatever you fetched from the URL) — it " +
      "saves the JD on the posting so the later tailoring job reuses it instead of re-fetching from " +
      "the link. Separate from submitJobResult on purpose: the JD is a large blob, so it's a " +
      "dedicated write, not something to echo back in the fit result. Idempotent. " +
      "Returns { ok, id }.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Posting/candidate id (from the fit job's params.postings[].id)." },
        jd: { type: "string", description: "The full job-description text you assessed against." },
      },
      required: ["id", "jd"],
      additionalProperties: false,
    },
    run: async (args) => apiSend("PUT", `/api/scanned/${encodeURIComponent(args.id)}`, { jd: args.jd }),
  },
  {
    name: "updateApplication",
    description:
      "Patch one tracked application/posting by id — for manual corrections (status, role, " +
      "url, dates, channel, interviewed, tier, or company via companyName/moveToCompany). Use " +
      "listApplications to find the id. Goes through the same validation + change-log as the " +
      "app's own edits.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Application id (from listApplications)." },
        patch: {
          type: "object",
          description:
            "Fields to change, e.g. { status, role, url, appliedDate, channel, interviewed, " +
            "tier, companyName, moveToCompany }.",
        },
      },
      required: ["id", "patch"],
      additionalProperties: false,
    },
    run: async (args) => apiSend("PATCH", `/api/applications/${encodeURIComponent(args.id)}`, args.patch ?? {}),
  },
  {
    name: "createJob",
    description:
      "Queue a job for later processing — the write path that replaces dropping a queue file. " +
      "Use it to self-queue work: e.g. discovery queues a `fit` job per passing posting (put the " +
      "postings, with full JD, in `params.postings`). The job appears in listJobs as `queued` " +
      "until you fulfill it with submitJobResult(jobId). Returns the new job id.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Job type: discovery | inbox-sync | fit | tailoring | prep | prep-research | interview-brief | interview-emails | peer-comp." },
        params: {
          type: "object",
          description: "Job input, e.g. { postings: [{ company, role, url, jd }] } for a fit job.",
        },
        task: { type: "string", description: "Optional human-readable instruction; defaults from the job type." },
      },
      required: ["type"],
      additionalProperties: false,
    },
    run: async (args) =>
      apiSend("POST", "/api/jobs", { type: args.type, params: args.params, task: args.task, createdBy: "CoWork" }),
  },
  {
    name: "upsertCompanies",
    description:
      "Add or update company RECORDS — tier + scrape config. Use whenever we curate a company " +
      "(new company, re-tier, fix ats/slug/endpoint/careersUrl, adjust titles/locations, notes). " +
      "`tier` (tier1/tier2/tier3) is just a tag. This does NOT change the watchlist — " +
      "manage the discovery scan list separately with addToWatchlist / removeFromWatchlist. " +
      "Matched by canonical name: existing is patched (only fields you pass), unknown is added. " +
      "Pass one or many. Use listCompanies to see current state first.",
    inputSchema: {
      type: "object",
      properties: {
        companies: {
          type: "array",
          minItems: 1,
          description: "Companies to add/update. Only include the fields you want to set.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Company brand name (required), e.g. \"Scale AI\"." },
              tier: { type: "string", description: "tier1 | tier2 | tier3 (just a tag; tier1 = top target)." },
              ats: { type: "string", description: "Backend system: greenhouse | ashby | custom | verify (drives the app's API scan)." },
              fetchMethod: { type: "string", description: "How YOU read the board: api | careers-get | browser (separate from ats)." },
              fetchRecipe: { type: "string", description: "Scan steps for browser/careers-get boards (no click coords): filters to set, what to exclude, whether level comes from title or JD. Only needed when fetchMethod isn't api." },
              slug: { type: "string", description: "ATS board slug, e.g. \"anthropic\"." },
              endpoint: { type: "string", description: "Scrape API endpoint (or a verify hint)." },
              careersUrl: { type: "string", description: "Careers page URL." },
              titles: { type: "array", items: { type: "string" }, description: "Titles to target, e.g. [\"Senior\",\"Staff\"]." },
              location: { type: "string", description: "Target location(s), e.g. \"NYC|remote\"." },
              leveling: {
                type: "object",
                description: "The company's IC SWE ladder from levels.fyi, normalized to the shared 1–10 reference scale (the app's configured reference ladder defaults to Amazon, L4 ≈ 1 … L8 ≈ 9.3). Collect it during add-watchlist via the Chrome geometry method in watchlist-add.md. The app highlights the target-band straddle itself, so no overlap field is needed.",
                properties: {
                  source: { type: "string", description: "'levels.fyi-geometry' when collected, or 'none' if the company has no ladder." },
                  ladder: {
                    type: "object",
                    description: "Level name → [min, max] on the 1–10 scale, e.g. {\"L3\": [4.6, 6.2], \"L4\": [6.2, 8.1]}.",
                    additionalProperties: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                  },
                  titles: {
                    type: "object",
                    description: "Level name → the company's IC SWE role title for that rung, e.g. {\"L5\": \"Software Engineer\", \"L6\": \"Senior Software Engineer\", \"L7\": \"Staff Software Engineer\"}. Use the SAME keys as `ladder`. Read off levels.fyi alongside the ladder.",
                    additionalProperties: { type: "string" },
                  },
                },
                required: ["source"],
                additionalProperties: false,
              },
              notes: { type: "string", description: "Freeform notes (e.g. \"quant; flat IC titles\")." },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      required: ["companies"],
      additionalProperties: false,
    },
    run: async (args) => apiSend("POST", "/api/companies", { companies: args.companies }),
  },
  {
    name: "addToWatchlist",
    description:
      "Add a company to the discovery watchlist — the scan list (and ONLY watchlisted companies " +
      "are scanned; scanning is expensive). Creates a minimal company record if it isn't tracked " +
      "yet. Independent of tier. To set scrape config too, also call upsertCompanies — and when " +
      "you do, include `leveling` (collected from levels.fyi per watchlist-add.md) so the fit " +
      "view can show its ladder against your reference.",
    inputSchema: {
      type: "object",
      properties: { company: { type: "string", description: "Company name to start scanning." } },
      required: ["company"],
      additionalProperties: false,
    },
    run: async (args) => (await apiSend("POST", "/api/watchlist", { company: args.company })).company,
  },
  {
    name: "removeFromWatchlist",
    description:
      "Remove a company from the discovery watchlist (discovery stops scanning it). The company " +
      "record itself is kept — this only takes it off the scan list. No-op if it wasn't on it.",
    inputSchema: {
      type: "object",
      properties: { company: { type: "string", description: "Company name to stop scanning." } },
      required: ["company"],
      additionalProperties: false,
    },
    run: async (args) => apiSend("DELETE", `/api/watchlist?company=${encodeURIComponent(args.company)}`),
  },
  {
    name: "logMockInterview",
    description:
      "Log one mock-interview practice session into the cross-company readiness layer " +
      "(interview-prep/GLOBAL/mock-interviews/). Pass the session's freeform `notes` and, if known, " +
      "the `gaps` it surfaced ({ area, detail, severity? }). Optional `title` heads the file. Capture " +
      "only — each call writes a fresh numbered session file; the readiness chat (readiness.md) " +
      "reconciles the gaps into the GLOBAL gap ledger. Returns the saved file's metadata.",
    inputSchema: {
      type: "object",
      properties: {
        notes: { type: "string", description: "Freeform notes / recap of the mock session (required)." },
        gaps: {
          type: "array",
          description: "Weaknesses the session surfaced (optional).",
          items: {
            type: "object",
            properties: {
              area: { type: "string", description: "Short tag, e.g. \"system-design\", \"behavioral\", \"coding\"." },
              detail: { type: "string", description: "The specific miss." },
              severity: { type: "string", description: "low | medium | high (optional)." },
            },
            required: ["area", "detail"],
            additionalProperties: false,
          },
        },
        title: { type: "string", description: "Optional H1 title for the session file, e.g. \"System design mock — 2026-07-10\"." },
      },
      required: ["notes"],
      additionalProperties: false,
    },
    run: async (args) => apiSend("POST", "/api/prep/global/mock-interview", args),
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const toolSpecs = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

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

// The tool catalog (name / description / inputSchema + run), exported so the app can render an
// in-app MCP reference without running the server. The `run` closures are inert until called.
export { TOOLS, SERVER };
