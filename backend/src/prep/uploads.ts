// Files a person attaches to a company's prep chat.
//
// They land in <PREP_ROOT>/<slug>/uploads/ and the chat then names their paths in the turn, so the
// agent opens them with the Read tool it already has. That is the whole mechanism — no new agent
// capability, no upload channel to the model: the prep chat already runs with cwd = the company's
// folder and `--add-dir PREP_ROOT` (see backend/src/agents/claude-code.ts prepChatArgs), so a file
// sitting in that folder is readable the moment it exists, and nothing outside it ever is.
//
// Which makes the FILENAME the security boundary. The agent is read-only but it is still pointed at
// a path we construct, so every name is reduced to a bare, sanitized basename before it touches the
// filesystem — see safeUploadName.
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_ACCEPT } from "@landed/shared/prep/attachments";
import { resolvePrepDir } from "./export-context";

// Big enough for a screenshot, a scanned take-home, or a JD PDF; small enough that a stray drag-drop
// can't bloat a cloud-synced asset folder. Attachments are read by an agent, not archived.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// The one allowlist, shared with the file picker that offers it — see shared/src/prep/attachments.ts.
const ALLOWED_EXT = new Set<string>(UPLOAD_ACCEPT);

export const uploadsDir = (slug: string): string | null => {
  const dir = resolvePrepDir(slug);
  return dir ? path.join(dir, "uploads") : null;
};

// Reduce any client-supplied name to a bare, safe basename.
//
// `path.basename` alone is not enough: it is platform-dependent, so a Windows-style "..\\..\\x.png"
// survives it whole on posix. So we split on BOTH separators and take the last segment, then keep
// only characters that can't mean anything to a shell or a path.
export function safeUploadName(raw: string): string {
  const last = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = last
    .replace(/[^A-Za-z0-9._-]+/g, "-") // anything else becomes a dash
    .replace(/^[.-]+/, "") // no leading dots (hidden files, "..") or dashes (flag-lookalikes)
    .replace(/-{2,}/g, "-")
    .slice(0, 100);
  return cleaned || "attachment";
}

const extOf = (name: string) => path.extname(name).toLowerCase();

// Save one attachment. Returns the stored name and the path to hand the agent — RELATIVE to the
// company folder, because that folder is the chat's cwd.
export async function savePrepUpload(
  slug: string,
  filename: string,
  data: Buffer
): Promise<{ name: string; relPath: string; bytes: number }> {
  const dir = uploadsDir(slug);
  if (!dir) throw new Error("unknown or unsafe company folder");
  if (data.byteLength > MAX_UPLOAD_BYTES)
    throw new Error(`file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);

  const safe = safeUploadName(filename);
  const ext = extOf(safe);
  if (!ALLOWED_EXT.has(ext))
    throw new Error(`can't attach ${ext || "a file with no extension"} — images, PDFs and text only`);

  await fs.promises.mkdir(dir, { recursive: true });

  // Never clobber: two screenshots both called "Screenshot.png" are two different attachments, and
  // overwriting the first loses a file the user believes they sent. Suffix until the name is free.
  const stem = safe.slice(0, safe.length - ext.length);
  let name = safe;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${stem}-${n}${ext}`;

  // Temp file + rename, so the result is a FRESH inode rather than an in-place write. PREP_ROOT sits
  // under ASSET_ROOT, which is typically cloud-synced, and writing a file the sync daemon is holding
  // open corrupts it; a rename swaps the directory entry atomically instead. (Same reason as
  // ./root.ts writeFresh, which is string-only — this one carries bytes.)
  const dest = path.join(dir, name);
  const tmp = `${dest}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, dest);

  return { name, relPath: `uploads/${name}`, bytes: data.byteLength };
}

export type PrepUpload = { name: string; relPath: string; bytes: number; mtime: string };

// The company's attachments, newest first. Kept separate from listPrepFiles (the research .md dumps)
// so the chat can show "what the coach wrote" and "what you handed it" as different things.
export async function listPrepUploads(slug: string): Promise<PrepUpload[]> {
  const dir = uploadsDir(slug);
  if (!dir || !fs.existsSync(dir)) return [];
  const out: PrepUpload[] = [];
  for (const name of await fs.promises.readdir(dir)) {
    if (name.startsWith(".") || name.includes(".tmp-")) continue; // in-flight writes aren't attachments
    const s = await fs.promises.stat(path.join(dir, name)).catch(() => null);
    if (!s?.isFile()) continue;
    out.push({ name, relPath: `uploads/${name}`, bytes: s.size, mtime: s.mtime.toISOString() });
  }
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}
