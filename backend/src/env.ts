import fs from "node:fs";

// Load a .env file into the environment — WITHOUT overriding anything already set.
//
// Why we don't just let the framework do it: `npm run dev` runs the frontend workspace script, so
// npm sets cwd to frontend/, and Next's dotenv loader is cwd-relative — it looks for frontend/.env
// and never sees the repo-root one. ASSET_ROOT then silently fell back to the empty repo-local
// asset-root folder while the real assets sat where .env actually pointed. Same failure shape as
// the cwd-relative data/jobhunt.db trap in AGENTS.md: anchor on REPO_ROOT, never on cwd.
//
// The no-override rule is load-bearing, not politeness:
//   - an explicitly exported var (a one-off run, a container, `fly secrets`) must beat the file
//   - tests/setup.ts points ASSET_ROOT and DB_PATH at throwaway temp dirs BEFORE backend modules
//     load; clobbering those would run the suite against the real database and résumé folder
//
// Deliberately a tiny parser rather than a dependency: `KEY=value`, `#` comments, blank lines, and
// optional surrounding quotes is the whole grammar this repo's .env uses. No interpolation, no
// multi-line values, no `export ` prefix — if the file ever needs those, reach for dotenv instead of
// growing this.
// `env` is a plain string map rather than NodeJS.ProcessEnv: process.env satisfies it, and callers
// (tests) can pass a bare object without having to fake NODE_ENV and friends.
export function loadEnvFile(file: string, env: Record<string, string | undefined> = process.env): void {
  let body: string;
  try {
    body = fs.readFileSync(file, "utf8");
  } catch {
    return; // a fresh clone has no .env — the callers' defaults take over
  }

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("="); // first `=` only — values carry their own (base64, DSNs)
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (env[key] !== undefined) continue; // already set — the process wins
    const raw = trimmed.slice(eq + 1).trim();
    const quoted = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")));
    env[key] = quoted ? raw.slice(1, -1) : raw;
  }
}
