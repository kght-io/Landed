// Reaching the interview stage earns an interview brief, without anyone pressing a button — the
// brief is the thing you want waiting for you when a company says yes, not a chore you remember.
// The wiring is the db → jobs event bus (backend/src/db/stage-change.ts): `db` announces the move,
// `jobs` subscribes. Importing the jobs barrel is what registers that subscription, so these tests
// import it deliberately — a missing subscriber has to fail here, loudly.
import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, jobs } from "./helpers";
import "@landed/backend/jobs/store";
import { updateApplication } from "@landed/backend/db/queries";
import { emitStageChange } from "@landed/backend/db/stage-change";

beforeEach(reset);

const briefJobs = () => db.select().from(jobs).where(eq(jobs.type, "interview-brief")).all();

test("moving a posting into the interview stage queues its brief", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "applied" });
  updateApplication(id, { status: "interview" });

  const queued = briefJobs();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].id, `interview-brief-${id}`);
  assert.equal(queued[0].createdBy, "CoWork", "the app queued it, not you");
});

test("a second posting at the same company gets its OWN brief — the brief is per posting", () => {
  const a = seedApp({ company: "Acme", role: "Backend Engineer", status: "applied" });
  const b = seedApp({ company: "Acme", role: "Platform Engineer", status: "applied" });
  updateApplication(a, { status: "interview" });
  updateApplication(b, { status: "interview" });

  assert.deepEqual(briefJobs().map((j) => j.id).sort(), [`interview-brief-${a}`, `interview-brief-${b}`].sort());
});

test("re-entering the stage does not supersede a brief that already ran", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "applied" });
  updateApplication(id, { status: "interview" });
  db.update(jobs).set({ status: "ingested" }).where(eq(jobs.id, `interview-brief-${id}`)).run();

  updateApplication(id, { status: "offer" });
  updateApplication(id, { status: "interview" }); // back again

  const after = briefJobs();
  assert.equal(after.length, 1);
  assert.equal(after[0].status, "ingested", "the finished brief is left alone, not re-queued");
});

test("stage moves that are not into `interview` queue nothing", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "assessed" });
  updateApplication(id, { status: "tailoring" });
  updateApplication(id, { status: "applied" });
  updateApplication(id, { status: "rejected" });

  assert.equal(briefJobs().length, 0);
});

test("the same reaction fires for a SYNCED move — the bus, not the caller, is what's subscribed", () => {
  // inbox-sync moves postings too (backend/src/agents/reconcile.ts announces on the same bus). This
  // test drives the event directly, so a subscriber that only works for the UI path fails here.
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "applied" });
  emitStageChange({ postingId: id, companyId: 1, from: "applied", to: "interview" });

  assert.deepEqual(briefJobs().map((j) => j.id), [`interview-brief-${id}`]);
});
