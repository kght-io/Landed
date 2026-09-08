// Side-effect module: MUST be imported before any "@landed/backend/*" module so the app's
// DB connection and asset paths point at a throwaway temp location, never the real
// data/jobhunt.db. ESM evaluates this fully before later imports in the test file.
//
// The schema is built by the app's own bootstrap (packages/core/src/db/index.ts) the first time @landed/backend/db is
// imported — there is no separate test schema to maintain. Just point the env at a temp dir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
process.env.ASSET_ROOT = dir;
process.env.JOBS_ROOT = path.join(dir, "agent-jobs");
process.env.DB_PATH = path.join(dir, "test.db");
// REPO_ROOT too, and this one is not optional. Anything resolved through paths.ts `repoPath()` —
// notably `data/agent-runs/`, the agent run journals — otherwise points at the REAL repo, and a test
// that writes or clears those directories destroys live data. That is not hypothetical: a test doing
// exactly this wiped every journal in data/agent-runs/. The temp dir needs the workspace marker
// findRepoRoot() looks for, or resolution walks straight back up to the real root.
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "landed-test-root", workspaces: [] }));
process.env.REPO_ROOT = dir;

export const TEST_DIR = dir;
