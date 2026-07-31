import fs from "node:fs";
import path from "node:path";

// THE ANCHOR FOR EVERYTHING ON DISK — the monorepo root, i.e. the directory that owns
// `data/` (the SQLite file), `instructions/` (the CoWork brief), and the workspace package.json.
//
// Why this exists: before the workspace split every path was `process.cwd()`-relative and cwd was
// always the repo root. It no longer is — npm runs a workspace script with cwd set to the PACKAGE,
// so `next dev` reports cwd = apps/web. Resolving `data/jobhunt.db` from cwd would silently open a
// SECOND, empty database at apps/web/data/. Anchor on the root instead of the caller's cwd.
//
// Resolution walks up from cwd looking for the workspace root marker (a package.json declaring
// "workspaces"), so it lands on the same directory from `next dev`, `node --test`, and a script —
// and keeps working wherever the repo is cloned. REPO_ROOT overrides it for exotic setups.
function findRepoRoot(): string {
  const start = process.env.REPO_ROOT ? path.resolve(process.env.REPO_ROOT) : process.cwd();
  let dir = start;
  for (;;) {
    const manifest = path.join(dir, "package.json");
    try {
      if (fs.existsSync(manifest)) {
        const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as { workspaces?: unknown };
        if (pkg.workspaces) return dir;
      }
    } catch {
      // an unreadable/!JSON package.json just isn't the marker — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start; // hit the filesystem root — fall back to where we started
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot();

// Repo-root-relative join. Use this instead of path.join(process.cwd(), ...).
export function repoPath(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}
