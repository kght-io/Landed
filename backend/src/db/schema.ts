import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import {
  POSTING_STATES, POSTING_VERDICTS, POSTING_CHANNELS, COMPANY_TIERS,
  PENDING_KINDS, PENDING_STATUSES,
} from "@landed/shared/db/enums";

// Tier of a company. Drives the pipeline rules (see shared/src/pipeline/stages.ts).
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  // Stable slugs (best → broadest); human labels live in TIER_META (shared/src/pipeline/stages.ts).
  tier: text("tier", { enum: COMPANY_TIERS })
    .notNull()
    .default("tier3"),
  careersUrl: text("careers_url"),
  ats: text("ats"), // backend system: greenhouse | ashby | custom | verify — drives the app's API scan
  // HOW to actually read the board, separate from the backend system. The app's scanCompany
  // keys off `ats`; the agent uses this to pick its own path when the API scan doesn't apply.
  fetchMethod: text("fetch_method"), // api | careers-get | browser
  // Short, human/agent-readable scan steps for browser/careers-get companies (no click
  // coords): which filters to set, what to exclude, and whether level comes from the title
  // or the JD. Only needed when fetchMethod isn't `api`. Distinct from freeform `notes`.
  fetchRecipe: text("fetch_recipe"),
  notes: text("notes"),
  // Scrape config + search criteria for a target (the agent curates these via upsertCompanies).
  slug: text("slug"), // ATS board slug, e.g. "anthropic" for greenhouse/ashby
  endpoint: text("endpoint"), // scrape API endpoint (or a "(verify XHR)" hint)
  targetTitles: text("target_titles"), // JSON string[] of titles to target, e.g. ["Senior","Staff"]
  targetLocation: text("target_location"), // e.g. "NYC|remote"
  leveling: text("leveling"), // JSON {source,ladder} — levels.fyi ladder on the shared 1–10 reference scale
  lastScrapedAt: text("last_scraped_at"), // ISO; stamped when discovery surfaces a posting for this company
  // Discovery auto-scans ONLY watchlisted companies (scanning is expensive). Orthogonal to
  // tier — tier is for tagging/categorization; watchlist is "scan this for new postings".
  watchlist: integer("watchlist", { mode: "boolean" }).notNull().default(false),
  // Audit timestamps for the company record. createdAt = first seen; updatedAt = last *curation*
  // edit (tier / name / scrape-config / watchlist) — NOT bumped by auto-scrape, which has its own
  // lastScrapedAt. Both ISO; nullable so pre-existing rows backfill lazily.
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// NOTE: the former `applications` table was folded into `postings` (the unified model — see
// docs/unify-postings-plan.md). The tracker is now `postings` rows in a TRACKER stage.

// Change log — every mutation writes a row here, tagged with its source.
// Powers the Changes view and makes automated edits auditable/reversible.
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts").notNull(), // ISO timestamp
  actor: text("actor").notNull().default("You"), // You (manual) | CoWork (ingestion)
  source: text("source").notNull(), // ui | inbox | cowork | scraper | reconcile
  entity: text("entity").notNull(), // application | company
  entityId: integer("entity_id"),
  action: text("action").notNull(), // insert | update | preserve | flag | delete | merge
  field: text("field"), // null for row-level summary events
  oldValue: text("old_value"),
  newValue: text("new_value"),
  summary: text("summary"),
});

// Many interview rounds per application — the "interviewing" stage.
export const interviews = sqliteTable("interviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  applicationId: integer("application_id")
    .notNull()
    .references(() => postings.id),
  round: integer("round"),
  kind: text("kind"), // phone_screen | onsite | system_design | ...
  date: text("date"),
  outcome: text("outcome"), // passed | rejected | pending
  notes: text("notes"),
  emailId: text("email_id"), // Gmail thread id for this round's email (inbox-sync) — for a direct link
  // The round's substance, captured by `interview-emails` from the scheduling / prep threads. The
  // columns above are inbox-sync's (the cheap global pass); these are the deep per-company read's.
  // Both write through upsertInterviews, which preserves any field the writer omitted.
  startTime: text("start_time"), // local wall-clock "HH:MM"
  durationMins: integer("duration_mins"),
  timezone: text("timezone"), // as the email stated it ("ET")
  interviewers: text("interviewers"), // JSON [{ name, title? }]
  format: text("format"), // "Zoom video, shared screen"
  joinUrl: text("join_url"),
  whatToExpect: text("what_to_expect"),
  prepNotes: text("prep_notes"), // JSON string[] — their how-to-prepare list
});

// Small key-value store for app state (Gmail refresh token, last-sync cursor, …).
export const appConfig = sqliteTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// The agent job ledger. A job's live state lives in the asset-folder queue/done
// The job queue + ledger (DB-backed; replaces the agent-jobs/{queue,results,done} files).
// A row IS the queued job: app→agent handoffs (fit/tailoring) and the agent self-runs both
// live here. Lifecycle: queued → wip (an agent claimed it) → ingested (result submitted) | failed.
// An agent claims a job (queued → wip, stamping claimed_at) before working it so two agents never
// run the same job; a stuck wip job is recovered by the user with a manual requeue (wip → queued).
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // discovery | inbox-sync | fit | tailoring | prep
  createdBy: text("created_by").notNull().default("You"), // You | CoWork
  status: text("status").notNull().default("queued"), // queued | wip | ingested | failed
  createdAt: text("created_at").notNull(),
  claimedAt: text("claimed_at"), // when an agent claimed it (status wip); cleared on requeue
  claimedBy: text("claimed_by"), // the agent/session that claimed it (defaults to CoWork)
  ingestedAt: text("ingested_at"),
  summary: text("summary"),
  playbook: text("playbook"), // instructions/<playbook> The agent should follow
  task: text("task"), // human/the agent-readable instruction
  params: text("params"), // JSON job input (e.g. { postings: [{ company, role, jd, url }] })
  result: text("result"), // JSON of the submitted result records (history)
  // Stuck-job detection (mechanical, not agent-cooperative): `attempts` is bumped every time a job is
  // claimed (incl. lease-expiry reclaims), so the app KNOWS how many times it's been tried without a
  // result. Past CLAIM_MAX_ATTEMPTS with no result, reapStuckJobs() dead-letters it → status `failed`
  // with `error`. createJob (a deliberate re-queue / retry) resets both. An agent MAY also fail a job
  // itself with a reason (faster, but best-effort — never relied on; the cap is the safety net).
  attempts: integer("attempts").notNull().default(0),
  error: text("error"), // why it failed (auto: "stuck after N attempts"; or an agent-reported reason)
  // The agent session (thread) that claimed this job. Each session runs its own `jobhunt` MCP server
  // process, which stamps this on claim via the x-jobhunt-thread header — so jobs group under the
  // session that's running them, without the agent having to pass anything. See `threads` below.
  threadId: text("thread_id"),
});

// ── the agent threads ──
// One row per agent SESSION. The Claude Code runner spawns a separate `jobhunt` MCP server process
// per session; that process mints a `threadId` at boot and tags every call with it. A session can
// claim and run many jobs (jobs.thread_id), so this is the parent the Agents page groups jobs + steps
// under. We can't observe the session directly — only what it does over MCP — so `lastSeenAt` (bumped
// on every call) is the liveness signal; there's no reliable process-exit event over HTTP.
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(), // th_<base36 time><rand>, minted by the MCP server process
  label: text("label"), // human label (claimedBy / "CoWork")
  pid: integer("pid"), // the MCP server process pid (debug aid)
  startedAt: text("started_at").notNull(), // first contact (process boot)
  lastSeenAt: text("last_seen_at").notNull(), // bumped on every MCP call — the heartbeat
  steps: integer("steps").notNull().default(0), // running count of MCP calls (cheap badge)
  // User dismissed this chat from the view. Soft-hide: the thread reappears if it acts again
  // (lastSeenAt moves past this), so a live chat can't be permanently silenced by accident.
  dismissedAt: text("dismissed_at"),
});

// Append-only per-call trace: one row per MCP tool call a thread makes. This is the "thread
// timeline" the app renders — the only window into what an agent session is doing, since the work
// itself happens inside the Claude Code runner between these calls.
export const threadSteps = sqliteTable("thread_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threadId: text("thread_id").notNull(),
  ts: text("ts").notNull(), // ISO timestamp
  tool: text("tool").notNull(), // MCP tool name (claimNext, savePostingJd, submitJobResult, …)
  jobId: text("job_id"), // the job this call touched, when knowable from the args
  ok: integer("ok", { mode: "boolean" }).notNull().default(true),
  durationMs: integer("duration_ms"),
  summary: text("summary"), // short arg/result blurb
});

// One row per agent run — powers the Agents page "last run" + history.
export const agentRuns = sqliteTable("agent_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id").notNull(),
  ts: text("ts").notNull(),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  fieldChanges: integer("field_changes").notNull().default(0),
  flagged: integer("flagged").notNull().default(0),
  newCompanies: integer("new_companies").notNull().default(0),
  summary: text("summary"),
});

// Ambiguous ingestion matches awaiting a human pick. When a sync record (e.g. a
// rejection) could belong to 2+ existing applications, we don't guess — we park it
// here and surface it in the Changes "needs review" panel for the user to resolve.
export const pendingMatches = sqliteTable("pending_matches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull(),
  actor: text("actor").notNull(), // who produced the incoming record (the agent)
  source: text("source").notNull(), // inbox-sync, ...
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  companyName: text("company_name").notNull(),
  // Dedup key, namespaced per kind so they can't collide: norm(role)|status|appliedDate (match) ·
  // change|<postingId|new>|<that> (change) · unbound|<jobType>|<declaredId> (unbound).
  signature: text("signature").notNull(),
  // JSON: IncomingApp (match) | { rec: IncomingApp, diffs: FieldDiff[] } (change)
  //     | { jobType, declaredId, record } (unbound)
  payload: text("payload").notNull(),
  // JSON number[] of candidate posting ids (hints for unbound; the single target for a change —
  // empty when the change PROPOSES the posting, since it doesn't exist yet).
  candidateIds: text("candidate_ids").notNull(),
  // Action kind: `match` = pick which posting an incoming inbox record belongs to (fuzzy/ambiguous);
  // `unbound` = a fit/tailor result whose echoed id didn't resolve — an alert to look at (dismiss
  // only); `change` = a change an inbox sync wants to make, held until you approve it.
  kind: text("kind", { enum: PENDING_KINDS }).notNull().default("match"),
  status: text("status", { enum: PENDING_STATUSES })
    .notNull()
    .default("pending"),
  resolvedAppId: integer("resolved_app_id"),
  resolvedAt: text("resolved_at"),
});

// your personal to-do list — manual action items (follow-ups, interview prep, …).
// Not tied to the application change-log; this is your own scratchpad.
export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  due: text("due"), // optional ISO date
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

// ── Interview prep ──
// One row per distinct practiceable question — the single source of truth shared by
// the generic (coding / system design) and company-specific views. `companies` tags
// which company lenses feature it; `[]` = generic-only. Like `todos`, prep is a
// personal scratchpad and does NOT write to the `events` change-log.
export const prepQuestions = sqliteTable("prep_questions", {
  id: text("id").primaryKey(), // stable slug, e.g. "kway", "lc-23", "news_agg"
  // coding / system_design = the shared generic banks; behavioral / other = company-specific
  // (bespoke technical, values/leadership) — these live only inside a company lens.
  track: text("track", { enum: ["coding", "system_design", "behavioral", "other"] }).notNull(),
  name: text("name").notNull(),
  prompt: text("prompt"),
  difficulty: text("difficulty"), // Easy | Medium | Hard | Mixed
  priority: text("priority"), // coding: TOP | ...
  url: text("url"),
  leetcodeNum: integer("leetcode_num"),
  tags: text("tags"), // JSON string[]
  companies: text("companies"), // JSON string[] of company slugs; [] = generic-only
  // Per-company framing: { [slug]: { category, sortOrder, note } }. Lets ONE shared question
  // (e.g. an LC problem) sit under a different category per company while keeping one row +
  // one shared attempt history. `companies` stays the membership/filter list; this adds grouping.
  companyMeta: text("company_meta"), // JSON { [slug]: { category, sortOrder, note } }
  content: text("content"), // JSON blob: why/note/approach/followUps/gotchas/keyComponents/deepDive/category/tier
  plan: text("plan"), // JSON { day, week, pattern, anchor, extra } — coding curriculum grouping
  sortOrder: integer("sort_order"),
});

// One row per company you're prepping for — the research output the agent writes (see the
// prep-research job). The catalog of questions stays in prep_questions; this holds the
// company-specific narrative + the ordered category list its view is built from. Keyed by
// the same slug used in prepQuestions.companies / companyMeta (canonical company key).
export const prepCompany = sqliteTable("prep_company", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  overview: text("overview"), // markdown — product/company overview (what they build, who for, why it matters)
  process: text("process"), // markdown — interview-process overview
  rounds: text("rounds"), // JSON [{ key, name, format, focus }] — key links questions to a round
  categories: text("categories"), // JSON [{ key, label, description, kind }] — ordered; drives the view's sections
  sources: text("sources"), // JSON [{ label, url }] — where the intel came from
  researchedAt: text("researched_at"), // ISO; last time the agent refreshed this profile
});

// Per-(company, round) feedback you leave on the prep — appended to a thread and dispatched to
// The agent as a prep-research refinement job. `status` tracks the loop: queued → applied once the agent
// re-researches that round. Like the rest of prep, a personal scratchpad (no events log).
export const prepFeedback = sqliteTable("prep_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(), // company slug (prepCompany.slug)
  round: text("round"), // round key (prepCompany.rounds[].key); null = whole-company feedback
  text: text("text").notNull(),
  status: text("status", { enum: ["queued", "applied"] }).notNull().default("queued"),
  jobId: text("job_id"), // the prep-research job this feedback dispatched
  createdAt: text("created_at").notNull(), // ISO
  appliedAt: text("applied_at"), // ISO; stamped when the agent's refresh lands
});

// Append-only practice log. Powers "how many times" (count) and "time record" (min duration).
export const prepAttempts = sqliteTable("prep_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: text("question_id")
    .notNull()
    .references(() => prepQuestions.id),
  attemptedAt: text("attempted_at").notNull(), // ISO timestamp
  durationSec: integer("duration_sec"),
  status: text("status", { enum: ["solved", "partial", "failed"] }).notNull().default("solved"),
  notes: text("notes"),
});

// Per-question flags (mirrors the artifact's "noted" + "redo queue").
export const prepProgress = sqliteTable("prep_progress", {
  questionId: text("question_id")
    .primaryKey()
    .references(() => prepQuestions.id),
  noted: integer("noted", { mode: "boolean" }).notNull().default(false), // notes written up
  redo: integer("redo", { mode: "boolean" }).notNull().default(false), // in redo queue
  redoAddedAt: text("redo_added_at"),
  updatedAt: text("updated_at"),
});

// The unified posting model — ONE row per (company, ATS job id) spanning the whole lifecycle, from
// raw watchlist-scan output through the tracker. A scan produces hundreds of rows per company (most
// stay `filtered`); a posting advances through `state` (the single lifecycle field) as it's
// triaged, assessed, tailored, applied, interviewed… Re-scans upsert + refresh the verdict but
// preserve the triage `state`. Funnel = pre-apply states; board/tracker = applied-onward states.
export const postings = sqliteTable("postings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  atsId: text("ats_id"), // stable ATS job id — the dedup key
  title: text("title").notNull(),
  location: text("location"),
  url: text("url"),
  department: text("department"),
  // verdict + reason are DISPLAY ANNOTATIONS only (why the pre-filter kept/dropped a row) — `state`
  // alone decides which lifecycle step a posting sits in. See the `state` note below.
  verdict: text("verdict", { enum: POSTING_VERDICTS }).notNull(),
  reason: text("reason"), // null when kept; discipline | location | level | dedup when dropped
  // The pipeline stage — the SINGLE source of truth for where a posting sits, spanning the whole
  // lifecycle (the discovery funnel + the tracker, being unified into this one model — see
  // docs/unify-postings-plan.md). Pre-filter: filtered · matched. Glance: review · dismissed ·
  // fit_queue. Fit: assessed · apply_later. Tailor: tailoring · tailored. Tracker: applied ·
  // interview · offer · accepted · rejected · ghost · withdrawn · company_skipped · expired.
  state: text("state", { enum: POSTING_STATES }).notNull().default("filtered"),
  fitScore: integer("fit_score"),
  fitDetail: text("fit_detail"), // JSON FitAssessment blob (mirrors applications.fit_detail)
  jd: text("jd"), // the posting's job description — fetched once (scan or fit) and reused by fit + tailoring
  resumeDir: text("resume_dir"), // per-candidate tailoring folder once tailored (latest version)
  // The résumé you've chosen to submit — "base" (the untailored résumé) or a specific version's slug.
  // Deliberately NOT defaulted to the latest version: you pick it explicitly in the drawer.
  chosenResume: text("chosen_resume"),
  editedResumes: text("edited_resumes"), // JSON string[] of version slugs you've manually edited by hand
  // JSON { applied?, rejected?, offer?, interview? } → Gmail thread id for the email that drove that
  // stage (from inbox-sync). Lets the tracker deep-link straight to the email; null = none captured.
  emailRefs: text("email_refs"),
  // The redo conversation: a JSON RedoTurn[] alternating agent⇄user, one logical thread per phase
  // (fit / tailor). Seeded by the agent's first result, then a user redo note, then the agent's
  // next versioned result… Each agent turn IS a version; the live fit_detail/resume_dir project the
  // latest. Powers "redo with a note" — the agent replays the whole thread on its next run.
  redoLog: text("redo_log"), // JSON RedoTurn[]
  // Versioned interview briefs (the agent-generated from the interview-prep asset folder). JSON
  // InterviewBrief[] oldest→newest; each generation appends a version. See shared/src/jobs/briefs.ts.
  interviewBriefs: text("interview_briefs"), // JSON InterviewBrief[]
  comments: text("comments"), // JSON Comment[] — your personal comment thread on this posting
  scannedAt: text("scanned_at").notNull(),
  // Tracker fields (folded in from `applications` for the unified model; populated at Stage 2).
  level: text("level"), // Staff, Senior, ...
  team: text("team"), // Infra, Ads, Platform, ...
  source: text("source"), // greenhouse | ashby | inbox | manual | ...
  channel: text("channel", { enum: POSTING_CHANNELS }),
  note: text("note"),
  // First-hand interview intel you collect in the Interviewing stage (markdown). `comp` = comp
  // structure (funding/runway, base, bonus, equity); `teamNotes` = team / product / work / role
  // focus. Distinct from the short `team` department tag above. Feeds the prep-research job as
  // recruiter-confirmed ground truth (see backend/src/jobs/store.ts queuePrepResearch).
  comp: text("comp"),
  teamNotes: text("team_notes"),
  interviewed: integer("interviewed", { mode: "boolean" }).notNull().default(false),
  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false), // user-pinned → floats to the top of its stage table
  historical: integer("historical", { mode: "boolean" }).notNull().default(false),
  discoveredAt: text("discovered_at"),
  appliedDate: text("applied_date"),
  updatedAt: text("updated_at"),
  postedAt: text("posted_at"), // ATS posted/published date (from the scan), when available
});

// ── Fit labeling / eval set ─────────────────────────────────────────────────────────────────
// The accumulated fit-assessment labels: per-criterion verdicts plus the human overrides that ARE
// the eval set. Written by the former standalone Fit Lab (now removed); retained as the eval store
// while fit is redesigned, and read via packages/core/src/fitlab/store.ts. Separate from the live
// discovery/fit flow (postings.fit_detail), which stays a holistic FitAssessment blob.
//
// The rubric: stable criterion *categories* (level-match, must-have-coverage, …). Per-posting
// requirement *instances* roll up into these so verdicts aggregate across runs (the thing that
// makes precision/recall computable). type drives scoring: gate = veto, must/nice/signal = weighted.
export const fitCriteria = sqliteTable("fit_criteria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(), // stable slug, e.g. "level-match"
  label: text("label").notNull(),
  type: text("type").notNull().default("must"), // gate | must | nice | signal
  weight: integer("weight").notNull().default(1), // relative weight in the score (gates excluded — they veto)
  definition: text("definition"), // the judging instruction handed to the LLM for this criterion
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

// One assessment of one posting. `stages` holds the per-stage trace (extract artifact + timings)
// so the trace view can replay the item's journey through the pipeline. score/decision are the
// deterministic aggregate over the verdicts (recomputed when a human override lands).
export const fitRuns = sqliteTable("fit_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postingId: integer("posting_id"), // nullable — the lab also accepts a pasted JD
  company: text("company").notNull(),
  role: text("role").notNull(),
  jd: text("jd").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  score: integer("score"), // 0–100, derived from verdicts
  decision: text("decision"), // advance | review | drop
  stages: text("stages"), // JSON StageTrace[] — the trace
  createdAt: text("created_at").notNull(),
});

// One per-criterion verdict from the Detect stage. The human override (humanVerdict/humanNote) is
// the LABEL — verdicts where humanVerdict is set are the eval/training set the locked nodes consume.
export const fitVerdicts = sqliteTable("fit_verdicts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull().references(() => fitRuns.id),
  criterionKey: text("criterion_key").notNull(),
  requirement: text("requirement"), // the JD requirement(s) extracted for this criterion
  type: text("type").notNull(), // snapshot of the criterion type at run time
  verdict: text("verdict").notNull(), // met | partial | unmet | unclear | na
  confidence: integer("confidence"), // 0–100 (model's self-reported)
  evidence: text("evidence"), // quote/pointer from the resume
  reasoning: text("reasoning"),
  humanVerdict: text("human_verdict"), // your override = the label
  humanNote: text("human_note"),
  labeledAt: text("labeled_at"),
});

export type FitCriterionRow = typeof fitCriteria.$inferSelect;
export type FitRunRow = typeof fitRuns.$inferSelect;
export type FitVerdictRow = typeof fitVerdicts.$inferSelect;

export type PrepQuestionRow = typeof prepQuestions.$inferSelect;
export type PrepCompanyRow = typeof prepCompany.$inferSelect;
export type PrepFeedbackRow = typeof prepFeedback.$inferSelect;
export type PrepAttemptRow = typeof prepAttempts.$inferSelect;
export type PrepProgressRow = typeof prepProgress.$inferSelect;

export type CompanyRow = typeof companies.$inferSelect;
export type TodoRow = typeof todos.$inferSelect;
export type PendingMatchRow = typeof pendingMatches.$inferSelect;
export type InterviewRow = typeof interviews.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type PostingRow = typeof postings.$inferSelect;
export type ThreadRow = typeof threads.$inferSelect;
export type ThreadStepRow = typeof threadSteps.$inferSelect;
