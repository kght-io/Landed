import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVE_TARGETS, ALL_STEPS, stepStatesFor } from "@landed/shared/pipeline/discovery";

// The ⋯ menu's "Move to <stage>" PATCHes the posting to that target's `state` and nothing else — no
// step is consulted at write time. So the ONLY thing making the label true is that the state it
// writes is one the named step actually shows. When the two drift, the move looks like it worked and
// the posting vanishes: it leaves the step it was in and lands in a state no step renders.
//
// That is exactly what happened to "Fit assessment" → `review`. 720bdbb narrowed the Fit step to
// fit_queue + assessed and moved `review`/`matched` triage onto /watchlist, but left the move target
// aiming at `review`; every posting moved to "Fit assessment" after that dropped off the pipeline
// into the Watchlist's Scan-results tab, with no fit job queued.

test("every move target lands in a state its own stage displays", () => {
  for (const t of MOVE_TARGETS) {
    const states = stepStatesFor(t.stage);
    assert.ok(
      states.includes(t.state),
      `"Move to ${t.label}" writes state "${t.state}", but step "${t.stage}" shows [${states.join(", ")}] — the posting would leave the pipeline`,
    );
  }
});

// A target naming a step that doesn't exist is the same bug wearing a different hat: stepStatesFor
// falls back to treating an unknown key as its own state, so the assertion above would pass on a
// typo'd stage while the menu entry pointed at nothing.
test("every move target names a real step", () => {
  const keys = new Set(ALL_STEPS.map((s) => s.key));
  for (const t of MOVE_TARGETS) assert.ok(keys.has(t.stage), `"Move to ${t.label}" names unknown step "${t.stage}"`);
});

// The menu hides a row's own stage by mapping its state back to a step (Pipeline's STATE_STAGE, built
// from ALL_STEPS). A target state missing from that index makes the entry un-hideable — the menu
// offers a row the move it is already sitting in.
test("every move target state is reachable from the step index", () => {
  const stateStage = new Map<string, string>();
  for (const s of ALL_STEPS) for (const st of s.states) stateStage.set(st, s.key);
  for (const t of MOVE_TARGETS)
    assert.equal(stateStage.get(t.state), t.stage, `state "${t.state}" does not index back to step "${t.stage}"`);
});
