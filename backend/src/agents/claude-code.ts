import fs from "node:fs";
import path from "node:path";
import { ASSET_ROOT } from "../config";
import { REPO_ROOT } from "../paths";

// Shared setup for launching the local `claude` CLI as a headless agent on the user's SUBSCRIPTION
// (OAuth, no metered API). Used by the one-shot drain runner and the interactive chat endpoint.

export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// Write (idempotently) the MCP config for a run: the jobhunt server (labeled "Claude Code" so its
// activity shows up as a distinct agent in the agent view) plus, when built, the local file server.
// Returns the file path.
export function mcpConfigPath(): string {
  const root = REPO_ROOT;
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const p = path.join(dataDir, "claude-code.mcp.json");

  // Cloudflare Access service token, forwarded only when present. Pointing JOBHUNT_URL at the
  // deployed app puts Access in the path, and the MCP server cannot complete an interactive login —
  // it presents this token instead. Omitted entirely for a localhost run, which has no gate.
  // Forwarded from the parent env rather than read from a file so the secret has exactly one home
  // (`fly secrets` in the cloud, .env locally) and never lands in data/claude-code.mcp.json.
  const access =
    process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
      ? {
          CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID,
          CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET,
        }
      : {};

  // The local file server, when it has been built. Two servers because they answer to different
  // places: `jobhunt` is a pure HTTP client and follows JOBHUNT_URL to the cloud, while résumés stay
  // on this machine. Omitted rather than declared-broken if dist/ is missing, so a checkout that has
  // never run the desktop build still starts a working agent — the tailoring playbook checks for the
  // tool before using it.
  const localServer = path.join(root, "desktop", "dist", "mcp-local.js");
  const local = fs.existsSync(localServer)
    ? {
        "landed-local": {
          command: process.execPath,
          args: [localServer],
          env: { LANDED_ASSET_ROOT: ASSET_ROOT },
        },
      }
    : {};

  const mcpServers: Record<string, unknown> = {
    jobhunt: {
      command: process.execPath,
      args: [path.join(root, "mcp", "jobhunt-server.mjs")],
      env: {
        JOBHUNT_THREAD_LABEL: "Claude Code",
        JOBHUNT_URL: process.env.JOBHUNT_URL || "http://localhost:3000",
        ...access,
      },
    },
    ...local,
  };

  fs.writeFileSync(p, JSON.stringify({ mcpServers }, null, 2));
  return p;
}

// Env for the spawned run: drop ANTHROPIC_API_KEY (else it overrides OAuth and bills per-token) and
// make sure ~/.local/bin (where `claude` lives) is on PATH under launchd's minimal environment.
export function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  env.PATH = `${env.HOME}/.local/bin:${env.PATH ?? ""}`;
  return env;
}

// The model every full agent run is pinned to. Passing no --model silently inherits whatever the
// installed CLI defaults to — which is how July's runs came out on Opus 4.8 and August's on Opus 5,
// roughly doubling per-job cost with no change on our side. Pin it so the model is a decision we
// make; CLAUDE_MODEL overrides it, so trialling a cheaper model on a job type is a config change
// rather than a deploy.
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";
export const claudeModel = (): string => process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;

// Flags shared by the FULL agent runs (drain runner + the general "do anything" chat): the jobhunt
// MCP server, no interactive permission prompts, and write access to the whole asset folder.
export const baseArgs = (mcp: string): string[] => [
  "--model", claudeModel(),
  "--mcp-config", mcp,
  "--strict-mcp-config",
  "--permission-mode", "bypassPermissions",
  "--add-dir", ASSET_ROOT,
];

// Flags for the per-company interview-prep chat: a LOCKED-DOWN agent, the opposite of baseArgs.
// It's a conversational prep COACH, not a doer — the allowed tools are read-only (read the folder's
// research files) plus web lookup (WebSearch/WebFetch, to look things up while prepping). No jobhunt
// MCP, no bypass, and nothing that writes or acts. The filesystem is bounded to the interview-prep
// tree: the caller sets cwd to the company's own subfolder (so its research .md files are right
// there); `--add-dir <interview-prep root>` lifts the ceiling to sibling companies + GLOBAL/ readiness
// material, but no higher.
export const prepChatArgs = (prepRoot: string): string[] => [
  "--add-dir", prepRoot,
  "--allowedTools", "Read,Glob,Grep,WebSearch,WebFetch",
];
