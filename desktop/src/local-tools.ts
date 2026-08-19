import fs from "node:fs";
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

/** Same shape backend/src/db/prep.ts:311 generates. Anything else is not a slug we produced. */
const isSlug = (s: string): boolean => /^[a-z0-9-]+$/.test(s);

const baseResume = (root: string) => path.join(root, "resume", "resume-ref.docx");

/** The base résumé as visible text — what a human sees, which is what the agent must edit against. */
export function readBaseResumeText(root: string): string {
  return readVisibleText(fs.readFileSync(baseResume(root)));
}

export type BuildOutcome =
  | { ok: true; path: string; missed: [] }
  | { ok: false; missed: string[]; error?: string };

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
export function buildTailoredResume(root: string, slug: string, edits: Edit[]): BuildOutcome {
  if (!isSlug(slug)) return { ok: false, missed: [], error: `not a slug: ${JSON.stringify(slug)}` };

  const base = baseResume(root);
  if (!fs.existsSync(base)) return { ok: false, missed: [], error: "no base résumé — upload resume-ref.docx first" };

  const built = buildTailored(fs.readFileSync(base), edits);
  if (!built.docx) return { ok: false, missed: built.missed };

  const outDir = path.join(root, "resume", slug);
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, "resume.docx");

  // Sibling + rename, not a write to `target`. The temp name is dotted so a sync client that scans
  // the folder mid-build skips it, and the rename is atomic within the directory.
  const tmp = path.join(outDir, `.resume.docx.${process.pid}.tmp`);
  fs.writeFileSync(tmp, built.docx);
  fs.renameSync(tmp, target);

  return { ok: true, path: target, missed: [] };
}
