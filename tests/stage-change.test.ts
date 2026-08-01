import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, jobs, postings } from "./helpers";
// Importing the jobs BARREL is what registers the subscription (store.ts pulls in ./subscribe).
// That is the behaviour under test here, so the import is load-bearing, not incidental.
import "@landed/backend/jobs/store";
import { emitStageChange } from "@landed/backend/db/stage-change";

beforeEach(reset);

const companyOf = (postingId: number) =>
  db.select({ id: postings.companyId }).from(postings).where(eq(postings.id, postingId)).get()!.id;
const prepJobs = () => db.select().from(jobs).where(eq(jobs.type, "prep-research")).all();

// `db` announces a stage move and knows nothing about who reacts; `jobs` subscribes. The wiring is
// an import side effect, so these tests exist to make a missing subscriber fail loudly — the older
// prep-research test passes either way, because it happens to import the jobs barrel for its own
// reasons. See backend/src/db/stage-change.ts.

test("announcing a move into the interview stage earns a prep-research job", () => {
  const id = seedApp({ company: "Stripe", status: "applied" });
  assert.equal(prepJobs().length, 0);

  emitStageChange({ companyId: companyOf(id), from: "applied", to: "interview" });
  assert.equal(prepJobs().length, 1, "the jobs layer reacted — the subscription is wired");
});

test("the subscription is idempotent — a repeated announcement doesn't stack jobs", () => {
  const id = seedApp({ company: "Ramp", status: "applied" });
  const companyId = companyOf(id);

  emitStageChange({ companyId, from: "applied", to: "interview" });
  emitStageChange({ companyId, from: "applied", to: "interview" });
  assert.equal(prepJobs().length, 1, "the enqueue keys on a deterministic per-company id");
});

test("a move that isn't into the interview stage earns nothing", () => {
  const id = seedApp({ company: "Linear", status: "applied" });
  emitStageChange({ companyId: companyOf(id), from: "applied", to: "rejected" });
  assert.equal(prepJobs().length, 0);
});

test("a no-op transition is not announced at all", () => {
  const id = seedApp({ company: "Notion", status: "interview" });
  emitStageChange({ companyId: companyOf(id), from: "interview", to: "interview" });
  assert.equal(prepJobs().length, 0, "from === to is not a transition");
});
