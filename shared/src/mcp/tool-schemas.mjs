// THE TOOL CONTRACT — one definition of the jobhunt agent tool surface, shared by every consumer.
//
// Two clients call the same tools and must never drift apart:
//   • Claude Code on the laptop, over stdio MCP  (mcp/jobhunt-server.mjs)
//   • a hosted chat layer calling the Anthropic API directly, which needs
//     `tools: [{ name, description, input_schema }]`
// Both dispatch to the same /api/* routes; only these SCHEMAS are shared. The HTTP runners that
// execute a call stay with the MCP server, bound to these schemas by `name` (it fails at boot if
// a schema has no runner, or a runner no schema).
//
// WHY PLAIN .mjs, IN shared/: mcp/jobhunt-server.mjs is executed directly by node with zero
// dependencies and no build step, so it cannot import TypeScript. The dependency therefore runs
// this way — plain JS that the TypeScript consumers (frontend/lib/mcp-tools.ts, and any future
// backend chat layer) import, never the reverse. Pure data, no imports: `shared` ships to the
// browser. Same pattern as config/targets.mjs.
//
// EDITING: this file IS the contract. Changing a name, description, or inputSchema changes what
// both the agent and the chat layer see — and `instructions/README.md` documents these tools for
// CoWork, so keep it in sync (see AGENTS.md).
//
// READ tools (the app→agent half):
//   listWatchlist · listCompanies · scanWatchlist · scanCompany · listApplications · getContext
//   searchGmail · getGmailThread · downloadGmailAttachments · listJobs · claimNext · waitForWork
//   claimJob · getPlaybook
// WRITE tools (the agent→app half):
//   submitJobResult · submitGlance · savePostingJd · updateApplication · createJob
//   upsertCompanies · addToWatchlist · removeFromWatchlist

// The MCP server's identity, shared for the same reason as the schemas (the in-app /mcp reference
// renders it without importing — or running — the stdio server).
export const MCP_SERVER = { name: "jobhunt", version: "1.0.0" };

export const TOOL_SCHEMAS = [
  {
    name: "listWatchlist",
    description:
      "List the WATCHLIST — the companies discovery should auto-scan (and ONLY these; scanning " +
      "is expensive). Each has its scrape config (ats, slug, endpoint, careersUrl), criteria " +
      "(titles, location), and lastScrapedAt. Read this before a discovery run. The watchlist " +
      "is independent of tier — a company's tier (tier1/tier2/tier3) is just a tag.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "listCompanies",
    description:
      "List EVERY company tracked (the full universe), each with tier, the `watchlist` flag, and " +
      "scrape config (ats, slug, endpoint, careersUrl, titles, location). Use this to see/curate " +
      "the whole set — a company you just upserted shows here even before it's watchlisted or has " +
      "any postings. (listWatchlist returns only the discovery scan subset.)",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
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
  },
  {
    name: "getContext",
    description:
      "Get the read-context to consult before self-initiating a job: `inboxLastSynced` (only " +
      "fetch mail newer than this watermark).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
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
  },

  // --- write tools -------------------------------------------------------------
  {
    name: "submitJobResult",
    description:
      "Hand a job's result back to the app — the write path that REPLACES dropping a " +
      "results/<id>.json file. `type` is the job type (discovery | inbox-sync | fit | " +
      "tailoring | interview-brief | interview-emails | peer-comp); `records` is the array of result records (fields per that job's " +
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
          description: "Job type: discovery | inbox-sync | fit | tailoring | interview-brief | interview-emails | peer-comp.",
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
        type: { type: "string", description: "Job type: discovery | inbox-sync | fit | tailoring | interview-brief | interview-emails | peer-comp." },
        params: {
          type: "object",
          description: "Job input, e.g. { postings: [{ company, role, url, jd }] } for a fit job.",
        },
        task: { type: "string", description: "Optional human-readable instruction; defaults from the job type." },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    name: "upsertCompanies",
    description:
      "Add or update company RECORDS — tier + scrape config. Use whenever we curate a company " +
      "(new company, re-tier, fix ats/slug/endpoint/careersUrl, adjust titles/locations, notes). " +
      "`tier` (tier1/tier2/tier3) is just a tag. This does NOT change the watchlist — " +
      "manage the discovery scan list separately with addToWatchlist / removeFromWatchlist. " +
      "It DOES own `cooldownUntil`: the date a company that rejected us after a real interview " +
      "is skipped by discovery until. " +
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
              cooldownUntil: {
                type: ["string", "null"],
                description: "YYYY-MM-DD — discovery skips this company entirely until then (no scans, and anything found is filed away). Set automatically when they reject you after a real interview loop; set it by hand when that rejection's rounds were never logged. Pass null to end a cooldown early. An unparseable date is ignored, not stored.",
              },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      required: ["companies"],
      additionalProperties: false,
    },
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
  },
];

// name → schema, for binding runners (and for any dispatcher that needs a schema by name).
export const TOOL_SCHEMA_BY_NAME = Object.fromEntries(TOOL_SCHEMAS.map((t) => [t.name, t]));
