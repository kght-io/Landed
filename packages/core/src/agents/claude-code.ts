import fs from "node:fs";
import path from "node:path";
import { ASSET_ROOT } from "../config";
import { REPO_ROOT } from "../paths";

// Shared setup for launching the local `claude` CLI as a headless agent on the user's SUBSCRIPTION
// (OAuth, no metered API). Used by the one-shot drain runner and the interactive chat endpoint.

export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// Write (idempotently) an MCP config pointing the run at the jobhunt server, labeled "Claude Code"
// so its activity shows up as a distinct agent in the agent view. Returns the file path.
export function mcpConfigPath(): string {
  const root = REPO_ROOT;
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const p = path.join(dataDir, "claude-code.mcp.json");

  const mcpServers: Record<string, unknown> = {
    jobhunt: {
      command: process.execPath,
      args: [path.join(root, "apps", "mcp", "jobhunt-server.mjs")],
      env: { JOBHUNT_THREAD_LABEL: "Claude Code", JOBHUNT_URL: process.env.JOBHUNT_URL || "http://localhost:3000" },
    },
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

// Flags shared by the FULL agent runs (drain runner + the general "do anything" chat): the jobhunt
// MCP server, no interactive permission prompts, and write access to the whole asset folder.
export const baseArgs = (mcp: string): string[] => [
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
