// Call-transcript dumps under <ASSET_ROOT>/interview-prep/<slug>/transcripts/. The app can't record
// interview calls, so you paste a transcript into the drawer and this writes it to disk as a fresh,
// sequentially-numbered file — the interview-brief job then reads the whole folder. Each save is a NEW
// inode (never an in-place overwrite), which also sidesteps the cloud-sync overwrite-corruption issue.
import fs from "node:fs";
import path from "node:path";
import { PREP_ROOT } from "./export-context";

export const transcriptsDir = (slug: string) => path.join(PREP_ROOT, slug, "transcripts");

// The next collision-free filename: one past the highest existing `transcript-<n>.md` index. Pure so
// it's unit-testable; non-transcript files and gaps in the numbering are ignored.
export function nextTranscriptName(existing: string[]): string {
  let max = 0;
  for (const f of existing) {
    const m = /^transcript-(\d+)\.md$/.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `transcript-${max + 1}.md`;
}

export type TranscriptFile = { name: string; bytes: number; at: string };

function listNames(slug: string): string[] {
  try {
    return fs.readdirSync(transcriptsDir(slug)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

// Every transcript on disk for a company, newest first (by mtime).
export function listTranscripts(slug: string): TranscriptFile[] {
  const dir = transcriptsDir(slug);
  return listNames(slug)
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

// Write a pasted transcript as a fresh numbered file. Optional `title` is prepended as an H1 so the
// brief job (and you) can tell rounds apart. Returns the new file's metadata.
export function saveTranscript(slug: string, body: string, title?: string): TranscriptFile {
  const dir = transcriptsDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const name = nextTranscriptName(listNames(slug));
  const heading = title?.trim() ? `# ${title.trim()}\n\n` : "";
  fs.writeFileSync(path.join(dir, name), heading + body.trimEnd() + "\n");
  const st = fs.statSync(path.join(dir, name));
  return { name, bytes: st.size, at: st.mtime.toISOString() };
}
