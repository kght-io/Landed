import fs from "node:fs";
import path from "node:path";

// READING THE ONE FOLDER THE USER PICKED.
//
// The picker promised "this folder and nothing else". That promise is worth exactly as much as the
// containment check below, because the paths arrive from a renderer and a renderer is not a
// trusted caller. Everything here is relative-to-root by construction: no absolute path from the
// UI is ever honoured, and the resolved target is compared against the REAL root so a symlink
// planted inside cannot point out.
//
// Takes the root as an argument rather than reading config, so the rule is testable without an
// Electron app around it.

export type Entry = { name: string; dir: boolean; bytes: number | null };

/** Resolve `rel` inside `root`, or null if it escapes. Exported for the file-open path. */
export function resolveWithin(root: string, rel: string): string | null {
  const realRoot = fs.realpathSync.native(root);
  // path.resolve on an absolute `rel` would DISCARD the root, so join first and normalise after —
  // "/etc" must be read as a child named etc, not as the filesystem root.
  const target = path.resolve(realRoot, path.join(".", rel));
  let probe = target;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  let realProbe: string;
  try {
    realProbe = fs.realpathSync.native(probe);
  } catch {
    return null;
  }
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) return null;
  return target;
}

/**
 * One directory's contents: folders first, then files, each alphabetical.
 *
 * Returns [] for anything that is not a readable directory inside the root — an escape attempt, a
 * missing path, a file. A browser pane that renders "empty" is a fine answer to a bad question; an
 * exception crossing IPC is not.
 */
export function listDir(root: string, rel: string): Entry[] {
  const dir = resolveWithin(root, rel);
  if (!dir) return [];
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // missing, or not a directory
  }
  return names
    .filter((d) => !d.name.startsWith(".")) // .DS_Store and friends are noise, not content
    .map((d): Entry => {
      const isDir = d.isDirectory();
      let bytes: number | null = null;
      if (!isDir) {
        try {
          bytes = fs.statSync(path.join(dir, d.name)).size;
        } catch {
          bytes = null; // vanished between readdir and stat; show it without a size
        }
      }
      return { name: d.name, dir: isDir, bytes };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}
