// Call-transcript capture. The app can't record interview calls, so you paste a transcript into the
// drawer and it's stored as a row (db/prep-assets.ts) keyed by the company's canonical slug.
//
// It used to be written straight to <ASSET_ROOT>/interview-prep/<slug>/transcripts/transcript-N.md
// and read back from there — knowledge that only existed on the user's laptop. The DB is the record
// now; that folder is still written, as a regenerated DUMP (prep/export-context.ts), so the
// interview-brief job and a per-company prep chat keep reading the files they always read.
import fs from "node:fs";
import path from "node:path";
import { getTranscriptRow, insertTranscriptRow, listTranscriptRows } from "../db/prep-assets";
import { transcriptsDir, writeFresh } from "./root";

// The next collision-free name: one past the highest existing `transcript-<n>.md` index. Pure so
// it's unit-testable; non-transcript names and gaps in the numbering are ignored.
export function nextTranscriptName(existing: string[]): string {
  let max = 0;
  for (const f of existing) {
    const m = /^transcript-(\d+)\.md$/.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `transcript-${max + 1}.md`;
}

// What the drawer lists. `bytes` is the transcript's size — it used to be the file's, and is now the
// row's, so the shape the UI renders is unchanged.
export type TranscriptFile = { name: string; bytes: number; at: string; title?: string };

// `bytes` measures the RENDERED transcript (title + body), so it matches the dumped file's size —
// it was the file's size before the move, and the drawer shows the same number as it always did.
const meta = (t: { name: string; body: string; at: string; title?: string }): TranscriptFile => ({
  name: t.name, bytes: Buffer.byteLength(renderTranscript(t)), at: t.at, title: t.title,
});

// Every transcript stored for a company, newest first.
export function listTranscripts(slug: string): TranscriptFile[] {
  return listTranscriptRows(slug).map(meta);
}

// One transcript's markdown (title as an H1 + body), or null if there's no such row. This is the
// exact text the dump writes to disk, so the file and the row can't drift.
export function readTranscript(slug: string, name: string): string | null {
  const t = getTranscriptRow(slug, name);
  return t ? renderTranscript(t) : null;
}

export function renderTranscript(t: { title?: string; body: string }): string {
  const heading = t.title?.trim() ? `# ${t.title.trim()}\n\n` : "";
  return heading + t.body.trimEnd() + "\n";
}

// Store a pasted transcript under a fresh name. Optional `title` is kept so the dump can prepend it
// as an H1 (and the brief job can tell rounds apart). Returns the new transcript's metadata.
export function saveTranscript(slug: string, body: string, title?: string): TranscriptFile {
  const name = nextTranscriptName(listTranscriptRows(slug).map((t) => t.name));
  const row = { name, title: title?.trim() || undefined, body: body.trimEnd(), at: new Date().toISOString() };
  insertTranscriptRow(slug, row);
  // Keep the folder the brief job and the prep chat read in step with the row we just stored.
  try { exportTranscriptsFor(slug); } catch { /* the dump is best-effort — the row is the record */ }
  return meta(row);
}

// Regenerate `transcripts/` from the stored rows — a DUMP, like context.md: the rows are the record
// and nothing reads these files back. Only rewrites a file whose content actually changed, so a
// re-export doesn't churn every file in a cloud-synced folder. Returns how many it wrote.
export function exportTranscriptsFor(slug: string): number {
  const rows = listTranscriptRows(slug);
  const dir = transcriptsDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const t of rows) {
    const file = path.join(dir, t.name);
    const next = renderTranscript(t);
    let current: string | null = null;
    try { current = fs.readFileSync(file, "utf8"); } catch { /* not dumped yet */ }
    if (current === next) continue;
    writeFresh(file, next);
    written++;
  }
  return written;
}
