import path from "node:path";
import { repoPath } from "./paths";
import { loadEnvFile } from "./env";

// Load the REPO-ROOT .env before anything below reads process.env. Next's own dotenv loader is
// cwd-relative, and `npm run dev` puts cwd at frontend/ — so without this the repo-root .env is
// never read and every setting here silently falls back to its default. Anchored on REPO_ROOT so it
// works from any cwd; never overrides a var the process already has (see ./env).
loadEnvFile(repoPath(".env"));

// The Claude the agent asset folder: the app reads/writes here, the agent works here.
// Set ASSET_ROOT in your .env to point at your own folder (see .env.example).
// Defaults to ./asset-root inside the project so a fresh clone works out of the box.
export const ASSET_ROOT = process.env.ASSET_ROOT || repoPath("asset-root");

// Instruction .md files (the agent playbooks) — tracked repo SOURCE, not user data.
// They ship in the repo at <repo>/instructions so a fresh clone has them out of the box; the
// in-app editor writes back to that tracked folder. Override the location with INSTRUCTIONS_ROOT.
export const INSTRUCTIONS_ROOT = process.env.INSTRUCTIONS_ROOT || repoPath("instructions");

// NOTE: the agent job queue (agent-jobs/{queue,results,done}) and the app-export/* context
// files were retired — the job queue + ledger now live in the `jobs` DB table, and the agent
// reads context + submits results over the jobhunt MCP tools. See backend/src/jobs/store.ts.

// Resolve a client-supplied relative path safely inside INSTRUCTIONS_ROOT.
// Returns null if it escapes the root or isn't a .md file.
export function resolveInstruction(relPath: string): string | null {
  const full = path.resolve(INSTRUCTIONS_ROOT, relPath);
  const root = path.resolve(INSTRUCTIONS_ROOT);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!full.endsWith(".md")) return null;
  return full;
}

// Layout — see instructions/README.md in the asset root (the single source of truth).
export const PATHS = {
  tracker: () => path.join(ASSET_ROOT, "job_applications_tracker.csv"),
  resumeDir: () => path.join(ASSET_ROOT, "resume"),
  baseResume: (ext: "docx" | "pdf" = "docx") =>
    path.join(ASSET_ROOT, "resume", `resume-ref.${ext}`),
  tailorQueue: () => path.join(ASSET_ROOT, "tailor-queue"),
  // one .md file per queued job (the app writes this; the agent deletes it when done)
  queueItem: (slug: string) => path.join(ASSET_ROOT, "tailor-queue", `${slug}.md`),
  // permanent tailored-resume folder after Applied
  tailoredResume: (slug: string) => path.join(ASSET_ROOT, "resume", slug),
};

// The on-disk anchors the agent needs to run a job, handed over via getContext.
//
// Without these the agent has to DISCOVER where the asset root is — a measured tailoring run spent
// two requests grepping this very file plus .env for ASSET_ROOT, then hard-prefixed it onto every
// later command. The playbooks used to write `$ASSET_ROOT/...`, which only works if that variable
// happens to be exported into the agent's shell; it is not (claudeEnv forwards the server's env,
// and the launchd server is spawned without it). Hand over resolved absolute paths instead of a
// variable the agent has to hope is set.
export const agentPaths = () => ({
  assetRoot: ASSET_ROOT,
  baseResume: PATHS.baseResume("docx"),
  resumeDir: PATHS.resumeDir(),
});

// Resolve a tailored-resume folder safely inside the resume dir. Null if the slug escapes it.
export function resolveResume(slug: string): string | null {
  const root = path.resolve(PATHS.resumeDir());
  const full = path.resolve(root, slug);
  if (full === root || !full.startsWith(root + path.sep)) return null; // no traversal, no root itself
  return full;
}

// Folder naming convention: <company>-<title>-<team>-<jobId>
//   title = level (Staff, Senior, ...)   team = Infra, Ads, Platform, ...
// The queue folder and the tailored-resume folder share this slug.
export function slugFor(parts: {
  company: string;
  title?: string;
  team?: string;
  jobId: string;
}): string {
  const s = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [parts.company, parts.title, parts.team, parts.jobId]
    .filter(Boolean)
    .map((x) => s(x as string))
    .join("-");
}
