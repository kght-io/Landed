// Building a tailored .docx WITHOUT shelling out to unzip/zip.
//
// Two reasons this matters beyond tidiness. First, `unzip` and `zip` being external binaries is
// what pins the agent's working directory to the repo and forces --permission-mode bypassPermissions
// — take the shell out and the folder the user picked can actually be the boundary. Second, a .docx
// is a zip of many parts and only word/document.xml carries the text: a rebuild that loses
// styles.xml produces a file Word opens as unstyled garbage, which is the kind of bug that shows up
// in front of a recruiter rather than in a test. So the round-trip is pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { buildTailored, readDocumentXml } from "../desktop/src/docx";

const wrap = (body: string) =>
  `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`;

const DOC_XML = wrap(
  `<w:p><w:r><w:t xml:space="preserve">Recently built a 0</w:t></w:r>` +
    `<w:r><w:t>→</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">1 full-stack product.</w:t></w:r></w:p>`,
);

// A .docx is a zip with several parts. styles.xml and the content types are what make Word render
// it as a document rather than as plain text, so the fixture carries them.
function fakeDocx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships/>'),
    "word/document.xml": strToU8(DOC_XML),
    "word/styles.xml": strToU8('<?xml version="1.0"?><w:styles><w:style w:styleId="Heading1"/></w:styles>'),
  });
}

function tmpBase(): { dir: string; base: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docx-build-"));
  const base = path.join(dir, "resume-ref.docx");
  fs.writeFileSync(base, fakeDocx());
  return { dir, base };
}

test("reads the visible text out of a real .docx container", () => {
  const { base } = tmpBase();
  assert.equal(readDocumentXml(fs.readFileSync(base)), DOC_XML);
});

test("a matched edit is written, and every other zip part survives", () => {
  const { dir, base } = tmpBase();
  const out = path.join(dir, "acme-corp");
  const res = buildTailored(fs.readFileSync(base), [{ find: "0→1 full-stack product.", replace: "0→1 ML product." }]);

  assert.equal(res.missed.length, 0);
  const rebuilt = res.docx;
  assert.ok(rebuilt);
  assert.match(readDocumentXml(rebuilt!), /ML product/);

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "resume.docx"), rebuilt!);
  // styles.xml is the part a naive "rezip just the document" would drop.
  const parts = res.parts;
  assert.ok(parts.includes("word/styles.xml"), `styles.xml missing from ${parts.join(", ")}`);
  assert.ok(parts.includes("[Content_Types].xml"));
});

test("an unmatched find writes NOTHING and names what missed", () => {
  // Loud beats silent: a find string that does not match means the agent's idea of the résumé is
  // wrong, and shipping a half-tailored document is worse than shipping none.
  const { base } = tmpBase();
  const res = buildTailored(fs.readFileSync(base), [
    { find: "0→1 full-stack product.", replace: "0→1 ML product." },
    { find: "a sentence that is not in this resume", replace: "anything" },
  ]);
  assert.equal(res.docx, null);
  assert.deepEqual(res.missed, ["a sentence that is not in this resume"]);
});

test("a container with no word/document.xml is refused, not guessed at", () => {
  const notADocx = zipSync({ "hello.txt": strToU8("hi") });
  assert.throws(() => readDocumentXml(notADocx), /document\.xml/);
});
