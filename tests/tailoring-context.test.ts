// Hand the tailoring agent what it otherwise hunts for.
//
// Measured on a real run (tailoring-app-912645): the agent spent 7 of its 20 API requests — 107s
// and ~35% of the job's token cost — spelunking sqlite for the posting's fit record (`.tables`,
// `.schema fit_verdicts`, `.schema postings`), and 2 more grepping backend/src/config.ts to learn
// where ASSET_ROOT points. Both are facts the app already holds at enqueue time. Carrying them in
// the job params / getContext removes those requests entirely.
//
// The context tax is why request COUNT is the lever: by mid-run each request re-reads a ~45k-token
// prefix, so every avoidable round trip costs real money before it does any work.
import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { reset, seedCandidate, db, postings, jobs } from "./helpers";
import { repoPath } from "@landed/backend/paths";
import { enqueueTailoring } from "@landed/backend/jobs/enqueue/tailoring";
import { getPosting } from "@landed/backend/db/queries";
import { agentPaths } from "@landed/backend/config";
import { baseArgs } from "@landed/backend/agents/claude-code";
import type { FitAssessment } from "@landed/shared/types";

beforeEach(() => reset());

const FIT: FitAssessment = {
  levelMatch: { call: "match", why: "Staff scope matches the 8y band" },
  recommendation: "tailor",
  summary: "Strong platform overlap; the JD's Python/Django stack is the one real gap.",
  strengths: ["multi-channel delivery at scale", "observability instrumentation"],
  gaps: [
    { text: "Python/Django", severity: "hard", detail: "JD names it as a must-have" },
    { text: "startup stage", severity: "soft" },
  ],
};

// Seed a posting parked in the tailor stage, optionally with a fit record already scored.
function seedTailorable(opts?: { fitScore?: number; fitDetail?: string }): number {
  const id = seedCandidate({ company: "Medallion", title: "Staff Software Engineer", state: "tailoring" });
  if (opts) {
    db.update(postings)
      .set({ fitScore: opts.fitScore ?? null, fitDetail: opts.fitDetail ?? null })
      .where(eq(postings.id, id))
      .run();
  }
  return id;
}

// The params blob the agent actually reads off the queued job.
function queuedPosting(appId: number): Record<string, unknown> {
  const row = db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${appId}`)).get();
  assert.ok(row, "a tailoring job was queued");
  const params = JSON.parse(row!.params ?? "{}") as { postings?: Record<string, unknown>[] };
  assert.ok(params.postings?.length, "params carries the posting");
  return params.postings![0];
}

// --- (1) the fit record rides on the job -----------------------------------------------------

test("enqueueTailoring carries the posting's fit record in params — the agent never queries for it", () => {
  const id = seedTailorable({ fitScore: 76, fitDetail: JSON.stringify(FIT) });
  enqueueTailoring(getPosting(id)!);

  const p = queuedPosting(id);
  const fit = p.fit as { score?: number; level?: string; recommendation?: string; gaps?: unknown[] } | undefined;
  assert.ok(fit, "params.postings[].fit is present when the posting has been scored");
  assert.equal(fit!.score, 76);
  // The "leveling call" the playbook tells the agent to steer by is fit_detail.levelMatch.call —
  // NOT postings.level (a tracker field holding the role's own level, e.g. "Staff").
  assert.equal(fit!.level, "match");
  assert.equal(fit!.recommendation, "tailor");
  assert.deepEqual(fit!.gaps, FIT.gaps, "gaps ride through verbatim — they steer which bullets get rewritten");
});

// Absent, not empty: an unscored posting must not ship `fit: {}`. A hollow key reads as "scored,
// nothing found" and invites the agent to go looking for the real record — the exact round trip
// this change removes. The playbook says "if present", so absence must be unambiguous.
test("a posting with no fit record omits the fit key entirely", () => {
  const id = seedTailorable();
  enqueueTailoring(getPosting(id)!);

  const p = queuedPosting(id);
  assert.equal("fit" in p, false, "no fit key at all when the posting was never scored");
});

// A score with no detail blob (scored by an older run, or a fit result that carried only a number)
// still beats nothing — ship what we have rather than dropping the whole key.
test("a fit score with no detail blob still ships the score", () => {
  const id = seedTailorable({ fitScore: 61 });
  enqueueTailoring(getPosting(id)!);

  const fit = queuedPosting(id).fit as { score?: number; gaps?: unknown } | undefined;
  assert.ok(fit, "a bare score is still worth carrying");
  assert.equal(fit!.score, 61);
  assert.equal(fit!.gaps, undefined);
});

// Prose the tailor never acts on is pure context tax — every token here is re-read on each of the
// run's ~14 requests. Keep the decision-relevant fields, drop the narrative ones.
test("the fit payload omits summary/strengths prose — decision fields only", () => {
  const id = seedTailorable({ fitScore: 76, fitDetail: JSON.stringify(FIT) });
  enqueueTailoring(getPosting(id)!);

  const fit = queuedPosting(id).fit as Record<string, unknown>;
  assert.equal(fit.summary, undefined, "summary is narrative — the agent re-derives its own reasoning");
  assert.equal(fit.strengths, undefined, "strengths is narrative — the gaps are what steer edits");
});

// A corrupt fit_detail must not take the whole enqueue down: the job still queues, still carries
// the score, and the agent falls back to the JD (which is what it did before this change anyway).
test("a malformed fit_detail degrades to the bare score instead of throwing", () => {
  const id = seedTailorable({ fitScore: 55, fitDetail: "{not json" });
  assert.doesNotThrow(() => enqueueTailoring(getPosting(id)!));

  const fit = queuedPosting(id).fit as { score?: number } | undefined;
  assert.equal(fit?.score, 55);
});

// --- (2) on-disk paths come from getContext ---------------------------------------------------

test("agentPaths hands over absolute asset paths so the agent stops grepping config.ts", () => {
  const p = agentPaths();
  assert.ok(p.assetRoot.startsWith("/"), "assetRoot is absolute — it gets pasted into shell commands");
  assert.ok(p.baseResume.startsWith(p.assetRoot), "baseResume lives under the asset root");
  assert.ok(p.resumeDir.startsWith(p.assetRoot), "resumeDir lives under the asset root");
  assert.ok(p.baseResume.endsWith("resume-ref.docx"), "the base résumé is the .docx the tailor helper reads");
  assert.equal(p.resumeDir, `${p.assetRoot}/resume`);
});

// --- (3) the model is pinned, not inherited ---------------------------------------------------

// The runner passed no --model, so runs silently followed the CLI default: July's runs were Opus
// 4.8, August's Opus 5, and per-job cost roughly doubled without a code change. Pin it.
test("baseArgs pins an explicit --model so runs don't drift with the CLI default", () => {
  const args = baseArgs("/tmp/mcp.json");
  const i = args.indexOf("--model");
  assert.notEqual(i, -1, "--model must be passed explicitly");
  assert.ok((args[i + 1] ?? "").length > 0, "--model needs a value");
});

// --- the playbook has to agree, or the agent hunts anyway --------------------------------------

// Shipping the data without retiring the instruction that sent the agent looking would change
// nothing: it reads the playbook, sees `$ASSET_ROOT` and "read the fit record", and spelunks again.
// AGENTS.md makes brief-sync part of the change; this makes it part of the signal.
test("instructions/tailoring.md points at the params/getContext data, not a shell env var", () => {
  const md = readFileSync(repoPath("instructions", "tailoring.md"), "utf8");
  // Naming $ASSET_ROOT to warn the agent OFF it is fine (and useful). What must not survive is a
  // command that actually interpolates it — that's the line the agent copies and runs.
  const commands = md.split("\n").filter((l) => l.includes("tailor:docx"));
  assert.ok(commands.length, "the playbook still shows the tailor:docx helper");
  for (const line of commands) {
    assert.equal(
      line.includes("$ASSET_ROOT"),
      false,
      `command relies on an unset shell var: ${line.trim()}`,
    );
  }
  assert.match(md, /getContext/, "it should name getContext as where the paths come from");
  assert.match(md, /params/, "and say the fit record arrives in the job params");
});

test("CLAUDE_MODEL overrides the pin, so a cheaper-model A/B is config, not a code change", () => {
  const prev = process.env.CLAUDE_MODEL;
  process.env.CLAUDE_MODEL = "claude-sonnet-5";
  try {
    const args = baseArgs("/tmp/mcp.json");
    assert.equal(args[args.indexOf("--model") + 1], "claude-sonnet-5");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_MODEL;
    else process.env.CLAUDE_MODEL = prev;
  }
});
