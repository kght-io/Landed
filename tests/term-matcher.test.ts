import { test } from "node:test";
import assert from "node:assert/strict";
import { termMatcher } from "@landed/shared/jobs/exclude";

// Stage 1's filter lists are profile data now, so the grammar a term is written in is the contract
// between what you type on the Profile page and what gets dropped. It has to be small enough to write
// without thinking about regex, and strict enough that a short term can't eat a good posting.

test("a term matches whole words, case-insensitively", () => {
  const m = termMatcher(["sales"]);
  assert.equal(m("Enterprise SALES Engineer"), true);
  assert.equal(m("Salesforce Platform Engineer"), false, "not a substring");
});

test("a multi-word term matches as a phrase", () => {
  const m = termMatcher(["head of"]);
  assert.equal(m("Head of Music"), true);
  assert.equal(m("Senior Engineer, Headless Commerce"), false);
});

// "go-to-market" and "go to market" are the same title written two ways; making the user list both
// is how a list ends up covering one spelling and missing the other.
test("a hyphen and a space are interchangeable", () => {
  const m = termMatcher(["forward deployed"]);
  assert.equal(m("Forward-Deployed Engineer"), true);
  assert.equal(m("Forward Deployed Engineer"), true);
});

// A trailing `*` is the one wildcard: a word stem. It replaces `recruit\w*` and `data scien\w*`.
test("a trailing * matches any word ending", () => {
  const m = termMatcher(["recruit*"]);
  assert.equal(m("Technical Recruiter"), true);
  assert.equal(m("Recruiting Coordinator"), true);
  assert.equal(m("Senior Engineer"), false);
});

test("a term with a symbol at either edge still matches on its own", () => {
  assert.equal(termMatcher(["u.s."])("Remote (U.S.)"), true);
  assert.equal(termMatcher(["c++"])("Senior C++ Engineer"), true);
});

// Everything else is literal. A term is data typed into a form — a `(` or `?` in it must not become
// regex syntax that throws, or silently matches something else.
test("regex metacharacters in a term are literal", () => {
  assert.equal(termMatcher(["remote (us)"])("Remote (US)"), true);
  assert.doesNotThrow(() => termMatcher(["a[b", "(unclosed"])("anything"));
});

test("blank terms and an empty list match nothing", () => {
  assert.equal(termMatcher([])("Enterprise Sales Engineer"), false);
  assert.equal(termMatcher(["", "   "])("Enterprise Sales Engineer"), false);
});
