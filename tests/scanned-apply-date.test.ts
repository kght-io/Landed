import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, db, postings, seedCandidate } from "./helpers";
import { scannedAction } from "@landed/backend/db/queries";

beforeEach(() => reset());

const stateOf = (id: number) => db.select().from(postings).where(eq(postings.id, id)).get()!;

// "Mark applied" from the scan stage must honor the applied date the user entered in the prompt —
// not silently stamp today. This is the "added to applied" vs "actual applied date" distinction.
test("scannedAction apply uses the supplied appliedDate", () => {
  const id = seedCandidate({ company: "Linear", state: "assessed" });
  const r = scannedAction(id, "apply", { appliedDate: "2026-05-02" });
  assert.equal(r.ok, true);
  const row = stateOf(id);
  assert.equal(row.state, "applied");
  assert.equal(row.appliedDate, "2026-05-02", "the user's date is persisted, not today");
});

// Without an override it still defaults to a stamped date (so the non-UI/agent path keeps working).
test("scannedAction apply falls back to a stamped date when none is given", () => {
  const id = seedCandidate({ company: "Ramp", state: "assessed" });
  scannedAction(id, "apply");
  const row = stateOf(id);
  assert.equal(row.state, "applied");
  assert.ok(row.appliedDate && /^\d{4}-\d{2}-\d{2}$/.test(row.appliedDate), "a default date is stamped");
});
