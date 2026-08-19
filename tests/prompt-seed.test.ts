import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedApp, db } from "./helpers";
import { eq } from "drizzle-orm";
import { postings } from "@landed/backend/db/schema";
import { sqlite } from "@landed/backend/db";
import { LEGACY_SEED_FIT_BODY, LEGACY_SEED_TAILOR_BODY, adoptCarvedOutJudgment, backfillBaselineAttribution, renumberBaselineToV0, seedPromptVersions } from "@landed/backend/db/seed-prompts";
import { SEED_FIT_BODY, SEED_TAILOR_BODY, activeGuidance, createPromptVersion, getActivePrompt, listPromptVersions, setActivePromptVersion, agentProfile } from "@landed/backend/db/prompts";
import { setProfile } from "@landed/backend/db/profile";

// v0 of each feature is lifted out of the profile blob where these two strings used to live, so an
// existing install's tuned guidance becomes its baseline version rather than being silently reset.
// v0 is what you INHERITED; v1 is the first change you make yourself.

beforeEach(() => {
  reset();
});

const storeProfileBlob = (blob: Record<string, unknown>) =>
  sqlite.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('profile', ?)").run(JSON.stringify(blob));

test("seeds v0 from the guidance already stored on the profile blob", () => {
  storeProfileBlob({ levelBaseline: "Senior", fitGuidance: "my tuned fit rules", tailorGuidance: "my tuned tailor rules" });

  seedPromptVersions(sqlite);

  const fit = getActivePrompt("fit");
  assert.equal(fit?.version, 0);
  assert.equal(fit?.body, "my tuned fit rules", "the user's own text becomes the baseline, not the default");
  assert.equal(getActivePrompt("tailoring")?.body, "my tuned tailor rules");
});

test("seeds the ship-with defaults on a fresh install with no profile blob", () => {
  seedPromptVersions(sqlite);
  assert.equal(activeGuidance("fit"), SEED_FIT_BODY);
  assert.equal(activeGuidance("tailoring"), SEED_TAILOR_BODY);
});

test("a blank stored guidance falls back to the default rather than seeding an empty prompt", () => {
  storeProfileBlob({ fitGuidance: "   ", tailorGuidance: "" });
  seedPromptVersions(sqlite);
  assert.equal(activeGuidance("fit"), SEED_FIT_BODY);
  assert.equal(activeGuidance("tailoring"), SEED_TAILOR_BODY);
});

test("seeding is idempotent — a second run adds nothing and never overwrites a later version", () => {
  seedPromptVersions(sqlite);
  const v2 = createPromptVersion("fit", "v2 body");
  setActivePromptVersion(v2.id);

  seedPromptVersions(sqlite);

  assert.equal(getActivePrompt("fit")?.id, v2.id, "re-running must not drag the active version back to v1");
  const count = sqlite.prepare("SELECT count(*) AS n FROM prompt_versions WHERE feature = 'fit'").get() as { n: number };
  assert.equal(count.n, 2);
});

test("agentProfile serves the active version under the same keys the playbooks name", () => {
  setProfile({ levelBaseline: "Staff Software Engineer" });
  seedPromptVersions(sqlite);
  const v2 = createPromptVersion("fit", "v2 fit judgment");
  setActivePromptVersion(v2.id);

  const p = agentProfile();
  assert.equal(p.fitGuidance, "v2 fit judgment", "getContext follows the active version");
  assert.equal(p.tailorGuidance, SEED_TAILOR_BODY);
  assert.equal(p.levelBaseline, "Staff Software Engineer", "the rest of the profile is untouched");
});

// ── the carve-out: judgment moved out of the playbooks into the versioned prompt ─────────────

test("an install still on the untouched legacy nudge is upgraded in place", () => {
  storeProfileBlob({ fitGuidance: LEGACY_SEED_FIT_BODY, tailorGuidance: LEGACY_SEED_TAILOR_BODY });
  seedPromptVersions(sqlite);
  const before = getActivePrompt("fit")!;

  assert.equal(adoptCarvedOutJudgment(sqlite), 2, "both features adopt");

  const after = getActivePrompt("fit")!;
  assert.equal(after.id, before.id, "nobody authored the default — rewrite it, don't mint a version");
  assert.equal(after.body, SEED_FIT_BODY);
  assert.match(after.body, /Main gaps/, "the judgment the playbook used to carry is now here");
});

test("an EDITED version is preserved and the full judgment is activated alongside it", () => {
  storeProfileBlob({ fitGuidance: "my own hand-written fit rules" });
  seedPromptVersions(sqlite);
  const mine = getActivePrompt("fit")!;

  adoptCarvedOutJudgment(sqlite);

  const active = getActivePrompt("fit")!;
  assert.notEqual(active.id, mine.id, "losing the rules is the worse failure — the full judgment goes live");
  assert.equal(active.body, SEED_FIT_BODY);
  const kept = listPromptVersions("fit").find((v) => v.id === mine.id);
  assert.equal(kept?.body, "my own hand-written fit rules", "my text stays readable, and past results still point at it");
});

test("adopting is idempotent — a fresh seed already carries the judgment", () => {
  seedPromptVersions(sqlite);
  assert.equal(adoptCarvedOutJudgment(sqlite), 0);
  assert.equal(adoptCarvedOutJudgment(sqlite), 0);
  assert.equal(listPromptVersions("fit").length, 1);
});

// ── v0 = the inherited baseline ──────────────────────────────────────────────────────────────

test("the seeded baseline is v0, so the first version I author is v1", () => {
  seedPromptVersions(sqlite);
  assert.equal(getActivePrompt("fit")?.version, 0);
  assert.equal(getActivePrompt("tailoring")?.version, 0);
  assert.equal(createPromptVersion("fit", "my first experiment").version, 1);
});

test("a baseline already seeded as v1 is renumbered to v0", () => {
  seedPromptVersions(sqlite);
  sqlite.exec("UPDATE prompt_versions SET version = 1 WHERE feature = 'fit'"); // pre-renumber shape

  assert.equal(renumberBaselineToV0(sqlite), 1);

  assert.equal(getActivePrompt("fit")?.version, 0);
  assert.equal(renumberBaselineToV0(sqlite), 0, "idempotent");
});

test("renumbering leaves a version I authored alone", () => {
  seedPromptVersions(sqlite);
  sqlite.exec("UPDATE prompt_versions SET version = 1 WHERE feature = 'fit'");
  sqlite.exec("UPDATE prompt_versions SET label = 'my own rules' WHERE feature = 'fit'");

  assert.equal(renumberBaselineToV0(sqlite), 0, "only the untouched inherited baseline is v0");
  assert.equal(getActivePrompt("fit")?.version, 1);
});

// ── backfilling the baseline cohort ──────────────────────────────────────────────────────────

test("backfill attributes only the runs that actually happened", () => {
  seedPromptVersions(sqlite);
  const fitV0 = getActivePrompt("fit")!.id;
  const tailV0 = getActivePrompt("tailoring")!.id;

  const scoredAndTailored = seedApp({ company: "A", status: "applied" });
  const scoredOnly = seedApp({ company: "B", status: "applied" });
  const appliedAsIs = seedApp({ company: "C", status: "applied" });
  const handEntered = seedApp({ company: "D", status: "applied" });
  db.update(postings).set({ fitScore: 80, resumeDir: "a/v1" }).where(eq(postings.id, scoredAndTailored)).run();
  db.update(postings).set({ fitScore: 65 }).where(eq(postings.id, scoredOnly)).run();
  db.update(postings).set({ fitScore: 70, resumeDir: "d/v1", historical: true }).where(eq(postings.id, handEntered)).run();

  assert.equal(backfillBaselineAttribution(sqlite), 3, "2 fit runs + 1 tailor run");

  const row = (id: number) => db.select().from(postings).where(eq(postings.id, id)).get()!;
  assert.equal(row(scoredAndTailored).fitPromptVersionId, fitV0);
  assert.equal(row(scoredAndTailored).tailorPromptVersionId, tailV0);
  assert.equal(row(scoredOnly).fitPromptVersionId, fitV0);
  assert.equal(row(scoredOnly).tailorPromptVersionId, null, "never tailored — the untailored control must survive");
  assert.equal(row(appliedAsIs).fitPromptVersionId, null, "no fit job ever ran on it");
  assert.equal(row(handEntered).fitPromptVersionId, null, "hand-entered history predates the agent entirely");
});

test("backfill never overwrites a real claim-time stamp, and re-runs cleanly", () => {
  seedPromptVersions(sqlite);
  const stamped = createPromptVersion("fit", "v1 body");
  const id = seedApp({ company: "E", status: "applied" });
  db.update(postings).set({ fitScore: 90, fitPromptVersionId: stamped.id }).where(eq(postings.id, id)).run();

  assert.equal(backfillBaselineAttribution(sqlite), 0);
  assert.equal(backfillBaselineAttribution(sqlite), 0, "idempotent");
  const row = db.select().from(postings).where(eq(postings.id, id)).get()!;
  assert.equal(row.fitPromptVersionId, stamped.id);
});
