import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// WHAT HAS TO BE TRUE BEFORE THIS APP CAN DO ANYTHING.
//
// Four things, and on the machine this was built on all four are already true — which is exactly
// why they need checking. `claude` installed and logged in, a folder chosen, a backend answering.
// On anyone else's machine at least one will be missing, and until now that surfaced as an error
// note inside a transcript they had no reason to open.
//
// The checks shell out; the JUDGEMENT below is pure, so what blocks, what merely degrades, and what
// someone is told can be tested without uninstalling anything.

const run = promisify(execFile);

export type Check = { ok: boolean; detail?: string };
export type Checks = { claude: Check; login: Check; backend: Check; soffice: Check; folder: Check };

export type Problem = { id: keyof Checks; title: string; fix: string; detail?: string };
export type Summary = { ready: boolean; blocking: Problem[]; warnings: Problem[] };

// Fix-order, not check-order: someone with nothing set up should be told to install the CLI before
// being told to log into it, and to pick a folder before either — that one gates the rest.
const ORDER: (keyof Checks)[] = ["folder", "claude", "login", "backend", "soffice"];

const PROBLEM: Record<keyof Checks, Omit<Problem, "id" | "detail">> = {
  folder: {
    title: "No folder chosen",
    fix: "Pick the folder where your résumés and interview prep should live. It is the only folder this app touches.",
  },
  claude: {
    title: "Claude Code isn’t installed",
    fix: "Install it with `curl -fsSL https://claude.ai/install.sh | bash`, then re-check. This app runs it to do the work.",
  },
  login: {
    title: "Claude Code isn’t logged in",
    fix: "Run `claude` once in a terminal and sign in. Work runs on your own Claude subscription — this app never uses an API key.",
  },
  backend: {
    title: "Can’t reach Landed",
    fix: "The app reads your pipeline and job queue from the server. Check it is running, then re-check.",
  },
  soffice: {
    title: "LibreOffice isn’t installed",
    fix: "Optional. Without it, tailored résumés are still written as .docx — only the PDF is skipped. Install LibreOffice to get both.",
  },
};

/**
 * Turn raw check results into what to show.
 *
 * The one judgement worth arguing about is that LibreOffice WARNS rather than blocks. It is needed
 * only to render a PDF for tailoring; blocking on it would stop fit, inbox-sync and prep — none of
 * which touch a PDF — over a dependency they never use.
 */
export function summarize(checks: Checks): Summary {
  const problems = ORDER.filter((id) => !checks[id].ok).map(
    (id): Problem => ({ id, ...PROBLEM[id], detail: checks[id].detail }),
  );
  const warnings = problems.filter((p) => p.id === "soffice");
  const blocking = problems.filter((p) => p.id !== "soffice");
  return { ready: blocking.length === 0, blocking, warnings };
}

/** Is a binary runnable, and what does it say its version is? */
async function version(bin: string, args: string[]): Promise<Check> {
  try {
    const { stdout } = await run(bin, args, { timeout: 10_000 });
    return { ok: true, detail: stdout.trim().split("\n")[0] };
  } catch {
    return { ok: false };
  }
}

/**
 * Run every check.
 *
 * PATH is widened the same way a spawned agent's is: a GUI app inherits launchd's minimal
 * environment, not a login shell's, so `claude` in ~/.local/bin is invisible to it. Checking with a
 * narrower PATH than the thing being checked would report a missing binary that is right there.
 */
export async function preflight(opts: {
  assetRoot: string | null;
  appOrigin: string;
  claudeBin: string;
  fetchImpl?: typeof fetch;
}): Promise<Checks> {
  const env = { ...process.env, PATH: `${process.env.HOME}/.local/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}` };
  process.env.PATH = env.PATH;

  const claude = await version(opts.claudeBin, ["--version"]);

  // Logged-in state, without starting a session: the CLI reports its auth status, and a token that
  // has expired is a different problem from a binary that is absent.
  let login: Check = { ok: false };
  if (claude.ok) {
    try {
      const { stdout } = await run(opts.claudeBin, ["auth", "status"], { timeout: 15_000 });
      // No detail: the output is JSON on current CLIs, and its first line is a bare "{" — which is
      // worse than nothing in a UI that renders detail as a chip beside the title.
      login = { ok: !/not logged in|logged out|no credentials/i.test(stdout) };
    } catch {
      // Older CLIs have no `auth status`. Absence of the subcommand is not evidence of being logged
      // out, so treat it as fine rather than sending someone to fix something that is not broken.
      login = { ok: true };
    }
  }

  const doFetch = opts.fetchImpl ?? fetch;
  let backend: Check = { ok: false, detail: opts.appOrigin };
  try {
    const res = await doFetch(`${opts.appOrigin}/api/health`);
    backend = { ok: res.ok, detail: opts.appOrigin };
  } catch {
    /* unreachable — reported as-is */
  }

  return {
    claude,
    login,
    backend,
    soffice: await version("soffice", ["--version"]),
    folder: {
      ok: !!opts.assetRoot && fs.existsSync(opts.assetRoot),
      detail: opts.assetRoot ? path.basename(opts.assetRoot) : undefined,
    },
  };
}
