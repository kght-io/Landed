// Recruiter/interviewer email attachments under <ASSET_ROOT>/interview-prep/<slug>/attachments/.
// The "Pull interview emails" job downloads the files recruiters send (role/JD PDFs, prep guides,
// take-home specs) here so the interview-brief job can read them. Written by the app (it holds the
// IMAP connection); the buffers come from lib/gmail.ts getThreadAttachments.
import fs from "node:fs";
import path from "node:path";
import { PREP_ROOT } from "./export-context";

export const attachmentsDir = (slug: string) => path.join(PREP_ROOT, slug, "attachments");

// Sanitize an email-supplied filename to a safe basename: basename() drops any directory, then we
// drop control chars and the path separators (forward slash + backslash, code 92) while keeping
// normal chars incl. the extension dot. Falls back to "attachment" when empty. Pure.
export function safeName(name: string): string {
  const cleaned = Array.from(path.basename(name || ""))
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      return c >= 0x20 && c !== 0x2f && c !== 0x5c; // drop control, "/" (0x2f), "\" (0x5c)
    })
    .join("")
    .trim();
  return cleaned || "attachment";
}

// Pick a non-colliding filename given the names already present: keep as-is if free, else insert a
// numeric suffix before the extension (`role.pdf` -> `role-1.pdf`). Pure.
export function dedupeName(existing: Iterable<string>, name: string): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let i = 1;
  while (taken.has(`${stem}-${i}${ext}`)) i++;
  return `${stem}-${i}${ext}`;
}

export type SavedAttachment = { name: string; bytes: number };

// Write a batch of email attachments into a company's attachments/ folder, de-duping names against
// what's already there and within the batch. Fresh files (no in-place overwrite). Returns metadata.
export function saveAttachments(slug: string, files: { filename: string; content: Buffer }[]): SavedAttachment[] {
  if (!files.length) return [];
  const dir = attachmentsDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const taken = new Set(fs.readdirSync(dir));
  const saved: SavedAttachment[] = [];
  for (const f of files) {
    const name = dedupeName(taken, safeName(f.filename));
    taken.add(name);
    fs.writeFileSync(path.join(dir, name), f.content);
    saved.push({ name, bytes: f.content.length });
  }
  return saved;
}

// Names of the attachments already downloaded for a company (for the drawer's dumped-vs-missing
// status). Tolerates a missing folder.
export function listAttachments(slug: string): string[] {
  try {
    return fs.readdirSync(attachmentsDir(slug));
  } catch {
    return [];
  }
}
