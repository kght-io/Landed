// Mock-interview practice sessions under <ASSET_ROOT>/interview-prep/GLOBAL/mock-interviews/. Unlike
// per-company transcripts, these are CROSS-COMPANY practice — a separate mock-interview chat pushes a
// session here via the `logMockInterview` MCP tool, and the readiness chat (instructions/readiness.md)
// reconciles their gaps into the GLOBAL gap ledger. Each save is a NEW inode (never an in-place
// overwrite), mirroring lib/prep/transcripts.ts — cheap append-only capture, cloud-sync-corruption-safe.
import fs from "node:fs";
import path from "node:path";
import { PREP_ROOT } from "./export-context";

export const mockDir = () => path.join(PREP_ROOT, "GLOBAL", "mock-interviews");

// One weakness the session surfaced. `area` is a short tag (e.g. "system-design", "behavioral"),
// `detail` the specific miss; `severity` optional (low | medium | high).
export type MockGap = { area: string; detail: string; severity?: string };

// The next collision-free filename: one past the highest existing `session-<n>.md` index. Pure so it's
// unit-testable; non-session files and gaps in the numbering are ignored.
export function nextSessionName(existing: string[]): string {
  let max = 0;
  for (const f of existing) {
    const m = /^session-(\d+)\.md$/.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `session-${max + 1}.md`;
}

export type MockSessionFile = { name: string; bytes: number; at: string };

function listNames(): string[] {
  try {
    return fs.readdirSync(mockDir()).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

// Every mock-interview session on disk, newest first (by mtime).
export function listMockSessions(): MockSessionFile[] {
  const dir = mockDir();
  return listNames()
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

// Render the optional gaps as a markdown "## Gaps surfaced" bullet list. Empty → "" (no section).
function gapsBlock(gaps?: MockGap[]): string {
  if (!gaps?.length) return "";
  const lines = gaps.map((g) => {
    const sev = g.severity?.trim() ? ` (${g.severity.trim()})` : "";
    return `- **${g.area}**${sev}: ${g.detail}`;
  });
  return `\n\n## Gaps surfaced\n\n${lines.join("\n")}`;
}

// Write one mock-interview session as a fresh numbered file. `title` (optional) becomes an H1 so the
// readiness chat can tell sessions apart; `gaps` (optional) are rendered as a bullet list. Returns the
// new file's metadata.
export function saveMockSession(input: { notes: string; gaps?: MockGap[]; title?: string }): MockSessionFile {
  const dir = mockDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = nextSessionName(listNames());
  const heading = input.title?.trim() ? `# ${input.title.trim()}\n\n` : "";
  const content = heading + input.notes.trimEnd() + gapsBlock(input.gaps) + "\n";
  fs.writeFileSync(path.join(dir, name), content);
  const st = fs.statSync(path.join(dir, name));
  return { name, bytes: st.size, at: st.mtime.toISOString() };
}
