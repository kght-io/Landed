/**
 * Generates docs/architecture.md — a high-level Mermaid dependency diagram of
 * the app, collapsed to one box per top-level module folder. The Mermaid block
 * renders inline on GitHub and diffs as plain text, so structural drift shows
 * up in PRs.
 *
 * Source of truth is the import graph itself (via dependency-cruiser).
 * Runs in CI on every push, or locally via `npm run diagram:arch`.
 */
import { execFileSync } from "node:child_process";
import { fromRoot, writeDiagramDoc } from "./diagram-doc";

const mermaid = execFileSync(
  "npx",
  ["depcruise", "frontend", "backend", "shared", "mcp", "--config", ".dependency-cruiser.cjs", "--output-type", "mermaid"],
  { cwd: fromRoot(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);

writeDiagramDoc({
  out: "docs/architecture.md",
  title: "Architecture diagram",
  source: "Run `npm run diagram:arch` to regenerate. Source of truth: the import graph itself.",
  intro:
    'High-level module dependency graph, collapsed to one box per workspace sub-folder\n' +
    '(`frontend/*`, `backend/src/*`, `shared/src/*`). An arrow means "imports from".\n\n' +
    'This is generated from the real import graph, so it is always correct and hard to read — use it\n' +
    'to spot structural drift in a diff. For orientation, read the hand-written\n' +
    '[overview](overview.md) instead.',
  mermaid,
});
