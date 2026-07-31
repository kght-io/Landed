import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLeetcodeUrl, prettyCompany, questionTopic } from "@landed/shared/prep/leetcode";

test("parseLeetcodeUrl extracts slug + provisional name from problem URLs", () => {
  assert.deepEqual(parseLeetcodeUrl("https://leetcode.com/problems/two-sum/"), { slug: "two-sum", name: "Two Sum" });
  assert.deepEqual(parseLeetcodeUrl("https://leetcode.com/problems/merge-k-sorted-lists/description/"), {
    slug: "merge-k-sorted-lists",
    name: "Merge K Sorted Lists",
  });
  // trailing query / no trailing slash / subdomain
  assert.deepEqual(parseLeetcodeUrl("https://www.leetcode.com/problems/lru-cache?tab=x"), { slug: "lru-cache", name: "Lru Cache" });
});

test("parseLeetcodeUrl returns null for non-problem or non-leetcode URLs", () => {
  assert.equal(parseLeetcodeUrl("https://leetcode.com/problemset/all/"), null);
  assert.equal(parseLeetcodeUrl("https://example.com/problems/two-sum/"), null);
  assert.equal(parseLeetcodeUrl("not a url"), null);
  assert.equal(parseLeetcodeUrl(""), null);
});

test("questionTopic prefers curriculum pattern, then first tag, then Uncategorized", () => {
  assert.equal(questionTopic({ plan: { pattern: "Sliding Window" }, tags: ["Array"] }), "Sliding Window");
  assert.equal(questionTopic({ tags: ["Heap", "Greedy"] }), "Heap");
  assert.equal(questionTopic({ tags: ["", "Graphs"] }), "Graphs");
  assert.equal(questionTopic({}), "Uncategorized");
  assert.equal(questionTopic({ tags: [] }), "Uncategorized");
});

test("prettyCompany title-cases a company slug", () => {
  assert.equal(prettyCompany("stripe"), "Stripe");
  assert.equal(prettyCompany("goldman-sachs"), "Goldman Sachs");
});
