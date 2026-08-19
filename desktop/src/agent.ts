import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { drainPrompt } from "@landed/shared/agents/personas";
import { translate, type Frame, type TranslateState } from "@landed/shared/agents/stream";
import { getAssetRoot } from "./config";

// SPAWNING THE AGENT.
//
// Mirrors backend/src/agents/claude-code.ts, with two deliberate differences that only make sense
// once the app is the thing running it.
//
// The working directory is the USER'S FOLDER, not a repo. The backend runs the agent from
// REPO_ROOT because that is where the tailoring script lived; now that résumé building is an MCP
// tool (landed-local), nothing outside the folder is needed, and the folder the user picked can be
// the actual boundary rather than a claim on the settings page.
//
// The MCP config is written to app userData, not data/. There is no repo to write into, and the
// config carries a Cloudflare Access token when one is configured — it belongs with the app's own
// state, not next to the user's résumés.

export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// Passing no --model silently inherits whatever the installed CLI defaults to, which has quietly
// doubled per-job cost before. Pinned so the model is a decision; CLAUDE_MODEL overrides it.
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";
export const claudeModel = (): string => process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;

/** Where the two MCP servers live — bundled beside the app in production, in the repo in dev. */
function serverPath(...rel: string[]): string | null {
  const packaged = path.join(process.resourcesPath ?? "", ...rel);
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(app.getAppPath(), "..", ...rel);
  return fs.existsSync(dev) ? dev : null;
}

/** Write the MCP config for a run and return its path. */
export function writeMcpConfig(appOrigin: string): string {
  const file = path.join(app.getPath("userData"), "claude-code.mcp.json");

  // Forwarded from the parent env rather than stored, so the secret has one home and never lands
  // in this file. Absent for a localhost origin, which has no Access gate in front of it.
  const access =
    process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
      ? {
          CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID,
          CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET,
        }
      : {};

  const jobhunt = serverPath("mcp", "jobhunt-server.mjs");
  const local = path.join(__dirname, "mcp-local.js");

  const mcpServers: Record<string, unknown> = {};
  if (jobhunt) {
    mcpServers.jobhunt = {
      command: process.execPath,
      args: [jobhunt],
      env: { JOBHUNT_THREAD_LABEL: "Landed Desktop", JOBHUNT_URL: appOrigin, ...access },
    };
  }
  mcpServers["landed-local"] = {
    command: process.execPath,
    args: [local],
    env: { LANDED_ASSET_ROOT: getAssetRoot() },
  };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2));
  return file;
}

/**
 * Run one drain for `type`, resolving when the agent exits.
 *
 * Rejects on a non-zero exit so the supervisor can back off and report — a silent failure here is
 * the failure mode that makes the app look alive while draining nothing.
 */
export function runDrain(type: string, appOrigin: string, onFrame?: (frame: Frame) => void): Promise<void> {
  const mcp = writeMcpConfig(appOrigin);
  const root = getAssetRoot();

  return new Promise((resolve, reject) => {
    const child = spawn(
      CLAUDE_BIN,
      [
        "-p",
        drainPrompt(type),
        // The structured stream is what makes a transcript possible instead of a wall of text: the
        // same frames the web agents page renders. --verbose is required by the CLI for stream-json
        // in print mode; without it the process emits nothing until it exits.
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        claudeModel(),
        "--mcp-config",
        mcp,
        "--strict-mcp-config",
        // Scoped to the folder the user chose, instead of bypassPermissions. Tailoring no longer
        // needs a shell — it is an MCP tool now — so the agent's reach can finally match the promise
        // the folder picker makes.
        "--add-dir",
        root,
        "--allowedTools",
        "Read,Glob,Grep,WebSearch,WebFetch,mcp__jobhunt,mcp__landed-local",
      ],
      {
        cwd: root,
        env: (() => {
          const env = { ...process.env };
          // An API key here would silently override the user's OAuth session and bill per token.
          // The whole BYO-subscription model depends on this one line.
          delete env.ANTHROPIC_API_KEY;
          env.PATH = `${env.HOME}/.local/bin:${env.PATH ?? ""}`;
          return env;
        })(),
      },
    );

    // stream-json is newline-delimited, and a chunk boundary lands mid-line often enough that
    // parsing per chunk drops frames. Hold the trailing partial until its newline arrives.
    const state: TranslateState = {};
    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) for (const frame of translate(line, state)) onFrame?.(frame);
      }
    });

    // stderr is not protocol — it is the CLI complaining. Surfaced as a note so a missing binary or
    // an expired login shows up in the transcript instead of only in a terminal.
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d: string) => {
      const text = d.trimEnd();
      if (text) onFrame?.({ kind: "note", text, error: true });
    });

    child.on("error", reject); // e.g. `claude` is not installed
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`agent exited ${code} draining ${type}`)),
    );
  });
}
