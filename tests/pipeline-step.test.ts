import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_STEPS, DEFAULT_STEP, resolveStep, stepStatesFor,
} from "@landed/shared/pipeline/discovery";

// The active pipeline step is persisted, so leaving the page (→ /watchlist) and coming back must
// land on the step you left. The step has to be resolvable from the stored value SYNCHRONOUSLY —
// restoring it later (in a mount effect) makes the page load the DEFAULT step's rows first and
// render them under the restored step.

test("a stored spine step resolves to itself", () => {
  assert.equal(resolveStep("later"), "later");
  assert.equal(resolveStep("applied"), "applied");
});

test("a stored ARCHIVE step is a real step too", () => {
  assert.equal(resolveStep("dismissed"), "dismissed");
});

test("a stale / unknown stored step falls back to the default", () => {
  assert.equal(resolveStep("scan"), DEFAULT_STEP);       // a step that no longer exists
  assert.equal(resolveStep(""), DEFAULT_STEP);
  assert.equal(resolveStep(null), DEFAULT_STEP);
  assert.equal(resolveStep(undefined), DEFAULT_STEP);
  assert.equal(resolveStep(42), DEFAULT_STEP);           // a corrupt / non-string stored value
});

test("the default is itself a real step", () => {
  assert.ok(ALL_STEPS.some((s) => s.key === DEFAULT_STEP));
});

// The whole point: the states fetched on the first render are the STORED step's, never the default's.
test("a restored step fetches its own states, not the default's", () => {
  assert.deepEqual(stepStatesFor(resolveStep("later")), ["apply_later"]);
  assert.deepEqual(stepStatesFor(resolveStep("tailor")), ["tailoring", "tailored"]);
  assert.notDeepEqual(stepStatesFor(resolveStep("later")), stepStatesFor(DEFAULT_STEP));
});

test("an unknown step still yields a usable state list (the key itself)", () => {
  assert.deepEqual(stepStatesFor("matched"), ["matched"]);
});
