import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, seedCandidate, db, postings, companies } from "./helpers";
import { submitJobResult } from "@landed/backend/jobs/store";
import { listPendingMatches, getPosting } from "@landed/backend/db/queries";
import { resolvePendingMatch } from "@landed/backend/agents/reconcile";

beforeEach(() => reset());

const sync = (records: Record<string, unknown>[], jobId = "inbox-1") =>
  submitJobResult({ type: "inbox-sync", jobId, records });
const stateOf = (id: number) => db.select().from(postings).where(eq(postings.id, id)).get()!.state;
const rowsFor = (name: string) => {
  const co = db.select().from(companies).all().find((c) => c.name === name);
  return co ? db.select().from(postings).where(eq(postings.companyId, co.id)).all() : [];
};

// --- nothing an inbox sync proposes lands without approval -----------------------------------

test("a status advance is PROPOSED, not applied — the posting doesn't move until you approve", () => {
  const id = seedApp({ company: "Reddit", role: "Senior Software Engineer", status: "applied" });

  sync([{ company: "Reddit", role: "Senior Software Engineer", status: "interviewing", interviews: [{ round: 1, kind: "recruiter" }] }]);

  assert.equal(stateOf(id), "applied", "untouched until approved");
  const [p] = listPendingMatches();
  assert.equal(p.kind, "change");
  assert.equal(p.companyName, "Reddit");
  assert.deepEqual(p.candidates.map((c) => c.id), [id]);
  // The card spells the change out in plain English.
  assert.deepEqual(p.changes?.map((c) => c.text), ["Stage: Applied → Interviewing", "Marked as interviewed", "Adds 1 interview round"]);

  assert.equal(resolvePendingMatch(p.id, "apply", id).ok, true);
  assert.equal(stateOf(id), "interview");
  assert.equal(listPendingMatches().length, 0);
});

test("rejecting a proposal leaves the posting alone and clears the card", () => {
  const id = seedApp({ company: "Reddit", role: "Senior Software Engineer", status: "applied" });
  sync([{ company: "Reddit", role: "Senior Software Engineer", status: "rejected" }]);

  const [p] = listPendingMatches();
  assert.equal(resolvePendingMatch(p.id, "dismiss").ok, true);
  assert.equal(stateOf(id), "applied");
  assert.equal(listPendingMatches().length, 0);
});

test("a brand-new posting from an email is proposed too — approving it creates the row", () => {
  sync([{ company: "Figma", role: "Product Engineer", status: "applied", appliedDate: "2026-07-20" }]);

  assert.equal(rowsFor("Figma").length, 0, "no posting created yet");
  const [p] = listPendingMatches();
  assert.equal(p.kind, "change");
  assert.equal(p.create, true, "flagged as a create, so the card can say so");
  assert.deepEqual(p.candidates, []);
  assert.ok(p.changes?.some((c) => c.text === "Stage: set to Applied"));

  assert.equal(resolvePendingMatch(p.id, "new").ok, true);
  const [row] = rowsFor("Figma");
  assert.equal(row.title, "Product Engineer");
  assert.equal(row.state, "applied");
  assert.equal(row.appliedDate, "2026-07-20");
});

test("descriptive-only edits are proposed as well — nothing from a sync is auto-applied", () => {
  const id = seedApp({ company: "Reddit", role: "Senior Software Engineer", status: "applied" });
  sync([{ company: "Reddit", role: "Senior Software Engineer", status: "applied", location: "New York, NY" }]);

  assert.equal(getPosting(id)!.location ?? null, null);
  const [p] = listPendingMatches();
  assert.deepEqual(p.changes?.map((c) => c.text), ["Location: set to New York, NY"]);
  resolvePendingMatch(p.id, "apply", id);
  assert.equal(getPosting(id)!.location, "New York, NY");
});

// --- the queue stays quiet when there's nothing to decide -------------------------------------

test("an idempotent re-sync (nothing actually changes) proposes nothing", () => {
  seedApp({ company: "Reddit", role: "Senior Software Engineer", status: "applied", appliedDate: "2026-06-25" });
  const out = sync([{ company: "Reddit", role: "Senior Software Engineer", status: "applied", appliedDate: "2026-06-25" }]);
  assert.equal(listPendingMatches().length, 0);
  assert.match(out.summary, /0 to approve|nothing/i);
});

test("re-running the same sync doesn't stack a second card for the same change", () => {
  seedApp({ company: "Reddit", role: "Senior Software Engineer", status: "applied" });
  const rec = [{ company: "Reddit", role: "Senior Software Engineer", status: "rejected" }];
  sync(rec, "inbox-1");
  sync(rec, "inbox-2");
  assert.equal(listPendingMatches().length, 1);
});

test("a fresher proposal for the same posting replaces the stale card rather than adding one", () => {
  const id = seedApp({ company: "Reddit", role: "Senior Software Engineer", status: "applied" });
  sync([{ company: "Reddit", role: "Senior Software Engineer", status: "interviewing" }], "inbox-1");
  sync([{ company: "Reddit", role: "Senior Software Engineer", status: "interviewing", interviews: [{ round: 1, kind: "onsite" }] }], "inbox-2");

  const pend = listPendingMatches();
  assert.equal(pend.length, 1);
  assert.ok(pend[0].changes?.some((c) => c.text === "Adds 1 interview round"), "shows the latest proposal");
  resolvePendingMatch(pend[0].id, "apply", id);
  assert.equal(stateOf(id), "interview");
});

// --- other sources are untouched by the approval gate -----------------------------------------

test("only inbox-sync needs approval — another source still reconciles directly", async () => {
  const { reconcile } = await import("@landed/backend/agents/reconcile");
  const id = seedCandidate({ company: "Reddit", title: "Senior Software Engineer", state: "tailoring" });
  const out = reconcile([{ company: "Reddit", role: "Senior Software Engineer", status: "applied" }], { actor: "You", source: "manual" });
  assert.equal(out.updated, 1);
  assert.equal(stateOf(id), "applied");
  assert.equal(listPendingMatches().length, 0);
});
