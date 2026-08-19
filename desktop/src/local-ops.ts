import { shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getAssetRoot } from "./config";

// THE NODE HALF OF THE BRIDGE — the handful of things that must run where the files are.
//
// Deliberately small. A capability belongs here only if it needs no database: the app's data lives
// in SQLite (soon in the cloud), and a handler that needed a row would either have to open a DB
// this process should not own or make an HTTP call the browser could have made itself. So
// "reveal the folder for posting X" is NOT here — a posting id resolves to a slug through the DB —
// while "reveal the folder for slug X" is.

/**
 * Resolve a path INSIDE the chosen folder, or null.
 *
 * The picker promised one folder. That promise is worth exactly as much as this function: a slug
 * arriving from the renderer is untrusted input, and "../.." is a perfectly ordinary string. Paths
 * are resolved to their real location before the containment check so a symlink planted inside the
 * folder cannot point out of it.
 */
export function within(...segments: string[]): string | null {
  const root = getAssetRoot();
  const target = path.resolve(root, ...segments);
  const realRoot = fs.realpathSync.native(root);
  // The target may not exist yet; walk up to the nearest existing ancestor to resolve symlinks.
  let probe = target;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const realProbe = fs.realpathSync.native(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) return null;
  return target;
}

/** Open the chosen folder in Finder/Explorer. */
export function revealAssetFolder(): void {
  shell.openPath(getAssetRoot());
}

/**
 * Reveal a tailored résumé's folder. Mirrors backend resolveResume(): résumés live under
 * <root>/resume/<slug>/, and a slug that escapes that is refused rather than clamped.
 */
export function revealResumeFolder(slug: string): void {
  const dir = within("resume", slug);
  if (!dir || !fs.existsSync(dir)) return; // best-effort, exactly like the route it replaces
  shell.openPath(dir);
}

/**
 * Reveal a company's interview-prep folder, by slug. Mirrors backend PREP_ROOT, which is
 * <root>/interview-prep/<slug>/.
 */
export function revealPrepFolder(slug: string): void {
  const dir = within("interview-prep", slug);
  if (!dir || !fs.existsSync(dir)) return;
  shell.openPath(dir);
}
