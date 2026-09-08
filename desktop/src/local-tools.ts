import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Edit } from "@landed/shared/resume/docx";
import { buildTailored, readVisibleText } from "./docx";

// THE MACHINE HALF OF THE AGENT'S TOOLS.
//
// mcp/jobhunt-server.mjs stays exactly what its header promises — a zero-dependency HTTP client
// that holds no state, never opens the DB, and never touches disk. These tools are the other half,
// and they live in a SEPARATE local MCP server for that reason: the data half can point at the
// cloud while the file half stays on the machine the résumés are on. One server doing both would
// have to be in two places at once.
//
// Root is a parameter rather than a module constant so the rules below are testable without an
// Electron app around them.

// The app's slug is a PATH, not a single name: tailoring writes versioned folders like
// "acme-senior-123/v2" (see backend/src/config.ts resolveResume, which allows any slug that stays
// inside the resume dir). So the rule is per SEGMENT — each one shaped like the slugs
// backend/src/db/prep.ts's companySlug generates — with no empty segments, no traversal, and no leading
// slash. Narrow enough that containment falls out of the charset instead of needing a realpath.
const SLUG = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const isSlug = (s: string): boolean => SLUG.test(s);

const baseResume = (root: string) => path.join(root, "resume", "resume-ref.docx");

/** The base résumé as visible text — what a human sees, which is what the agent must edit against. */
export function readBaseResumeText(root: string): string {
  return readVisibleText(fs.readFileSync(baseResume(root)));
}

export type BuildOutcome =
  | { ok: true; path: string; pdf: string | null; missed: []; note?: string }
  | { ok: false; missed: string[]; error?: string };

/**
 * Render a .docx to PDF with LibreOffice, returning null when it is not installed.
 *
 * Still a subprocess — there is no in-process renderer worth trusting with a résumé's layout — but
 * it is OURS now rather than the agent's. That matters twice: the agent no longer needs a shell to
 * tailor (which is what let cwd stop being the repo), and a missing soffice becomes a value the
 * agent can report instead of an exit code it might try to route around. The playbook is explicit
 * that improvising with fpdf/reportlab/pandoc is wrong; this makes that the easy path.
 *
 * Injectable so the missing-binary branch is testable without uninstalling LibreOffice.
 */
export function convertToPdf(docx: string, outDir: string, run: typeof execFileSync = execFileSync): string | null {
  try {
    run("soffice", [
      "--headless",
      // A private profile dir: a soffice already open for the user holds a lock on the default one,
      // and the conversion then silently does nothing.
      "-env:UserInstallation=file:///tmp/lo-landed",
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      docx,
    ]);
  } catch {
    return null; // not installed, or refused — the caller reports it rather than guessing
  }
  const pdf = path.join(outDir, "resume.pdf");
  // soffice can exit 0 having written nothing; an empty file is the same failure as no file.
  return fs.existsSync(pdf) && fs.statSync(pdf).size > 0 ? pdf : null;
}

/**
 * Write a tailored résumé to resume/<slug>/resume.docx.
 *
 * Two things here are contracts rather than implementation:
 *
 * All-or-nothing. One `find` that matches nothing means the agent's model of the résumé disagrees
 * with the résumé; the previous tailored file is left exactly as it was, because a half-applied
 * edit set produces a document that looks finished and is not.
 *
 * A fresh inode, every time. ASSET_ROOT is typically a cloud-synced folder, and rewriting a file in
 * place there has corrupted résumés before — the sync client reads the same inode as it is being
 * rewritten. Writing a sibling and renaming over the target sidesteps it: readers see either the
 * old file or the new one, never a half-written one.
 */
export function buildTailoredResume(
  root: string,
  slug: string,
  edits: Edit[],
  run: typeof execFileSync = execFileSync,
): BuildOutcome {
  if (!isSlug(slug)) return { ok: false, missed: [], error: `not a slug: ${JSON.stringify(slug)}` };

  const base = baseResume(root);
  if (!fs.existsSync(base))
    return { ok: false, missed: [], error: "no base résumé — upload resume-ref.docx in the app's Settings first" };

  const built = buildTailored(fs.readFileSync(base), edits);
  // Nothing is written when any `find` misses — a partial résumé is worse than none, and the
  // previous version in this folder stays untouched. The guidance rides on the FAILURE rather than
  // in the playbook, so it's read at the moment it applies instead of on every run: Word splits one
  // visible sentence across several runs, so a `find` copied from anywhere but readBaseResumeText()
  // will straddle a run boundary and miss. Re-copy it verbatim — watch the em-dash (→), double
  // spaces, and &. Never fall back to editing document.xml by hand.
  if (!built.docx)
    return {
      ok: false,
      missed: built.missed,
      error:
        `${built.missed.length} find string${built.missed.length === 1 ? "" : "s"} did not match the base résumé, so nothing was written. ` +
        "Re-copy each one VERBATIM from readBaseResumeText() — Word fragments a sentence across runs, " +
        "so text taken from anywhere else won't match. Watch for the em-dash (→), double spaces and &. " +
        "Do not hand-edit document.xml.",
    };

  const outDir = path.join(root, "resume", slug);
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, "resume.docx");

  // Sibling + rename, not a write to `target`. The temp name is dotted so a sync client that scans
  // the folder mid-build skips it, and the rename is atomic within the directory.
  const tmp = path.join(outDir, `.resume.docx.${process.pid}.tmp`);
  fs.writeFileSync(tmp, built.docx);
  fs.renameSync(tmp, target);

  // The PDF is rendered in a scratch dir and moved in, for the same fresh-inode reason as above.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "landed-pdf-"));
  fs.copyFileSync(target, path.join(scratch, "resume.docx"));
  const rendered = convertToPdf(path.join(scratch, "resume.docx"), scratch, run);
  let pdf: string | null = null;
  if (rendered) {
    pdf = path.join(outDir, "resume.pdf");
    const pdfTmp = path.join(outDir, `.resume.pdf.${process.pid}.tmp`);
    fs.copyFileSync(rendered, pdfTmp);
    fs.renameSync(pdfTmp, pdf);
  }
  fs.rmSync(scratch, { recursive: true, force: true });

  return {
    ok: true,
    path: target,
    pdf,
    missed: [],
    // A .docx with no PDF is a partial result the agent must SAY it produced, not paper over.
    // A .docx with no PDF is a partial result the agent must SAY it produced, not paper over — and
    // must not try to fix with another library. Both instructions live here rather than in the
    // playbook because this is the only run where they matter.
    ...(pdf
      ? {}
      : {
          note:
            "LibreOffice (soffice) is not available — wrote resume.docx only, no PDF. " +
            "Report this note in your result. Do NOT render the PDF another way " +
            "(fpdf / reportlab / weasyprint / pandoc all lose the template's formatting).",
        }),
  };
}
