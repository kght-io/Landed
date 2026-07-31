import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { nextSessionName, saveMockSession, listMockSessions, mockDir } from "@landed/backend/prep/mock-interviews";

// The temp ASSET_ROOT is shared across this file's tests — clear the mock-interviews folder between
// them so each starts from a known-empty tree.
beforeEach(() => fs.rmSync(mockDir(), { recursive: true, force: true }));

test("nextSessionName returns one past the highest session-<n>.md; ignores non-matching files and gaps", () => {
  assert.equal(nextSessionName([]), "session-1.md");
  assert.equal(nextSessionName(["session-1.md"]), "session-2.md");
  assert.equal(nextSessionName(["session-1.md", "session-3.md"]), "session-4.md"); // gaps ignored, uses max
  assert.equal(nextSessionName(["readme.md", "notes.txt", "session-2.md"]), "session-3.md"); // non-matching ignored
});

test("saveMockSession writes a fresh numbered file with title + notes + rendered gaps", () => {
  const file = saveMockSession({
    notes: "System design mock — lost the thread on sharding.",
    title: "Mock 2026-07-10",
    gaps: [{ area: "system-design", detail: "Couldn't reason about hot-key sharding", severity: "high" }],
  });
  assert.equal(file.name, "session-1.md");
  const body = fs.readFileSync(path.join(mockDir(), file.name), "utf8");
  assert.match(body, /^# Mock 2026-07-10\n/);
  assert.match(body, /System design mock/);
  assert.match(body, /## Gaps surfaced/);
  assert.match(body, /\*\*system-design\*\* \(high\): Couldn't reason about hot-key sharding/);
});

test("each save is a new numbered inode (never in-place); notes-only and no-title are fine", () => {
  const first = saveMockSession({ notes: "First session." });
  const second = saveMockSession({ notes: "Second session, no gaps, no title." });
  assert.equal(first.name, "session-1.md");
  assert.equal(second.name, "session-2.md");
  const body = fs.readFileSync(path.join(mockDir(), second.name), "utf8");
  assert.doesNotMatch(body, /^#/); // no title heading
  assert.doesNotMatch(body, /## Gaps surfaced/); // no gaps section when none given
  assert.deepEqual(
    listMockSessions().map((s) => s.name).sort(),
    ["session-1.md", "session-2.md"],
  );
});

test("listMockSessions tolerates a missing folder", () => {
  // Fresh temp ASSET_ROOT per run, but the folder is only created on first save — before any save in a
  // clean tree it must not throw. (Guarded by reading a subdir that doesn't exist here.)
  const names = listMockSessions().map((s) => s.name);
  assert.ok(Array.isArray(names));
});
