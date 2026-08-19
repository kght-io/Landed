// What has to be true before this app can do anything, and what to say when it is not.
//
// On the machine this was built on, all of it is already true — `claude` is installed and logged in,
// LibreOffice is there, the backend is up. On anyone else's, at least one will not be, and the
// difference between a product and a script is whether that arrives as guidance or as a stack trace
// in a transcript nobody opened.
//
// The checks themselves shell out; the JUDGEMENT — what blocks, what merely degrades, what to tell
// someone — is pure, and that is what these pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, type Checks } from "../desktop/src/preflight";

const ok: Checks = {
  claude: { ok: true, detail: "2.1.233" },
  login: { ok: true },
  backend: { ok: true },
  soffice: { ok: true },
  folder: { ok: true, detail: "/Users/x/Landed" },
};

test("everything present: ready, nothing to say", () => {
  const s = summarize(ok);
  assert.equal(s.ready, true);
  assert.deepEqual(s.blocking, []);
  assert.deepEqual(s.warnings, []);
});

test("no claude binary blocks, and the fix is the install command", () => {
  const s = summarize({ ...ok, claude: { ok: false } });
  assert.equal(s.ready, false);
  assert.equal(s.blocking[0].id, "claude");
  assert.match(s.blocking[0].fix, /install/i);
});

test("logged out blocks separately from missing — different problem, different fix", () => {
  // Conflating them sends someone to reinstall a CLI they already have.
  const s = summarize({ ...ok, login: { ok: false } });
  assert.equal(s.blocking.length, 1);
  assert.equal(s.blocking[0].id, "login");
  // The fix must send them to the CLI they already have — not to install it again.
  assert.match(s.blocking[0].fix, /`claude`/);
  assert.doesNotMatch(s.blocking[0].fix, /install/i);
});

test("an unreachable backend blocks — there is no queue to drain without it", () => {
  const s = summarize({ ...ok, backend: { ok: false, detail: "http://localhost:3000" } });
  assert.equal(s.blocking[0].id, "backend");
  assert.match(s.blocking[0].detail ?? "", /localhost:3000/);
});

test("missing LibreOffice WARNS rather than blocks — résumés still build, minus the PDF", () => {
  // The distinction matters: blocking on it would stop fit, inbox-sync and prep, none of which
  // touch a PDF, over a dependency only tailoring needs.
  const s = summarize({ ...ok, soffice: { ok: false } });
  assert.equal(s.ready, true);
  assert.deepEqual(s.blocking, []);
  assert.equal(s.warnings[0].id, "soffice");
});

test("blocking items come back in fix-order, not check-order", () => {
  // Someone with nothing set up should be told to install the CLI before being told to log into it.
  const s = summarize({
    claude: { ok: false },
    login: { ok: false },
    backend: { ok: false },
    soffice: { ok: false },
    folder: { ok: false },
  });
  assert.deepEqual(s.blocking.map((b) => b.id), ["folder", "claude", "login", "backend"]);
});
