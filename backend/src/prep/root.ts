// Where the per-company interview-prep folders live, and how we write into them. Its own module so
// the two writers that share it — transcripts.ts (dumps transcripts/) and export-context.ts (dumps
// context.md, questions.md, emails.md) — can both depend on it without depending on each other.
import fs from "node:fs";
import path from "node:path";
import { ASSET_ROOT } from "../config";

export const PREP_ROOT = path.join(ASSET_ROOT, "interview-prep");
export const transcriptsDir = (slug: string) => path.join(PREP_ROOT, slug, "transcripts");

// Write a dump through a temp file + rename, so the result is a FRESH inode rather than an in-place
// truncate-and-write. ASSET_ROOT is typically a cloud-synced folder, where overwriting a file the
// sync daemon is holding open corrupts it; a rename swaps the directory entry atomically instead.
export function writeFresh(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
