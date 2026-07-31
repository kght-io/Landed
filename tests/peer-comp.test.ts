import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, postings } from "./helpers";
import { gatherPeerInputs } from "@landed/backend/peercomp/inputs";
import { getPeerComp, setPeerComp } from "@landed/backend/jobs/peercomps";
import { jobDef } from "@landed/backend/jobs/registry";

beforeEach(() => reset());

const setComp = (id: number, comp?: string, jd?: string) =>
  db.update(postings).set({ comp: comp ?? null, jd: jd ?? null }).where(eq(postings.id, id)).run();
const setIntel = (id: number, patch: { comp?: string; note?: string; teamNotes?: string }) =>
  db.update(postings).set(patch).where(eq(postings.id, id)).run();

// ── input gather (pure DB/FS read — The agent does the synthesis; no model call in tests) ───────────
test("gatherPeerInputs returns interview/offer roles with their comp + JD, excludes applied", () => {
  const a = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });
  const b = seedApp({ company: "Initech", role: "Staff Software Engineer", status: "offer" });
  const c = seedApp({ company: "Umbrella", role: "SWE", status: "applied" }); // excluded
  setComp(a, "≈$290k — $200k base · 15% bonus", "Acme is hiring a backend engineer…");
  setComp(b, "$220–240k base · 4k RSU");
  setComp(c, "should not appear");

  const inputs = gatherPeerInputs();
  const byCompany = Object.fromEntries(inputs.map((r) => [r.company, r]));
  assert.equal(inputs.length, 2); // interview + offer only
  assert.ok(!("Umbrella" in byCompany));
  assert.equal(byCompany["Acme"].role, "Backend Engineer");
  assert.match(byCompany["Acme"].comp!, /200k base/);
  assert.match(byCompany["Acme"].jd!, /backend engineer/);
  assert.equal(byCompany["Initech"].comp, "$220–240k base · 4k RSU");
  assert.equal(byCompany["Initech"].jd, undefined); // no JD stored
});

test("gatherPeerInputs captures comp jotted in the general `note` and `teamNotes` fields, not just `comp`", () => {
  // Real workflow: comp figures often go into the general Notes field after a recruiter call, not the
  // dedicated Comp structure field. All three must reach the roster.
  const a = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });
  setIntel(a, { note: "Recruiter call: $225k base, 15% bonus, massive equity package", teamNotes: "Payments platform, Series C unicorn" });

  const [role] = gatherPeerInputs();
  assert.match(role.note!, /225k base/);
  assert.match(role.teamNotes!, /Series C/);
  assert.equal(role.comp, undefined); // dedicated comp field left empty — the note still carries the signal
});

test("gatherPeerInputs returns [] when nothing is in the interview/offer stage", () => {
  seedApp({ company: "Umbrella", role: "SWE", status: "applied" });
  assert.deepEqual(gatherPeerInputs(), []);
});

// ── store (latest-only, app_config) ──────────────────────────────────────────────────────────
test("setPeerComp / getPeerComp round-trips and keeps only the latest", () => {
  assert.equal(getPeerComp(), null);
  setPeerComp("# v1 table", "2026-07-10T00:00:00.000Z");
  assert.equal(getPeerComp()?.markdown, "# v1 table");
  setPeerComp("# v2 table", "2026-07-10T01:00:00.000Z"); // overwrites
  assert.equal(getPeerComp()?.markdown, "# v2 table");
  assert.equal(getPeerComp()?.generatedAt, "2026-07-10T01:00:00.000Z");
});

// ── ingest (the agent's { markdown } result lands as the latest artifact) ────────────────────────
test("peer-comp ingest stores the submitted markdown as the latest; dryRun persists nothing", () => {
  const def = jobDef("peer-comp")!;
  assert.ok(def, "peer-comp job type is registered");

  // dryRun previews without writing.
  def.ingest([{ markdown: "# preview" }], true);
  assert.equal(getPeerComp(), null);

  // A real submit overwrites the stored latest.
  setPeerComp("# stale", "2026-07-10T00:00:00.000Z");
  const res = def.ingest([{ markdown: "| Role | Base |\n| --- | --- |\n| Acme — SWE | $200k |" }]);
  assert.equal(res.updated, 1);
  assert.match(getPeerComp()!.markdown, /Acme — SWE/);

  // A result with no markdown is a no-op (doesn't clobber the stored latest).
  def.ingest([{ notMarkdown: "oops" }]);
  assert.match(getPeerComp()!.markdown, /Acme — SWE/);
});
