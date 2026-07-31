import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, db } from "./helpers";
import { prepQuestions, prepAttempts, prepCompany } from "@landed/backend/db/schema";
import { addLeetcodeStub, listQuestions } from "@landed/backend/db/prep";
import { submitJobResult } from "@landed/backend/jobs/store";

function resetPrep() {
  reset();
  for (const t of [prepAttempts, prepQuestions, prepCompany]) db.delete(t).run();
}
beforeEach(() => resetPrep());

const coding = () => listQuestions({ track: "coding" });

test("addLeetcodeStub inserts a pending coding stub with slug-derived name + topic tag", () => {
  const r = addLeetcodeStub({ url: "https://leetcode.com/problems/two-sum/", topic: "Hash Table" });
  assert.equal(r.status, "created");
  const all = coding();
  assert.equal(all.length, 1);
  const q = all[0];
  assert.equal(q.name, "Two Sum");
  assert.equal(q.track, "coding");
  assert.equal(q.difficulty, undefined); // not yet enriched
  assert.deepEqual(q.tags, ["Hash Table"]);
  assert.equal(q.content.pendingEnrich, true);
});

test("addLeetcodeStub with no topic leaves tags empty for the job to fill", () => {
  const r = addLeetcodeStub({ url: "https://leetcode.com/problems/lru-cache/" });
  assert.equal(r.status, "created");
  assert.deepEqual(coding()[0].tags, []);
});

test("addLeetcodeStub rejects a non-LeetCode URL without inserting", () => {
  const r = addLeetcodeStub({ url: "https://example.com/foo" });
  assert.equal(r.status, "invalid");
  assert.equal(coding().length, 0);
});

test("addLeetcodeStub dedupes against an existing bank question by name (no duplicate)", () => {
  db.insert(prepQuestions)
    .values({ id: "lc-1", track: "coding", name: "Two Sum", leetcodeNum: 1, difficulty: "Easy", tags: "[]", companies: "[]", content: "{}", sortOrder: 1 })
    .run();
  const r = addLeetcodeStub({ url: "https://leetcode.com/problems/two-sum/" });
  assert.equal(r.status, "exists");
  assert.equal(coding().length, 1); // still just the original
});

test("leetcode-add job fills difficulty/name/topic and clears the pending flag", () => {
  const created = addLeetcodeStub({ url: "https://leetcode.com/problems/two-sum/" });
  assert.equal(created.status, "created");
  const id = created.status === "created" ? created.question.id : "";

  submitJobResult({
    type: "leetcode-add",
    jobId: "leetcode-add-1",
    records: [{ id, name: "Two Sum", difficulty: "Easy", topic: "Hash Table", leetcodeNum: 1 }],
  });

  const q = coding().find((x) => x.id === id)!;
  assert.equal(q.difficulty, "Easy");
  assert.equal(q.leetcodeNum, 1);
  assert.deepEqual(q.tags, ["Hash Table"]);
  assert.equal(q.content.pendingEnrich, undefined); // cleared
});

test("leetcode-add keeps a user-supplied topic instead of overriding it", () => {
  const created = addLeetcodeStub({ url: "https://leetcode.com/problems/kth-largest-element-in-an-array/", topic: "Heap" });
  const id = created.status === "created" ? created.question.id : "";
  submitJobResult({
    type: "leetcode-add",
    jobId: "leetcode-add-2",
    records: [{ id, difficulty: "Medium", topic: "Quickselect" }],
  });
  const q = coding().find((x) => x.id === id)!;
  assert.deepEqual(q.tags, ["Heap"]); // user's topic wins
  assert.equal(q.difficulty, "Medium");
});

test("leetcode-add skips an unknown id", () => {
  const out = submitJobResult({
    type: "leetcode-add",
    jobId: "leetcode-add-3",
    records: [{ id: "does-not-exist", difficulty: "Hard" }],
  });
  assert.equal(coding().length, 0);
  assert.ok(out); // does not throw
});
