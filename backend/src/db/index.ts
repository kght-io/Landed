import path from "node:path";
import fs from "node:fs";
import { repoPath } from "../paths";
import Database from "better-sqlite3";
import { addColumn } from "./add-column";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import {
  POSTING_STATES, POSTING_VERDICTS, POSTING_CHANNELS, COMPANY_TIERS,
  JOB_STATUSES, PENDING_KINDS, PENDING_STATUSES,
} from "@landed/shared/db/enums";

// DB lives at the REPO ROOT (gitignored), NOT in iCloud — see config discussion. Anchored on
// REPO_ROOT rather than cwd: `next dev` runs with cwd = apps/web, which would open a second,
// empty DB under the frontend workspace.
const DB_PATH = process.env.DB_PATH || repoPath("data", "jobhunt.db");

// Cache the connection across Next.js hot reloads.
const globalForDb = globalThis as unknown as { _sqlite?: Database.Database };

function connection() {
  if (globalForDb._sqlite) return globalForDb._sqlite;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Fold the WAL into the main .db file frequently so the file stays current —
  // otherwise a plain cp backup captures a stale snapshot (learned the hard way).
  sqlite.pragma("wal_autocheckpoint = 100");
  // Base schema — created on a fresh DB so a clean clone is self-bootstrapping (drizzle-kit
  // push is flaky in this project, so we don't rely on it). These mirror the Drizzle schema in
  // ./schema.ts (the ORM source of truth); the per-column ALTERs further down idempotently add
  // anything newer, and enumGuard() below enforces the enum sets. All `IF NOT EXISTS`, so an
  // existing DB is untouched. (Tests bootstrap through this same path — there is no separate
  // schema.sql to keep in sync.)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'tier3',
    careers_url TEXT,
    ats TEXT,
    notes TEXT
  )`);
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS companies_name_unique ON companies(name)");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'You',
    source TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    summary TEXT
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES postings(id),
    round INTEGER,
    kind TEXT,
    date TEXT,
    outcome TEXT,
    notes TEXT
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'You',
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL,
    ingested_at TEXT,
    summary TEXT
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    inserted INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    field_changes INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    new_companies INTEGER NOT NULL DEFAULT 0,
    summary TEXT
  )`);
  // Lightweight bootstrap for tables added after the initial schema (drizzle-kit push
  // is flaky in this project — see notes). Idempotent.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS pending_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    source TEXT NOT NULL,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    company_name TEXT NOT NULL,
    signature TEXT NOT NULL,
    payload TEXT NOT NULL,
    candidate_ids TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'match',
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_app_id INTEGER,
    resolved_at TEXT
  )`);
  // `kind` was added after pending_matches shipped — backfill it on existing DBs (idempotent).
  {
    const pmCols = new Set(
      (sqlite.prepare("PRAGMA table_info(pending_matches)").all() as { name: string }[]).map((r) => r.name)
    );
    if (!pmCols.has("kind")) addColumn(sqlite, `ALTER TABLE pending_matches ADD COLUMN kind TEXT NOT NULL DEFAULT 'match'`);
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    due TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS prep_questions (
    id TEXT PRIMARY KEY,
    track TEXT NOT NULL,
    name TEXT NOT NULL,
    prompt TEXT,
    difficulty TEXT,
    priority TEXT,
    url TEXT,
    leetcode_num INTEGER,
    tags TEXT,
    companies TEXT,
    content TEXT,
    plan TEXT,
    sort_order INTEGER
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS prep_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT NOT NULL REFERENCES prep_questions(id),
    attempted_at TEXT NOT NULL,
    duration_sec INTEGER,
    status TEXT NOT NULL DEFAULT 'solved',
    notes TEXT
  )`);
  // Unify: the discovery/tracker store is now `postings` (renamed from `candidates`). Rename in
  // place on existing DBs so the 2.9k rows carry over; fresh DBs get the name from the CREATE below.
  if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='candidates'").get()
      && !sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='postings'").get()) {
    sqlite.exec("ALTER TABLE candidates RENAME TO postings");
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS postings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    ats_id TEXT,
    title TEXT NOT NULL,
    location TEXT,
    url TEXT,
    department TEXT,
    verdict TEXT NOT NULL,
    reason TEXT,
    state TEXT NOT NULL DEFAULT 'new',
    scanned_at TEXT NOT NULL,
    UNIQUE(company_id, ats_id)
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS prep_progress (
    question_id TEXT PRIMARY KEY REFERENCES prep_questions(id),
    noted INTEGER NOT NULL DEFAULT 0,
    redo INTEGER NOT NULL DEFAULT 0,
    redo_added_at TEXT,
    updated_at TEXT
  )`);
  // Per-company prep profile (the agent research output). Keyed by canonical company slug.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS prep_company (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    process TEXT,
    rounds TEXT,
    categories TEXT,
    sources TEXT,
    researched_at TEXT
  )`);
  // overview added to prep_company after it shipped — product/company summary (idempotent ALTER).
  {
    const pcCols = new Set(
      (sqlite.prepare("PRAGMA table_info(prep_company)").all() as { name: string }[]).map((r) => r.name)
    );
    if (pcCols.size && !pcCols.has("overview")) addColumn(sqlite, `ALTER TABLE prep_company ADD COLUMN overview TEXT`);
  }
  // Per-(company, round) prep feedback thread → dispatched to the agent as a prep-research refinement.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS prep_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    round TEXT,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    job_id TEXT,
    created_at TEXT NOT NULL,
    applied_at TEXT
  )`);
  // company_meta added to prep_questions after the initial schema (idempotent ALTER).
  const prepQCols = new Set(
    (sqlite.prepare("PRAGMA table_info(prep_questions)").all() as { name: string }[]).map((r) => r.name)
  );
  if (!prepQCols.has("company_meta")) addColumn(sqlite, `ALTER TABLE prep_questions ADD COLUMN company_meta TEXT`);
  // The jobs table became the live queue (not just an ingest ledger) — add the spec/payload
  // columns. Idempotent: only ALTER for columns the table doesn't already have.
  const jobCols = new Set(
    (sqlite.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((r) => r.name)
  );
  for (const [name, ddl] of [
    ["playbook", "playbook TEXT"],
    ["task", "task TEXT"],
    ["params", "params TEXT"],
    ["result", "result TEXT"],
    ["claimed_at", "claimed_at TEXT"], // agent-claim timestamp (status wip)
    ["claimed_by", "claimed_by TEXT"], // who claimed it
    ["thread_id", "thread_id TEXT"], // the agent chat (thread) that claimed it — see threads table
    ["attempts", "attempts INTEGER NOT NULL DEFAULT 0"], // claims so far — stuck-job detection
    ["error", "error TEXT"], // dead-letter reason (auto "stuck after N attempts" or agent-reported)
  ] as const) {
    if (!jobCols.has(name)) addColumn(sqlite, `ALTER TABLE jobs ADD COLUMN ${ddl}`);
  }
  // The agent threads: one row per agent chat (= one MCP server process) + its per-call trace.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    label TEXT,
    pid INTEGER,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    steps INTEGER NOT NULL DEFAULT 0,
    dismissed_at TEXT
  )`);
  // dismissed_at added after threads shipped — backfill on existing DBs (idempotent).
  {
    const thCols = new Set(
      (sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[]).map((r) => r.name)
    );
    if (thCols.size && !thCols.has("dismissed_at")) addColumn(sqlite, "ALTER TABLE threads ADD COLUMN dismissed_at TEXT");
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS thread_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    tool TEXT NOT NULL,
    job_id TEXT,
    ok INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    summary TEXT
  )`);
  // Fit labeling / eval set — per-criterion verdicts + the human labels. Own tables, separate from
  // the live discovery/fit flow. See packages/core/src/fitlab/ and db/schema.ts.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS fit_criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'must',
    weight INTEGER NOT NULL DEFAULT 1,
    definition TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS fit_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    posting_id INTEGER,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    jd TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    score INTEGER,
    decision TEXT,
    stages TEXT,
    created_at TEXT NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS fit_verdicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES fit_runs(id),
    criterion_key TEXT NOT NULL,
    requirement TEXT,
    type TEXT NOT NULL,
    verdict TEXT NOT NULL,
    confidence INTEGER,
    evidence TEXT,
    reasoning TEXT,
    human_verdict TEXT,
    human_note TEXT,
    labeled_at TEXT
  )`);
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_fit_verdicts_run ON fit_verdicts(run_id)");

  // Target scrape config + search criteria on companies (the agent curates via upsertCompanies).
  const coCols = new Set(
    (sqlite.prepare("PRAGMA table_info(companies)").all() as { name: string }[]).map((r) => r.name)
  );
  for (const [name, ddl] of [
    ["fetch_method", "fetch_method TEXT"],
    ["fetch_recipe", "fetch_recipe TEXT"],
    ["slug", "slug TEXT"],
    ["endpoint", "endpoint TEXT"],
    ["target_titles", "target_titles TEXT"],
    ["target_location", "target_location TEXT"],
    ["leveling", "leveling TEXT"],
    ["last_scraped_at", "last_scraped_at TEXT"],
    ["watchlist", "watchlist INTEGER NOT NULL DEFAULT 0"],
    ["created_at", "created_at TEXT"], // company-record audit timestamps (curation, not auto-scrape)
    ["updated_at", "updated_at TEXT"],
  ] as const) {
    if (!coCols.has(name)) addColumn(sqlite, `ALTER TABLE companies ADD COLUMN ${ddl}`);
  }
  // postings gained the fit phase (fit_score/fit_detail/resume_dir/jd) and then the unified
  // tracker fields (folded in from `applications` — see docs/unify-postings-plan.md) — add if missing.
  const candCols = new Set(
    (sqlite.prepare("PRAGMA table_info(postings)").all() as { name: string }[]).map((r) => r.name)
  );
  for (const [name, ddl] of [
    ["fit_score", "fit_score INTEGER"],
    ["fit_detail", "fit_detail TEXT"],
    ["resume_dir", "resume_dir TEXT"],
    ["jd", "jd TEXT"],
    ["level", "level TEXT"],
    ["team", "team TEXT"],
    ["source", "source TEXT"],
    ["channel", "channel TEXT"],
    ["note", "note TEXT"],
    ["interviewed", "interviewed INTEGER NOT NULL DEFAULT 0"],
    ["needs_review", "needs_review INTEGER NOT NULL DEFAULT 0"],
    ["pinned", "pinned INTEGER NOT NULL DEFAULT 0"],
    ["chosen_resume", "chosen_resume TEXT"],
    ["edited_resumes", "edited_resumes TEXT"],
    ["email_refs", "email_refs TEXT"],
    ["historical", "historical INTEGER NOT NULL DEFAULT 0"],
    ["discovered_at", "discovered_at TEXT"],
    ["applied_date", "applied_date TEXT"],
    ["updated_at", "updated_at TEXT"],
    ["redo_log", "redo_log TEXT"],
    ["interview_briefs", "interview_briefs TEXT"], // versioned the agent-generated interview briefs
    ["comments", "comments TEXT"],
    ["comp", "comp TEXT"], // interview comp-structure intel (markdown)
    ["team_notes", "team_notes TEXT"], // team / product / work intel (markdown)
    ["posted_at", "posted_at TEXT"], // ATS posted/published date (Ashby publishedAt / Greenhouse updated_at), when available
  ] as const) {
    if (!candCols.has(name)) addColumn(sqlite, `ALTER TABLE postings ADD COLUMN ${ddl}`);
  }
  // interviews gained a per-round Gmail thread id (inbox-sync), then the round's substance captured
  // by interview-emails (who / when exactly / what to expect) — add whichever are missing.
  {
    const ivCols = new Set(
      (sqlite.prepare("PRAGMA table_info(interviews)").all() as { name: string }[]).map((r) => r.name)
    );
    for (const [name, ddl] of [
      ["email_id", "email_id TEXT"],
      ["start_time", "start_time TEXT"],
      ["duration_mins", "duration_mins INTEGER"],
      ["timezone", "timezone TEXT"],
      ["interviewers", "interviewers TEXT"],
      ["format", "format TEXT"],
      ["join_url", "join_url TEXT"],
      ["what_to_expect", "what_to_expect TEXT"],
      ["prep_notes", "prep_notes TEXT"],
    ] as const) {
      if (ivCols.size && !ivCols.has(name)) addColumn(sqlite, `ALTER TABLE interviews ADD COLUMN ${ddl}`);
    }
  }
  // ── Indexes ──────────────────────────────────────────────────────────────────────────────
  // postings is the scan firehose (mostly `filtered`); every funnel/board/tracker query scopes
  // by stage + company.
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_candidates_state ON postings(state)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_candidates_company ON postings(company_id)");
  // events is append-only and grows unbounded; the Changes feed reads it newest-first and by
  // entity, so index the sort key and the (entity, entity_id) lookup.
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity, entity_id)");
  // Hot status/queue + FK-target lookups.
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_jobs_thread ON jobs(thread_id)");
  // Thread timeline reads newest-first, scoped by thread; the prune in recordStep scans by ts.
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_thread_steps_thread ON thread_steps(thread_id, ts)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_thread_steps_ts ON thread_steps(ts)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_threads_seen ON threads(last_seen_at)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_matches(status)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_pending_company ON pending_matches(company_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_prep_attempts_question ON prep_attempts(question_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_prep_feedback_slug ON prep_feedback(slug)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_interviews_application ON interviews(application_id)");

  // ── One-time data migrations (version-gated) ─────────────────────────────────────────────
  // Structural CREATE/ALTER above is idempotent and runs every boot; these rewrite *data*, so we
  // gate them on PRAGMA user_version to run once (not on every connection) and to make ordering
  // explicit. Each is also idempotent on its own — the gate is belt-and-suspenders.
  const SCHEMA_VERSION = 1;
  const userVersion = sqlite.pragma("user_version", { simple: true }) as number;
  if (userVersion < 1) {
    // v1: tier values renamed top_target/target/practice → tier1/tier2/tier3 (stable slugs).
    sqlite.exec("UPDATE companies SET tier='tier1' WHERE tier='top_target'");
    sqlite.exec("UPDATE companies SET tier='tier2' WHERE tier='target'");
    sqlite.exec("UPDATE companies SET tier='tier3' WHERE tier='practice'");
    // v1: `state` became the single source of truth for the funnel step (was derived from verdict).
    //   tracked/queued → fit_queue;  new+kept → matched;  new+dropped → filtered;
    //   tailoring + a resume slug → tailored.
    sqlite.exec("UPDATE postings SET state='fit_queue' WHERE state IN ('tracked','queued')");
    sqlite.exec("UPDATE postings SET state='matched'  WHERE state='new' AND verdict='kept'");
    sqlite.exec("UPDATE postings SET state='filtered' WHERE state='new' AND verdict='dropped'");
    sqlite.exec("UPDATE postings SET state='tailored' WHERE state='tailoring' AND resume_dir IS NOT NULL");
  }
  if (userVersion < SCHEMA_VERSION) sqlite.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  // ── Enum enforcement ─────────────────────────────────────────────────────────────────────
  // SQLite can't ALTER a table to ADD a CHECK constraint, so we enforce the enum sets with
  // BEFORE INSERT/UPDATE triggers — rebuilt (DROP+CREATE) from the arrays in ./enums on every
  // boot, so DB enforcement can't drift from the ORM types. Out-of-set writes RAISE(ABORT). This
  // matters most for `postings.state` and `companies.tier`, which the agent writes over MCP.
  const enumGuard = (table: string, cols: { col: string; values: readonly string[]; nullable?: boolean }[]) => {
    const quoted = (vs: readonly string[]) => vs.map((v) => `'${v}'`).join(",");
    const whens = cols
      .map(({ col, values, nullable }) =>
        `WHEN ${nullable ? `NEW.${col} IS NOT NULL AND ` : ""}NEW.${col} NOT IN (${quoted(values)}) ` +
        `THEN RAISE(ABORT, '${table}.${col}: value not in allowed set')`)
      .join("\n        ");
    for (const op of ["INSERT", "UPDATE"] as const) {
      const name = `ck_${table}_${op.toLowerCase()}`;
      sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`);
      try {
        sqlite.exec(`CREATE TRIGGER ${name} BEFORE ${op} ON ${table} BEGIN\n      SELECT CASE\n        ${whens}\n      END;\n    END`);
      } catch (e) {
        // Concurrent boots (e.g. `next build`'s parallel page-data workers) can interleave another
        // process's DROP+CREATE between ours — losing the race surfaces as "trigger already exists".
        // The trigger body is deterministic, so a redundant create is a no-op: tolerate it.
        if (!String((e as Error)?.message).includes("already exists")) throw e;
      }
    }
  };
  enumGuard("postings", [
    { col: "state", values: POSTING_STATES },
    { col: "verdict", values: POSTING_VERDICTS },
    { col: "channel", values: POSTING_CHANNELS, nullable: true },
  ]);
  enumGuard("companies", [{ col: "tier", values: COMPANY_TIERS }]);
  enumGuard("jobs", [{ col: "status", values: JOB_STATUSES }]);
  enumGuard("pending_matches", [
    { col: "kind", values: PENDING_KINDS },
    { col: "status", values: PENDING_STATUSES },
  ]);

  // ── Optional events retention ────────────────────────────────────────────────────────────
  // The audit log is kept forever by default. Set EVENTS_RETENTION_DAYS to prune older rows on
  // boot (cheap with idx_events_ts). Unset / non-positive = never prune.
  const retDays = Number(process.env.EVENTS_RETENTION_DAYS);
  if (Number.isFinite(retDays) && retDays > 0) {
    const cutoff = new Date(Date.now() - retDays * 86_400_000).toISOString();
    sqlite.prepare("DELETE FROM events WHERE ts < ?").run(cutoff);
  }

  globalForDb._sqlite = sqlite;
  return sqlite;
}

export const db = drizzle(connection(), { schema });
export { schema };
