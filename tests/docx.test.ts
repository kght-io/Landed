import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, visibleText } from "@landed/shared/resume/docx";

// Minimal WordprocessingML fixtures. The point of this helper is that Word splits a single visible
// sentence across several <w:r>/<w:t> runs, so a naive string search on document.xml misses any
// find that straddles a run boundary. These fixtures reproduce that fragmentation.

const wrap = (body: string) =>
  `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`;

// One paragraph, three runs — mirrors the real base résumé: "...built a 0" | "→" | "1 full-stack..."
const fragmented = wrap(
  `<w:p><w:r><w:t xml:space="preserve">Recently built a 0</w:t></w:r>` +
    `<w:r><w:t>→</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">1 full-stack product as a founder.</w:t></w:r></w:p>`,
);

test("visibleText concatenates runs and decodes entities", () => {
  const xml = wrap(`<w:p><w:r><w:t>trust &amp; risk</w:t></w:r></w:p>`);
  assert.equal(visibleText(xml), "trust & risk");
});

test("replaces text that straddles a run boundary", () => {
  const { xml, results } = applyEdits(fragmented, [
    { find: "0→1 full-stack product", replace: "0→1 distributed backend product" },
  ]);
  assert.equal(results[0].matched, true);
  assert.equal(visibleText(xml), "Recently built a 0→1 distributed backend product as a founder.");
  // Still well-formed: every <w:t> opened is closed.
  assert.equal((xml.match(/<w:t\b/g) || []).length, (xml.match(/<\/w:t>/g) || []).length);
});

test("re-encodes special characters and preserves existing entities elsewhere", () => {
  const xml = wrap(`<w:p><w:r><w:t>advertising, trust &amp; risk, and rec</w:t></w:r></w:p>`);
  const { xml: out, results } = applyEdits(xml, [
    { find: "trust & risk", replace: "safety & abuse" },
  ]);
  assert.equal(results[0].matched, true);
  assert.equal(visibleText(out), "advertising, safety & abuse, and rec");
  assert.match(out, /safety &amp; abuse/); // literal & was re-escaped, not left raw
  assert.doesNotMatch(out, /safety & abuse/);
});

test("reports an unmatched find without altering the document", () => {
  const { xml, results } = applyEdits(fragmented, [
    { find: "this text is not present", replace: "x" },
  ]);
  assert.equal(results[0].matched, false);
  assert.equal(xml, fragmented);
});

test("does not match across a paragraph boundary", () => {
  const twoPara = wrap(
    `<w:p><w:r><w:t>alpha</w:t></w:r></w:p><w:p><w:r><w:t>beta</w:t></w:r></w:p>`,
  );
  const { xml, results } = applyEdits(twoPara, [{ find: "alphabeta", replace: "x" }]);
  assert.equal(results[0].matched, false);
  assert.equal(xml, twoPara);
});

test("applies multiple edits in sequence", () => {
  const { xml, results } = applyEdits(fragmented, [
    { find: "Recently built", replace: "Shipped" },
    { find: "full-stack product", replace: "backend service" },
  ]);
  assert.deepEqual(
    results.map((r) => r.matched),
    [true, true],
  );
  assert.equal(visibleText(xml), "Shipped a 0→1 backend service as a founder.");
});
