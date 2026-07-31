// Tailoring helper for the Résumé Tailor agent. Given the base .docx and a JSON list of
// {find, replace} edits, it produces a tailored resume.docx + resume.pdf in the output folder —
// handling Word's run fragmentation (via lib/resume/docx) and the PDF render (via soffice) so the
// agent never re-derives either. Build happens in a temp dir, then files are copied into the
// (cloud-synced) output folder as fresh inodes; see the ASSET_ROOT overwrite-corruption note.
//
// Usage:
//   node --import tsx scripts/tailor-docx.ts <base.docx> <outDir> <edits.json>
//   node --import tsx scripts/tailor-docx.ts <base.docx> --text   # dump visible text, make no edits
//
// edits.json: [{ "find": "<verbatim base text>", "replace": "<tailored text>" }, ...]
// Prints one line per edit (✓ matched / ✗ MISSED) so an unmatched find is loud, not silent.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyEdits, visibleText, type Edit } from "@landed/shared/resume/docx";

const DOC = "word/document.xml";

function unzipDocumentXml(docx: string, dir: string): string {
  execFileSync("unzip", ["-o", "-q", docx, "-d", dir]);
  return fs.readFileSync(path.join(dir, DOC), "utf8");
}

function main() {
  const [base, arg2, editsPath] = process.argv.slice(2);
  if (!base || !fs.existsSync(base)) {
    console.error("usage: tailor-docx <base.docx> <outDir> <edits.json>  |  <base.docx> --text");
    process.exit(2);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-"));
  const xml = unzipDocumentXml(base, tmp);

  if (arg2 === "--text") {
    process.stdout.write(visibleText(xml) + "\n");
    return;
  }

  const outDir = arg2;
  if (!outDir || !editsPath) {
    console.error("need <outDir> and <edits.json> (or --text)");
    process.exit(2);
  }
  const edits = JSON.parse(fs.readFileSync(editsPath, "utf8")) as Edit[];
  const { xml: tailored, results } = applyEdits(xml, edits);

  let missed = 0;
  for (const r of results) {
    if (!r.matched) missed++;
    console.log(`${r.matched ? "✓" : "✗ MISSED"}  ${JSON.stringify(r.find).slice(0, 80)}`);
  }
  if (missed) {
    console.error(`\n${missed} edit(s) did not match the base text — fix the find strings; nothing written.`);
    process.exit(1);
  }

  // Rewrite document.xml in the unzipped tree, then rezip the tree into a fresh .docx built OUTSIDE
  // the tree (so it can't zip itself). Rebuild dir is separate from the source tree.
  fs.writeFileSync(path.join(tmp, DOC), tailored);
  const built = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-out-"));
  const builtDocx = path.join(built, "resume.docx");
  execFileSync("zip", ["-q", "-r", "-X", builtDocx, "."], { cwd: tmp });

  execFileSync("soffice", [
    "--headless",
    "-env:UserInstallation=file:///tmp/lo-jobhunt",
    "--convert-to", "pdf",
    "--outdir", built,
    builtDocx,
  ]);
  const builtPdf = path.join(built, "resume.pdf");
  if (!fs.existsSync(builtPdf) || fs.statSync(builtPdf).size === 0) {
    console.error("soffice did not produce a non-empty resume.pdf");
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(builtDocx, path.join(outDir, "resume.docx"));
  fs.copyFileSync(builtPdf, path.join(outDir, "resume.pdf"));
  console.log(`\n✓ wrote resume.docx + resume.pdf to ${outDir}`);
}

main();
