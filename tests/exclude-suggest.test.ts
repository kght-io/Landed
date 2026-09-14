import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestExclusions } from "@landed/shared/jobs/exclude-suggest";

// Turning a discard into a filter rule has to cost one click, or it won't happen — which is the whole
// problem this closes. The label already says WHICH axis ("stack mismatch"); the only thing missing is
// the keyword, and the posting title is sitting right there.
//
// Deliberately a pure lookup over a vocabulary, NOT a model call. A suggestion that arrives after the
// popup has closed is worse than none, and every LLM call here goes through the job queue, which is
// asynchronous by design.

test("a stack discard suggests the technology named in the title", () => {
  const s = suggestExclusions("stack", ["Senior iOS Engineer, Payments"], []);
  assert.ok(s.includes("iOS"), `expected iOS in ${JSON.stringify(s)}`);
});

// Axis discipline: the same title carries a stack term AND a domain term, and each axis must see only
// its own. Suggesting "payments" for a `stack` discard would write the user's reason down wrong.
test("each axis suggests only its own kind of term", () => {
  const title = "Senior iOS Engineer, Payments";
  assert.deepEqual(suggestExclusions("stack", [title], []), ["iOS"]);
  assert.deepEqual(suggestExclusions("domain", [title], []), ["payments"]);
});

test("a role discard suggests the job family", () => {
  assert.ok(suggestExclusions("role", ["Site Reliability Engineer II"], []).includes("SRE"));
  assert.ok(suggestExclusions("role", ["Data Engineer, Analytics Platform"], []).includes("data engineering"));
});

// Already-excluded terms are noise: the rule exists, and offering it again teaches the user the
// popup doesn't know what they've told it.
test("terms already on the axis are not suggested again", () => {
  assert.deepEqual(suggestExclusions("stack", ["Senior iOS Engineer"], ["iOS"]), []);
});

test("the already-excluded check ignores case and surrounding text", () => {
  assert.deepEqual(suggestExclusions("stack", ["Senior iOS Engineer"], ["mobile (iOS / Android)"]), []);
});

// Bulk discard is the dominant path — selecting rows that share a reason is what makes a batch label
// meaningful. The term most of the batch shares is the one worth offering first.
test("a batch ranks the term the most postings share first", () => {
  const s = suggestExclusions("stack", [
    "Android Engineer, Core",
    "Senior Android Engineer, Growth",
    "Frontend Engineer, Web",
  ], []);
  assert.equal(s[0], "Android", `expected Android first in ${JSON.stringify(s)}`);
  assert.ok(s.includes("frontend"));
});

// No match means no popup. A prompt offering nothing is a click the user has to spend to dismiss.
test("a title with nothing recognisable suggests nothing", () => {
  assert.deepEqual(suggestExclusions("stack", ["Software Engineer"], []), []);
});

// A vocabulary entry matches its aliases but stores ONE canonical label, so the profile doesn't
// accumulate "iOS", "ios" and "iPhone" as three separate rules.
test("aliases collapse to one canonical term", () => {
  assert.deepEqual(suggestExclusions("stack", ["iPhone Engineer", "iOS Engineer"], []), ["iOS"]);
});

// The initialism is how these titles usually name the discipline — "SWE, ML Platform" says nothing
// about "machine learning", so spelled-out aliases alone missed the common case.
test("an initialism counts as an alias", () => {
  assert.ok(suggestExclusions("role", ["Software Engineer, ML Platform"], []).includes("ML / AI research"));
  assert.ok(suggestExclusions("role", ["Senior SWE, ML Infrastructure"], []).includes("ML / AI research"));
});

// Bare `AI` must NOT be an alias: at an AI lab it sits on core infrastructure roles that are exactly
// what this search is for, so it would suppress the best postings on the board.
test("bare AI is not treated as the ML discipline", () => {
  assert.deepEqual(suggestExclusions("role", ["Software Engineer, AI Platform"], []), []);
});

// Word boundaries, not substrings. "Go" inside "Google" and "React" inside "Reactor" are the classic
// way a keyword filter starts eating good postings.
test("a term matches on word boundaries, not substrings", () => {
  assert.deepEqual(suggestExclusions("stack", ["Software Engineer, Google Cloud"], []), []);
  assert.ok(suggestExclusions("stack", ["Engineer, Go Runtime"], []).includes("Go"));
});

// The popup is a menu, not a report — a long list stops being one click.
test("the list is capped", () => {
  const s = suggestExclusions("domain", [
    "Engineer, Ads",
    "Engineer, Payments",
    "Engineer, Growth Marketing",
    "Engineer, Crypto Wallet",
    "Engineer, Trust & Safety",
    "Engineer, Search Ranking",
  ], []);
  assert.ok(s.length <= 4, `capped, got ${s.length}`);
});

test("department text is searched along with the title", () => {
  assert.ok(suggestExclusions("role", ["Software Engineer — Machine Learning Research"], []).includes("ML / AI research"));
});
