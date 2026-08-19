import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { applyEdits, visibleText, type Edit } from "@landed/shared/resume/docx";

// BUILDING A TAILORED RÉSUMÉ, IN PROCESS.
//
// This replaces the `unzip` / `zip` half of scripts/tailor-docx.ts. That script exists because the
// agent shells out to it, and shelling out is what forces two things we want gone: a working
// directory pinned to the repo (the script lives there) and --permission-mode bypassPermissions
// (it needs a shell). Doing the zip work here means the agent can call a tool instead, and the
// folder the user picked can be a real boundary rather than an aspiration.
//
// The text surgery itself is NOT here — applyEdits/visibleText already live in shared/ and are
// tested against Word's run fragmentation, which is the genuinely hard part. This file is the
// container: get document.xml out, put it back, leave every other part alone.

const DOC = "word/document.xml";

/** The WordprocessingML of a .docx's main document part. Throws if this is not a .docx. */
export function readDocumentXml(docx: Uint8Array): string {
  const files = unzipSync(docx);
  const doc = files[DOC];
  // Refused rather than guessed at: a zip without this part is some other kind of file, and
  // picking "the first xml that looks close" would produce a plausible wrong answer.
  if (!doc) throw new Error(`not a .docx — no ${DOC} inside`);
  return strFromU8(doc);
}

/** The résumé's visible text, for an agent that needs to see what it is editing. */
export function readVisibleText(docx: Uint8Array): string {
  return visibleText(readDocumentXml(docx));
}

export type BuildResult = {
  /** The rebuilt document, or null when any edit missed — see `missed`. */
  docx: Uint8Array | null;
  /** The `find` strings that matched nothing. Non-empty means nothing was built. */
  missed: string[];
  /** Every part carried through from the original, so a caller can assert nothing was dropped. */
  parts: string[];
};

/**
 * Apply edits to a base .docx and return the rebuilt file.
 *
 * All-or-nothing on purpose. A `find` that matches nothing means the agent's model of the résumé
 * disagrees with the résumé, and a half-tailored document is worse than none — it looks finished.
 * So a single miss returns docx: null and names what missed, rather than writing what did match.
 *
 * Every other zip entry is carried through byte-for-byte. Only document.xml changes; styles,
 * relationships, fonts, and numbering are exactly what Word wrote, because rebuilding them is how
 * you get a file that opens as unstyled text.
 */
export function buildTailored(base: Uint8Array, edits: Edit[]): BuildResult {
  const files = unzipSync(base);
  const doc = files[DOC];
  if (!doc) throw new Error(`not a .docx — no ${DOC} inside`);

  const { xml, results } = applyEdits(strFromU8(doc), edits);
  const missed = results.filter((r) => !r.matched).map((r) => r.find);
  const parts = Object.keys(files);
  if (missed.length > 0) return { docx: null, missed, parts };

  return { docx: zipSync({ ...files, [DOC]: strToU8(xml) }), missed: [], parts };
}
