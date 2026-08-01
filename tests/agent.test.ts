import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, seedCandidate, approveSyncedChanges, db, jobs, postings, events, companies } from "./helpers";
import { submitJobResult, createJob, claimJob, deleteQueuedJob, listJobs, listFitQueue, enqueueFit, inboxLastSynced, queueStaleWatchlistScans, enqueueDailyInboxSync } from "@landed/backend/jobs/store";
import { listPostings, listScannedPostings, upsertCompanies, setWatchlist, listCompanies, listWatchlist, updateApplication, listPendingMatches, addComment, deleteComment, getPosting } from "@landed/backend/db/queries";
import { resolvePendingMatch } from "@landed/backend/agents/reconcile";

const find = (company: string, role?: string) =>
  listPostings().find((p) => p.company === company && (role === undefined || p.role === role));

beforeEach(() => reset());

const stateOf = (id: number) => db.select().from(postings).where(eq(postings.id, id)).get()!.state;
// ALL postings for Reddit (any stage) — listPostings is tracker-only, so query the table directly.
const redditRows = () => {
  const co = db.select().from(companies).all().find((c) => c.name === "Reddit");
  return co ? db.select().from(postings).where(eq(postings.companyId, co.id)).all() : [];
};

// --- fuzzy inbox matching → human approval, never a silent guess ---------------------------

test("fuzzy 'applied' (email missing the team) raises a pending match against a tailoring candidate — no auto-apply, no duplicate", () => {
  const id = seedCandidate({ company: "Reddit", title: "Senior Software Engineer, Ads", state: "tailoring" });

  submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-fuzzy",
    records: [{ company: "Reddit", role: "Senior Software Engineer", status: "applied", appliedDate: "2026-06-25" }],
  });

  const pend = listPendingMatches();
  assert.equal(pend.length, 1);
  assert.equal(pend[0].kind, "match");
  assert.ok(pend[0].candidates.some((c) => c.id === id)); // the tailoring row is offered
  // The candidate was NOT auto-applied and no duplicate row was inserted.
  assert.equal(stateOf(id), "tailoring");
  assert.equal(db.select().from(postings).where(eq(postings.companyId, db.select().from(postings).where(eq(postings.id, id)).get()!.companyId)).all().length, 1);
});

test("fuzzy pool excludes tracker stages — a non-exact 'applied' never re-points an already-applied row (inserts new instead)", () => {
  seedApp({ company: "Reddit", role: "Senior Software Engineer, Ads", status: "applied" });

  submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-fuzzy-tracker",
    records: [{ company: "Reddit", role: "Senior Software Engineer", status: "applied", appliedDate: "2026-06-25" }],
  });

  // The applied row is not a fuzzy candidate, so this is a NEW posting — proposed as a create
  // (an inbox sync writes nothing unapproved), never offered as "does this belong to the applied row?".
  const pend = listPendingMatches();
  assert.equal(pend.length, 1);
  assert.equal(pend[0].kind, "change");
  assert.equal(pend[0].create, true);
  approveSyncedChanges();
  assert.equal(redditRows().length, 2); // → a separate posting
});

test("weak title overlap (shared leading word only) is NOT a fuzzy match → a new posting, never a 'which one?'", () => {
  seedCandidate({ company: "Reddit", title: "Senior Data Scientist", state: "tailoring" });

  submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-weak",
    records: [{ company: "Reddit", role: "Senior Software Engineer", status: "applied", appliedDate: "2026-06-25" }],
  });

  const pend = listPendingMatches();
  assert.equal(pend.length, 1);
  assert.equal(pend[0].kind, "change");
  assert.equal(pend[0].create, true, "a create proposal, not a match to the Data Scientist row");
  approveSyncedChanges();
  assert.equal(redditRows().length, 2);
});

// --- fit/tailor result with an unresolvable id → unbound approval (dismiss-only) -----------

test("a tailoring result whose echoed id doesn't exist raises an 'unbound' approval (not a silent skip); dismiss clears it", () => {
  seedCandidate({ company: "Reddit", title: "Senior Software Engineer", state: "tailoring" }); // makes the company exist

  submitJobResult({
    type: "tailoring",
    jobId: "tailor-bad-id",
    records: [{ id: 999999, company: "Reddit", role: "Ghost Role", slug: "reddit-ghost/v1", diff: [{ type: "eq", text: "EXPERIENCE" }] }],
  });

  const pend = listPendingMatches();
  const unbound = pend.find((p) => p.kind === "unbound");
  assert.ok(unbound, "expected an unbound pending item");
  assert.match(unbound!.detail ?? "", /couldn't find posting #999999/);

  const r = resolvePendingMatch(unbound!.id, "dismiss");
  assert.equal(r.ok, true);
  assert.equal(listPendingMatches().length, 0);
});

// --- inbox-sync graduates a pre-apply candidate in place (no duplicate) -------------------

test("inbox-sync 'applied' matches an existing tailoring candidate and advances it in place, preserving its resume — no duplicate row", () => {
  const id = seedCandidate({ company: "Reddit", title: "Senior Software Engineer", state: "tailoring" });
  db.update(postings).set({ resumeDir: "reddit-senior-9/v2" }).where(eq(postings.id, id)).run();

  const out = submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-sync-reddit",
    records: [{ company: "Reddit", role: "Senior Software Engineer", status: "applied", appliedDate: "2026-06-25" }],
  });
  assert.equal(out.type, "inbox-sync");
  assert.equal(approveSyncedChanges(), 1);

  // Same single Reddit posting — graduated tailoring → applied, resume kept (not a fresh insert).
  const reddit = db.select().from(postings).where(eq(postings.companyId, db.select().from(postings).where(eq(postings.id, id)).get()!.companyId)).all();
  assert.equal(reddit.length, 1);
  const row = reddit[0];
  assert.equal(row.id, id);
  assert.equal(row.state, "applied");
  assert.equal(row.resumeDir, "reddit-senior-9/v2");
  assert.equal(row.appliedDate, "2026-06-25");
});

test("a rejection never inserts a new posting when the company has one — it raises a confirm (pending match), then resolving it applies the rejection", () => {
  // One Globex posting in the interview stage, stored title "Senior Platform Engineer".
  const id = seedApp({ company: "Globex", role: "Senior Platform Engineer", status: "interview", interviewed: true });
  const companyId = db.select().from(postings).where(eq(postings.id, id)).get()!.companyId;

  // A rejection email with a generic, non-matching role ("Software Engineer"). The role doesn't match
  // exactly, so it's NOT auto-applied — but it must NOT spawn a duplicate either. It parks a pending
  // match against the existing posting for the user to confirm.
  submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-sync-globex",
    records: [{ company: "Globex", role: "Software Engineer", status: "rejected" }],
  });

  const rows = db.select().from(postings).where(eq(postings.companyId, companyId)).all();
  assert.equal(rows.length, 1, "no duplicate posting inserted");
  assert.equal(rows[0].state, "interview", "not auto-applied — awaits confirmation");

  const pending = listPendingMatches().filter((m) => m.companyName === "Globex");
  assert.equal(pending.length, 1, "a pending match was raised");
  assert.equal(pending[0].incoming.status, "rejected");
  assert.deepEqual(pending[0].candidates.map((c) => c.id), [id], "the existing posting is the candidate");

  // Confirming the match applies the rejection onto the existing posting.
  const res = resolvePendingMatch(pending[0].id, "apply", id);
  assert.equal(res.ok, true);
  const after = db.select().from(postings).where(eq(postings.id, id)).get()!;
  assert.equal(after.state, "rejected");
  assert.equal(after.interviewed, true, "interviewed flag preserved");
});

// --- change-log actor attribution (the agent's MCP edits vs the app UI) ----------------------

test("updateApplication attributes the change-log event to the passed actor (the agent), not the You default", () => {
  seedApp({ company: "Rokt", role: "Senior Software Engineer", status: "interview", interviewed: true });
  const id = Number(find("Rokt")!.id);

  // The agent edit (MCP path passes actor) → the agent / cowork, never the human default.
  updateApplication(id, { status: "rejected" }, "CoWork");
  const ev = db.select().from(events).where(eq(events.entityId, id)).all().at(-1)!;
  assert.equal(ev.actor, "CoWork");
  assert.equal(ev.source, "cowork");

  // App-UI edit (no actor) stays attributed to the human.
  updateApplication(id, { note: "manual fix" });
  const ui = db.select().from(events).where(eq(events.entityId, id)).all().at(-1)!;
  assert.equal(ui.actor, "You");
  assert.equal(ui.source, "ui");
});

// --- deleting a queued tailoring job un-queues a stuck candidate --------------------------

test("deleting a first-time tailoring job un-queues its candidate tailoring → assessed", () => {
  const id = seedCandidate({ company: "Vertex", title: "Senior SWE", state: "tailoring" });
  createJob({ id: `tailoring-app-${id}`, type: "tailoring", createdBy: "You", params: { postings: [{ id, company: "Vertex", role: "Senior SWE" }] } });

  assert.equal(deleteQueuedJob(`tailoring-app-${id}`), true);
  assert.equal(stateOf(id), "assessed"); // no longer stranded in "Queued for tailoring…"
  assert.equal(listJobs().some((j) => j.id === `tailoring-app-${id}`), false);
});

test("deleting a tailoring REDO job leaves the already-tailored candidate (resume + stage) intact", () => {
  const id = seedCandidate({ company: "Stripe", title: "SWE", state: "tailored" });
  // A tailored candidate with a pending redo note — the redo job runs against the existing resume.
  db.update(postings)
    .set({ resumeDir: "stripe-swe-v1", redoLog: JSON.stringify([{ phase: "tailor", role: "user", at: "2026-06-25T00:00:00.000Z", text: "tighten the summary" }]) })
    .where(eq(postings.id, id)).run();
  createJob({ id: `tailoring-app-${id}`, type: "tailoring", createdBy: "You", params: { postings: [{ id, company: "Stripe", role: "SWE" }] } });

  assert.equal(deleteQueuedJob(`tailoring-app-${id}`), true);
  const row = db.select().from(postings).where(eq(postings.id, id)).get()!;
  assert.equal(row.state, "tailored"); // stage untouched
  assert.equal(row.resumeDir, "stripe-swe-v1"); // resume kept
});

// --- inbox-sync: the core the agent → system loop -------------------------------------------

test("submitJobResult(inbox-sync) updates an existing posting, inserts a new one, advances the watermark, and records the ledger row", () => {
  seedApp({ company: "Cursor", role: "Software Engineer", status: "applied", interviewed: false });

  const out = submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-sync-1",
    records: [
      { company: "Cursor", role: "Software Engineer", status: "interviewing", interviewed: true, lastUpdate: "2026-06-18" },
      { company: "Anthropic", role: "Member of Technical Staff", status: "applied", appliedDate: "2026-06-17" },
    ],
  });
  assert.equal(out.type, "inbox-sync");

  // A sync proposes; nothing moves until you approve on the Changes page.
  assert.equal(find("Cursor", "Software Engineer")!.status, "applied", "held pending approval");
  assert.equal(approveSyncedChanges(), 2, "one update + one new posting to approve");

  // existing posting advanced applied → interview, interviewed flag set
  const cursor = find("Cursor", "Software Engineer")!;
  assert.equal(cursor.status, "interview");
  assert.equal(cursor.interviewed, true);

  // brand-new posting inserted
  const anthropic = find("Anthropic", "Member of Technical Staff");
  assert.ok(anthropic, "new posting inserted");
  assert.equal(anthropic!.status, "applied");

  // watermark advanced + ledger row recorded as ingested
  assert.ok(inboxLastSynced(), "inbox watermark set");
  const row = db.select().from(jobs).where(eq(jobs.id, "inbox-sync-1")).get();
  assert.equal(row?.status, "ingested", "job recorded as ingested");
});

test("dryRun is a pure preview: reports the changes but persists nothing", () => {
  seedApp({ company: "Cursor", role: "Software Engineer", status: "applied" });

  const before = listPostings().length;
  const preview = submitJobResult({
    type: "inbox-sync",
    dryRun: true,
    records: [
      { company: "Cursor", role: "Software Engineer", status: "interviewing", interviewed: true },
      { company: "NewCo", role: "Staff Engineer", status: "applied" },
    ],
  });

  // it computes the net change (an update + an insert)...
  assert.ok((preview.details?.length ?? 0) >= 2, "an update + an insert planned");

  // ...but the DB is untouched and no ledger row was written
  assert.equal(listPostings().length, before, "no rows inserted");
  assert.equal(find("Cursor", "Software Engineer")!.status, "applied", "status not changed");
  assert.ok(!inboxLastSynced(), "watermark not advanced");
  assert.equal(listJobs().length, 0, "no job recorded");
});

test("ingest is idempotent: re-submitting the same inbox result changes nothing", () => {
  seedApp({ company: "Cursor", role: "Software Engineer", status: "applied" });
  const records = [{ company: "Cursor", role: "Software Engineer", status: "interviewing", interviewed: true }];

  submitJobResult({ type: "inbox-sync", jobId: "inbox-a", records });
  approveSyncedChanges();
  const afterFirst = listPostings();

  submitJobResult({ type: "inbox-sync", jobId: "inbox-b", records }); // same payload, fresh job
  assert.equal(listPendingMatches().length, 0, "nothing left to change → nothing to approve");
  approveSyncedChanges();
  const afterSecond = listPostings();

  assert.equal(afterSecond.length, afterFirst.length, "no duplicate postings");
  assert.equal(find("Cursor", "Software Engineer")!.status, "interview");
});

test("sync never regresses status: an old 'applied' email cannot un-reject a closed posting", () => {
  seedApp({ company: "Cursor", role: "Software Engineer", status: "rejected", interviewed: true });
  submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-regress",
    records: [{ company: "Cursor", role: "Software Engineer", status: "applied" }],
  });
  assert.equal(find("Cursor", "Software Engineer")!.status, "rejected", "rejection preserved");
});

test("inbox-sync extracts interview rounds onto a posting, idempotently and additively", () => {
  seedApp({ company: "Cursor", role: "Software Engineer", status: "applied", interviewed: false });

  // First sync: two rounds arrive with the interview-stage transition.
  submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-rounds-1",
    records: [{
      company: "Cursor", role: "Software Engineer", status: "interviewing",
      interviews: [
        { round: 1, kind: "recruiter call", date: "2026-06-10", outcome: "passed" },
        { round: 2, kind: "technical", date: "2026-06-20", outcome: "pending" },
      ],
    }],
  });

  approveSyncedChanges();
  let cursor = find("Cursor", "Software Engineer")!;
  assert.equal(cursor.status, "interview");
  assert.equal(cursor.interviewed, true, "rounds imply interviewed");
  assert.equal(cursor.interviews?.length, 2, "two rounds attached");
  assert.equal(cursor.interviews?.[0].kind, "recruiter_screen", "kind normalized");
  assert.equal(cursor.interviews?.[1].outcome, "pending");

  // Re-sync the SAME rounds → no duplicates, no change.
  submitJobResult({ type: "inbox-sync", jobId: "inbox-rounds-2", records: [{
    company: "Cursor", role: "Software Engineer", status: "interviewing",
    interviews: [
      { round: 1, kind: "recruiter call", date: "2026-06-10", outcome: "passed" },
      { round: 2, kind: "technical", date: "2026-06-20", outcome: "pending" },
    ],
  }] });
  approveSyncedChanges();
  cursor = find("Cursor", "Software Engineer")!;
  assert.equal(cursor.interviews?.length, 2, "re-sync did not duplicate rounds");

  // Outcome update on round 2 + a new round 3 → round 2 updated in place, round 3 added.
  submitJobResult({ type: "inbox-sync", jobId: "inbox-rounds-3", records: [{
    company: "Cursor", role: "Software Engineer", status: "interviewing",
    interviews: [
      { round: 2, kind: "technical", date: "2026-06-20", outcome: "passed" },
      { round: 3, kind: "onsite", date: "2026-06-28", outcome: "pending" },
    ],
  }] });
  approveSyncedChanges();
  cursor = find("Cursor", "Software Engineer")!;
  assert.equal(cursor.interviews?.length, 3, "round 3 added");
  assert.equal(cursor.interviews?.find((r) => r.round === 2)?.outcome, "passed", "round 2 outcome updated in place");
});

// --- watchlist-scan --------------------------------------------------------------------

test("submitJobResult(watchlist-scan) lands surfaced postings as fit_queue candidates (not applications)", () => {
  submitJobResult({
    type: "watchlist-scan",
    jobId: "scan-1",
    records: [
      { company: "Ramp", role: "Backend Engineer", level: "Staff", url: "https://ramp.com/jobs/1" },
      { company: "Rippling", role: "Platform Engineer" },
    ],
  });

  // discovery is candidates — no applications created
  assert.equal(listPostings().length, 0, "no applications created by watchlist-scan");
  const queue = listScannedPostings({ state: "fit_queue" });
  const ramp = queue.find((c) => c.company === "Ramp" && c.title === "Backend Engineer");
  assert.ok(ramp, "fit_queue candidate created");
  assert.equal(ramp!.url, "https://ramp.com/jobs/1");
  assert.ok(queue.find((c) => c.company === "Rippling" && c.title === "Platform Engineer"));
});

// --- fit -------------------------------------------------------------------------------

test("submitJobResult(fit) scores a candidate and advances fit_queue → assessed", () => {
  const cid = seedCandidate({ company: "Cursor", title: "Software Engineer", state: "fit_queue" });
  submitJobResult({
    type: "fit",
    jobId: "fit-1",
    records: [
      { id: cid, company: "Cursor", role: "Software Engineer", fitScore: 82, levelMatch: { call: "match" }, recommendation: "tailor", summary: "Strong backend fit." },
    ],
  });

  const c = listScannedPostings({ state: "assessed" }).find((p) => p.company === "Cursor");
  assert.ok(c, "candidate advanced to assessed");
  assert.equal(c!.fitScore, 82);
});

// --- DB-backed queue (createJob / enqueueFit → listFitQueue → submit) -------------------

test("createJob queues a fit job that listFitQueue surfaces, and submitJobResult clears it", () => {
  seedApp({ company: "Cursor", role: "Software Engineer", status: "discovered" });
  const id = createJob({
    type: "fit",
    createdBy: "CoWork",
    params: { postings: [{ company: "Cursor", role: "Software Engineer", jd: "build stuff" }] },
  });

  // shows up as queued work
  const queue = listFitQueue();
  assert.equal(queue.length, 1, "one fit job queued");
  assert.equal(queue[0].jobId, id);
  assert.equal(queue[0].hasJd, true);

  // claim it (the submit gate requires a live lease), then fulfilling it ingests + flips the row to
  // ingested → no longer pending
  claimJob(id, "agent-A");
  submitJobResult({
    type: "fit",
    jobId: id,
    records: [{ company: "Cursor", role: "Software Engineer", fitScore: 70, recommendation: "apply" }],
  });
  assert.equal(listFitQueue().length, 0, "queue cleared after submit");
  assert.equal(db.select().from(jobs).where(eq(jobs.id, id)).get()?.status, "ingested");
});

// --- targets (the agent curates the target list) ------------------------------------------

test("upsertCompanies inserts new records with config and patches existing ones by canonical name", () => {
  // insert with full scrape config + criteria
  const ins = upsertCompanies([
    { name: "Vertex", tier: "tier2", ats: "greenhouse", slug: "vertex", titles: ["Senior"], location: "NYC|remote" },
  ]);
  assert.equal(ins.inserted, 1);
  const db1 = ins.upserted[0];
  assert.equal(db1.ats, "greenhouse");
  assert.equal(db1.slug, "vertex");
  assert.equal(db1.targetTitles, JSON.stringify(["Senior"]));
  assert.equal(db1.watchlist, false, "upsert does not touch the watchlist");

  // partial update: only endpoint changes; tier/slug/titles untouched
  const upd = upsertCompanies([{ name: "Vertex", endpoint: "https://boards-api.greenhouse.io/vertex" }]);
  assert.equal(upd.inserted, 0);
  assert.equal(upd.updated, 1);
  const after = upd.upserted[0];
  assert.equal(after.endpoint, "https://boards-api.greenhouse.io/vertex");
  assert.equal(after.slug, "vertex", "slug preserved on partial update");
  assert.equal(after.tier, "tier2", "tier preserved on partial update");
});

test("watchlist is separate from company records: setWatchlist toggles membership, upsert leaves it alone", () => {
  // a curated company is NOT on the watchlist by default
  upsertCompanies([{ name: "Vertex", tier: "tier2", slug: "vertex" }]);
  assert.equal(listWatchlist().length, 0, "upsert doesn't add to the watchlist");

  // add it to the watchlist (scan list) — independent of its record
  const added = setWatchlist("Vertex", true);
  assert.equal(added?.watchlist, true);
  assert.deepEqual(listWatchlist().map((c) => c.name), ["Vertex"]);

  // re-upserting config must NOT drop it from the watchlist
  upsertCompanies([{ name: "Vertex", endpoint: "https://x" }]);
  assert.equal(listWatchlist().length, 1, "upsert preserves watchlist membership");

  // adding an untracked company creates a minimal record + watchlists it
  const created = setWatchlist("Acme Robotics", true);
  assert.ok(created, "created on add");
  assert.ok(listCompanies().some((c) => c.name === "Acme Robotics"), "minimal record created");

  // remove from the watchlist; the company record stays
  setWatchlist("Vertex", false);
  assert.equal(listWatchlist().some((c) => c.name === "Vertex"), false, "off the scan list");
  assert.ok(listCompanies().some((c) => c.name === "Vertex"), "record retained");
});

test("enqueueFit ensures a fit_queue candidate and queues the fit job", () => {
  const item = enqueueFit({ company: "Linear", role: "Product Engineer", jd: "ship fast", url: "https://linear.app/jobs/1" });
  assert.equal(item.company, "Linear");
  // a fit_queue CANDIDATE now exists (discovery) so the eventual fit result matches it — no application
  assert.equal(listPostings().length, 0, "no application created by enqueueFit");
  const c = listScannedPostings({ state: "fit_queue" }).find((p) => p.company === "Linear" && p.title === "Product Engineer");
  assert.ok(c, "fit_queue candidate created by enqueueFit");
  // and it's pending in the fit queue
  assert.ok(listFitQueue().some((q) => q.jobId === item.jobId), "queued in the fit queue");
});

test("addComment/deleteComment append + remove a posting's personal comment thread", () => {
  const id = seedCandidate({ company: "Stripe", title: "Software Engineer", state: "applied" });
  addComment(id, "  follow up next week  ");
  addComment(id, "referral from Alex");
  let p = getPosting(id)!;
  assert.equal(p.comments?.length, 2);
  assert.equal(p.comments?.[0].text, "follow up next week"); // trimmed
  assert.ok(p.comments?.[0].at, "has a timestamp");
  deleteComment(id, 0);
  p = getPosting(id)!;
  assert.equal(p.comments?.length, 1);
  assert.equal(p.comments?.[0].text, "referral from Alex");
});

// --- watchlist-scan: app queues stale companies, the agent closes + stamps -------------------

test("queueStaleWatchlistScans queues only stale, watchlisted companies — idempotently", () => {
  const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const fresh = new Date().toISOString();
  db.insert(companies).values({ name: "FreshCo", tier: "tier3", watchlist: true, lastScrapedAt: fresh }).run();
  db.insert(companies).values({ name: "StaleCo", tier: "tier3", watchlist: true, lastScrapedAt: old }).run();
  db.insert(companies).values({ name: "NeverCo", tier: "tier3", watchlist: true, lastScrapedAt: null }).run();
  db.insert(companies).values({ name: "OffWL", tier: "tier3", watchlist: false, lastScrapedAt: old }).run();

  const r = queueStaleWatchlistScans(3);
  assert.equal(r.queued, 2); // StaleCo + NeverCo (FreshCo recent, OffWL not watchlisted)
  const queuedCos = new Set(listJobs().filter((j) => j.type === "watchlist-scan" && j.status === "queued").map((j) => j.params?.company));
  assert.deepEqual([...queuedCos].sort(), ["NeverCo", "StaleCo"]);

  const r2 = queueStaleWatchlistScans(3); // re-click → nothing new, both already in flight
  assert.equal(r2.queued, 0);
  assert.equal(r2.skipped, 2);
});

// `lastScrapedAt` means "we actually read this company's board", and scanCompany is the only thing
// that can know that — it stamps on success and deliberately skips the stamp when the fetch throws.
// Closing the JOB is not evidence of a scrape: the agent can close one whose scanCompany errored or
// never ran. submitJobResult used to stamp anyway, which marked a company scraped that wasn't, and
// hid a broken board behind a fresh-looking timestamp.
test("closing a watchlist-scan job does NOT stamp lastScrapedAt — only a real scan does", () => {
  db.insert(companies).values({ name: "ScanMe", tier: "tier3", watchlist: true, lastScrapedAt: null }).run();
  queueStaleWatchlistScans(3);
  const job = listJobs().find((j) => j.type === "watchlist-scan" && j.params?.company === "ScanMe")!;
  claimJob(job.id, "agent-A"); // submit gate requires a live lease
  submitJobResult({ type: "watchlist-scan", jobId: job.id, records: [] }); // empty close, no scan
  const co = db.select().from(companies).where(eq(companies.name, "ScanMe")).get()!;
  assert.equal(co.lastScrapedAt, null, "never scraped → never stamped");
  // …so the next "Scrape watchlist" click picks it up again, which is what you'd want: it still
  // hasn't been read. (The sweep is button-driven, not polled, so this can't spin on its own.)
  assert.equal(queueStaleWatchlistScans(3).queued, 1, "still stale → re-queued on the next click");
});

test("a company scanCompany DID stamp is treated as fresh and left alone", () => {
  db.insert(companies).values({ name: "Scraped", tier: "tier3", watchlist: true, lastScrapedAt: new Date().toISOString() }).run();
  assert.equal(queueStaleWatchlistScans(3).queued, 0);
});

// --- the daily inbox-sync is queued at most once per day, enforced server-side ---------------

test("enqueueDailyInboxSync is idempotent for a day id — repeat ticks/tabs don't stack duplicates", () => {
  const id = "inbox-sync-daily-2026-07-24";
  assert.equal(enqueueDailyInboxSync(id), true);
  assert.equal(enqueueDailyInboxSync(id), false); // a double-fired effect 373ms later
  assert.equal(enqueueDailyInboxSync(id), false); // a second tab
  assert.equal(listJobs().filter((j) => j.type === "inbox-sync").length, 1);
});

test("enqueueDailyInboxSync doesn't re-queue the day's job after it has been ingested", () => {
  const id = "inbox-sync-daily-2026-07-24";
  enqueueDailyInboxSync(id);
  claimJob(id, "agent-A");
  submitJobResult({ type: "inbox-sync", jobId: id, records: [] });
  assert.equal(listJobs().find((j) => j.id === id)!.status, "ingested");

  assert.equal(enqueueDailyInboxSync(id), false, "same day → stays ingested, never bounced back to queued");
  assert.equal(listJobs().find((j) => j.id === id)!.status, "ingested");
  assert.equal(enqueueDailyInboxSync("inbox-sync-daily-2026-07-25"), true, "next day → a fresh job");
});

test("enqueueDailyInboxSync stands down while any inbox-sync is outstanding (e.g. a manual one)", () => {
  createJob({ type: "inbox-sync", createdBy: "You" }); // manual click, its own random id
  assert.equal(enqueueDailyInboxSync("inbox-sync-daily-2026-07-24"), false);
  assert.equal(listJobs().filter((j) => j.type === "inbox-sync").length, 1);
});
