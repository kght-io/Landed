import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedApp } from "./helpers";
import {
  updateApplication, getPosting,
  addInterviewRound, updateInterviewRound, deleteInterviewRound,
} from "@landed/backend/db/queries";

beforeEach(() => reset());

test("comp + teamNotes round-trip through updateApplication → getPosting", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });

  updateApplication(id, { comp: "60M Series A · 10yr runway · 200-250k base · 15% bonus", teamNotes: "Rewards platform." });
  let p = getPosting(id)!;
  assert.match(p.comp!, /Series A/);
  assert.match(p.teamNotes!, /Rewards platform/);

  // Clearing is supported (null wipes the column).
  updateApplication(id, { comp: null });
  p = getPosting(id)!;
  assert.equal(p.comp, undefined);
  assert.match(p.teamNotes!, /Rewards platform/); // untouched
});

test("interview round CRUD: add → edit → delete, numbered after existing rounds", () => {
  const id = seedApp({ company: "Globex", status: "interview" });

  let p = addInterviewRound(id, { kind: "technical", notes: "45 min · TS or Python" })!;
  assert.equal(p.interviews?.length, 1);
  const r1 = p.interviews![0];
  assert.equal(r1.kind, "technical");
  assert.equal(r1.round, 1);

  // A second round numbers after the first.
  p = addInterviewRound(id, { kind: "system_design", notes: "User-facing AI product" })!;
  assert.equal(p.interviews?.length, 2);
  assert.equal(p.interviews![1].round, 2);

  // Edit only the provided fields.
  p = updateInterviewRound(r1.id!, { outcome: "passed" })!;
  const edited = p.interviews!.find((r) => r.id === r1.id)!;
  assert.equal(edited.outcome, "passed");
  assert.equal(edited.notes, "45 min · TS or Python"); // unchanged

  // Delete by id.
  p = deleteInterviewRound(r1.id!)!;
  assert.equal(p.interviews?.length, 1);
  assert.equal(p.interviews![0].kind, "system_design");
});
