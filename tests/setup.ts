// Side-effect module: MUST be imported before any "@landed/core/*" module so the app's
// DB connection and asset paths point at a throwaway temp location, never the real
// data/jobhunt.db. ESM evaluates this fully before later imports in the test file.
//
// The schema is built by the app's own bootstrap (packages/core/src/db/index.ts) the first time @landed/core/db is
// imported — there is no separate test schema to maintain. Just point the env at a temp dir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
process.env.ASSET_ROOT = dir;
process.env.JOBS_ROOT = path.join(dir, "agent-jobs");
process.env.DB_PATH = path.join(dir, "test.db");

export const TEST_DIR = dir;
