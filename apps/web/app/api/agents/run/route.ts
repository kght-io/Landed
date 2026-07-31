import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { jobDef } from "@landed/core/jobs/registry";
import { CLAUDE_BIN, mcpConfigPath, claudeEnv, baseArgs } from "@landed/core/agents/claude-code";
import { drainPrompt } from "@landed/shared/agents/personas";
import { REPO_ROOT } from "@landed/core/paths";

export const dynamic = "force-dynamic";

// POST /api/agents/run  body: { type } — launch a headless Claude Code run that DRAINS the given
// job type's queue, then exits. The lean alternative to a parked the agent chat: it runs on your Pro
// subscription (OAuth, no API fees) only when there's work, so it doesn't burn idle quota.
//
// It talks to the SAME jobhunt MCP server (so it claims/works/submits exactly like the agent) and is
// tagged JOBHUNT_THREAD_LABEL="Claude Code", so it shows up in the agents view as its own chat.
//
// Prereqs: `claude` CLI authenticated against your subscription (`claude setup-token`), and ANThropic
// API key NOT set (or it bills per-token). For a live, streamed version of this, see /api/agents/live.

export async function POST(request: Request) {
  let type: string | undefined;
  try {
    type = (await request.json())?.type;
  } catch {
    // ignore
  }
  if (!type || !jobDef(type)) return Response.json({ error: `unknown or missing type: ${type}` }, { status: 400 });

  const root = REPO_ROOT; // the agent works from the repo root, not the web workspace
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(dataDir, `claude-agent-${type}-${stamp}.log`);
  const logFd = fs.openSync(logPath, "a");

  const args = ["-p", drainPrompt(type), ...baseArgs(mcpConfigPath())];

  try {
    const child = spawn(CLAUDE_BIN, args, { cwd: root, env: claudeEnv(), detached: true, stdio: ["ignore", logFd, logFd] });
    child.on("error", () => { /* surfaced in the log; route already returned */ });
    child.unref();
    return Response.json({ ok: true, type, pid: child.pid, log: path.relative(root, logPath) });
  } catch (e) {
    return Response.json({ error: `failed to launch claude: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
