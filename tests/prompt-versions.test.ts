import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, db } from "./helpers";
import { sqlite } from "@landed/backend/db";
import { promptVersions } from "@landed/backend/db/schema";
import {
  SEED_FIT_BODY,
  activeGuidance,
  archivePromptVersion,
  createPromptVersion,
  getActivePrompt,
  listPromptVersions,
  setActivePromptVersion,
} from "@landed/backend/db/prompts";

// The versioned judgment prompts. Each feature ("fit" / "tailoring") has its own 1-based version
// series and exactly ONE active row — the DB enforces that with a partial unique index, so a
// double-activate can't happen even through raw SQL.

beforeEach(() => {
  reset();
});

test("version numbers increment per feature, independently", () => {
  const f1 = createPromptVersion("fit", "first fit body");
  const f2 = createPromptVersion("fit", "second fit body");
  const t1 = createPromptVersion("tailoring", "first tailoring body");

  assert.equal(f1.version, 1);
  assert.equal(f2.version, 2);
  assert.equal(t1.version, 1, "tailoring starts its own series, not continuing fit's");
});

test("the first version of a feature becomes active; later ones don't", () => {
  const v1 = createPromptVersion("fit", "one");
  assert.equal(getActivePrompt("fit")?.id, v1.id, "nothing was active, so v1 takes the slot");

  createPromptVersion("fit", "two");
  assert.equal(getActivePrompt("fit")?.id, v1.id, "saving a draft must not silently switch the run");
});

test("activating a version deactivates the previous one", () => {
  const v1 = createPromptVersion("fit", "one");
  const v2 = createPromptVersion("fit", "two");
  setActivePromptVersion(v2.id);

  assert.equal(getActivePrompt("fit")?.id, v2.id);
  const active = db.select().from(promptVersions).all().filter((r) => r.active);
  assert.deepEqual(active.map((r) => r.id), [v2.id], "exactly one active row for the feature");
  assert.equal(listPromptVersions("fit").find((r) => r.id === v1.id)?.active, false);
});

test("activating one feature leaves the other feature's active row alone", () => {
  const fit = createPromptVersion("fit", "fit one");
  const tail = createPromptVersion("tailoring", "tailor one");
  setActivePromptVersion(createPromptVersion("fit", "fit two").id);

  assert.equal(getActivePrompt("tailoring")?.id, tail.id);
  assert.notEqual(getActivePrompt("fit")?.id, fit.id);
});

test("the DB rejects a second active row for a feature, even from raw SQL", () => {
  createPromptVersion("fit", "one");
  const v2 = createPromptVersion("fit", "two");
  assert.throws(
    () => sqlite.exec(`UPDATE prompt_versions SET active = 1 WHERE id = ${v2.id}`),
    /UNIQUE constraint failed/,
    "the partial unique index is the invariant — not the store's discipline",
  );
});

test("activeGuidance falls back to the seed body when no version exists", () => {
  assert.equal(getActivePrompt("fit"), null);
  assert.equal(activeGuidance("fit"), SEED_FIT_BODY, "the agent is never handed an empty judgment block");
});

test("activeGuidance returns the active version's body once one exists", () => {
  createPromptVersion("fit", "one");
  const v2 = createPromptVersion("fit", "two");
  setActivePromptVersion(v2.id);
  assert.equal(activeGuidance("fit"), "two");
});

test("archiving hides a version from the picker but keeps it readable", () => {
  const v1 = createPromptVersion("fit", "one");
  const v2 = createPromptVersion("fit", "two");
  setActivePromptVersion(v2.id);
  archivePromptVersion(v1.id);

  assert.deepEqual(listPromptVersions("fit").map((r) => r.id), [v2.id], "picker skips archived");
  assert.equal(
    listPromptVersions("fit", { includeArchived: true }).length,
    2,
    "results outlive the prompt that produced them — archived rows stay resolvable",
  );
});

test("the active version cannot be archived out from under a run", () => {
  const v1 = createPromptVersion("fit", "one");
  assert.throws(() => archivePromptVersion(v1.id), /active/i);
});
