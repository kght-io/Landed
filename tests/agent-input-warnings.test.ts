import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, jobs } from "./helpers";
import { incomingFromInboxRecords } from "@landed/shared/agents/sources/inbox";
import { reconcile } from "@landed/backend/agents/reconcile";
import { submitJobResult } from "@landed/backend/jobs/store";

beforeEach(() => reset());

// The agent's JSON is coerced leniently ON PURPOSE — an LLM is inconsistent, and a record we can
// half-read is worth more than one we reject. What's NOT ok is doing that silently: an unrecognized
// status becomes "applied" and proposes a real-looking stage change, and a record whose company
// won't canonicalize vanishes entirely. These pin that every such decision gets reported.

// --- the mapper says what it couldn't read -----------------------------------------------------

test("an unrecognized status still coerces to applied — and says so", () => {
  const { records, warnings } = incomingFromInboxRecords([
    { company: "Netflix", role: "Senior SWE", status: "ghosted" },
  ]);

  assert.equal(records[0].status, "applied", "behavior unchanged — still absorbed");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].field, "status");
  assert.equal(warnings[0].value, "ghosted", "names what the agent actually sent");
  assert.equal(warnings[0].used, "applied", "and what we used instead");
  assert.match(warnings[0].subject ?? "", /Netflix/, "and which record it came from");
});

test("an unrecognized interview kind still coerces to other — and says so", () => {
  const { records, warnings } = incomingFromInboxRecords([
    { company: "Netflix", status: "interviewing", interviews: [{ round: 1, kind: "pair_programming" }] },
  ]);

  assert.equal(records[0].interviews?.[0].kind, "other");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].field, "kind");
  assert.equal(warnings[0].value, "pair_programming");
});

// The signal is only worth having if it stays quiet on good input.
test("a clean record produces no warnings at all", () => {
  const { warnings } = incomingFromInboxRecords([
    { company: "Netflix", role: "Senior SWE", status: "rejected", interviewed: true,
      interviews: [{ round: 1, kind: "recruiter_screen", outcome: "passed" }] },
  ]);
  assert.deepEqual(warnings, []);
});

test("an absent optional field is not a warning — only an unreadable one is", () => {
  const { warnings } = incomingFromInboxRecords([{ company: "Netflix", status: "applied" }]);
  assert.deepEqual(warnings, [], "no status/kind/level given is normal, not a problem");
});

// --- reconcile counts what it drops ------------------------------------------------------------

test("a record with no usable company is COUNTED, not silently dropped", () => {
  const out = reconcile(
    [
      { company: "", role: "Ghost Role", status: "applied" },
      { company: "Netflix", role: "Senior SWE", status: "applied" },
    ],
    { actor: "CoWork", source: "inbox-sync", approval: true },
  );

  assert.equal(out.skipped, 1, "the unusable record is reported");
  assert.match(out.summary, /skipped/i, "and named in the summary a human reads");
});

test("nothing skipped → the summary doesn't mention skipping", () => {
  const out = reconcile([{ company: "Netflix", role: "Senior SWE", status: "applied" }], {
    actor: "CoWork", source: "inbox-sync", approval: true,
  });
  assert.equal(out.skipped, 0);
  assert.doesNotMatch(out.summary, /skipped/i);
});

// --- and it reaches the ledger row a human actually looks at -----------------------------------

test("a broken sync reads differently from a quiet one on the job row", () => {
  seedApp({ company: "Netflix", role: "Senior SWE", status: "applied" });

  const quiet = submitJobResult({ type: "inbox-sync", jobId: "inbox-quiet", records: [] });
  const broken = submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-broken",
    records: [
      { company: "", role: "Ghost Role", status: "applied" },
      { company: "Netflix", role: "Senior SWE", status: "ghosted" },
    ],
  });

  assert.notEqual(broken.summary, quiet.summary, "the whole point — these can't look the same");
  assert.match(broken.summary, /skipped/i, "1 record had no company");
  assert.match(broken.summary, /ghosted/, "and one status was unreadable");

  // and it's persisted, not just returned — the Agents view reads the ledger row
  const row = db.select().from(jobs).where(eq(jobs.id, "inbox-broken")).get();
  assert.match(row?.summary ?? "", /skipped/i);
});
