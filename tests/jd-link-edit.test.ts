import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { updateApplication, getPosting, listEvents } from "@landed/backend/db/queries";
import { reset, seedApp } from "./helpers";

// The JD link is now editable from the pipeline row, so `url` goes from a field only the scan wrote
// to one a person sets by hand. These pin the two things that would fail silently in the UI: that a
// typed link is actually stored, and that emptying the box CLEARS the link rather than parking an
// empty string where a URL should be.

test("editing the JD link persists it", () => {
  reset();
  const id = seedApp({ company: "Figma", role: "Staff SWE" });
  updateApplication(id, { url: "https://figma.com/careers/123" });
  assert.equal(getPosting(id)?.url, "https://figma.com/careers/123");
});

test("a JD link can be replaced with a different one", () => {
  reset();
  const id = seedApp({ company: "Figma", role: "Staff SWE" });
  updateApplication(id, { url: "https://figma.com/careers/123" });
  updateApplication(id, { url: "https://boards.greenhouse.io/figma/456" });
  assert.equal(getPosting(id)?.url, "https://boards.greenhouse.io/figma/456");
});

// Emptying the input sends null, not "". An empty string is a URL the UI would still try to render
// as a link — a dead one — so the clear path has to bottom out at null.
test("clearing the JD link stores null, not an empty string", () => {
  reset();
  const id = seedApp({ company: "Figma", role: "Staff SWE" });
  updateApplication(id, { url: "https://figma.com/careers/123" });
  updateApplication(id, { url: null });
  const after = getPosting(id);
  assert.equal(after?.url ?? null, null);
  assert.notEqual(after?.url, "");
});

// Every other hand-edited field lands in the change log; a link edit is no different, and it's the
// one that most needs an audit trail (a wrong URL sends you to the wrong req).
test("a JD link change is recorded in the change log with old → new", () => {
  reset();
  const id = seedApp({ company: "Figma", role: "Staff SWE" });
  updateApplication(id, { url: "https://figma.com/careers/123" });
  updateApplication(id, { url: "https://figma.com/careers/999" });

  const urlEvents = listEvents().filter((e) => e.field === "url");
  assert.equal(urlEvents.length, 2, "one event per change");
  const latest = urlEvents[0];
  assert.equal(latest.oldValue, "https://figma.com/careers/123");
  assert.equal(latest.newValue, "https://figma.com/careers/999");
});

test("re-saving the same JD link logs nothing", () => {
  reset();
  const id = seedApp({ company: "Figma", role: "Staff SWE" });
  updateApplication(id, { url: "https://figma.com/careers/123" });
  updateApplication(id, { url: "https://figma.com/careers/123" });
  assert.equal(listEvents().filter((e) => e.field === "url").length, 1);
});
