/**
 * Generates docs/pipeline.md — a Mermaid state diagram of the application
 * pipeline: every posting Status and the CoWork job / event that drives each
 * transition. This is the app's actual workflow, not its import structure.
 *
 * Source of truth for the STATES is the real `Status` union (lib/types.ts) —
 * imported below, so a renamed/added/removed status fails this script loudly
 * instead of silently drifting. The TRANSITIONS are declared here because the
 * triggers live in imperative code; each is annotated with where it's enforced.
 *
 * Runs in CI on every push (.github/workflows/architecture-diagram.yml) and
 * locally via `npm run diagram:pipeline`.
 */
import { STATUS_ORDER, type Status } from "@landed/shared/types";
import { STATUS_LABEL } from "@landed/shared/pipeline";
import { writeDiagramDoc } from "./diagram-doc";

const START = "[*]";

type Transition = { from: Status | typeof START; to: Status | typeof START; trigger: string };

// Each transition is annotated (in comments) with where the rule lives in code.
const TRANSITIONS: Transition[] = [
  { from: START, to: "discovered", trigger: "ingest job (scrape)" }, // registry.ts ingest def
  { from: "discovered", to: "assessed", trigger: "fit job · scored" }, // registry.ts:97
  { from: "discovered", to: "tailoring", trigger: "tailoring job" }, // registry.ts:71
  { from: "assessed", to: "tailoring", trigger: "tailoring job" }, // registry.ts:71
  { from: "discovered", to: "company_skipped", trigger: "you pass" },
  { from: "assessed", to: "company_skipped", trigger: "you pass" },
  { from: "tailoring", to: "applied", trigger: "you submit" }, // store.ts queued when tailoring
  { from: "applied", to: "interview", trigger: "inbox-sync" }, // reconcile rank 2→3
  { from: "applied", to: "ghost", trigger: "no response" }, // reconcile rank 2 (lateral)
  { from: "applied", to: "rejected", trigger: "inbox-sync" }, // reconcile rank 2→4
  { from: "interview", to: "rejected", trigger: "inbox-sync" }, // reconcile rank 3→4
];

const TERMINAL: Status[] = ["rejected", "ghost", "company_skipped", "expired"];

// --- validate the declared transitions against the real Status union ---
const known = new Set<string>(STATUS_ORDER);
const referenced = new Set<string>();
for (const t of TRANSITIONS) {
  for (const s of [t.from, t.to]) if (s !== START) referenced.add(s);
}
const unknown = [...referenced].filter((s) => !known.has(s));
if (unknown.length) {
  throw new Error(`pipeline diagram references unknown status(es): ${unknown.join(", ")}. ` + `Update scripts/gen-pipeline-diagram.ts to match lib/types.ts.`);
}
const uncovered = STATUS_ORDER.filter((s) => !referenced.has(s));
if (uncovered.length) {
  throw new Error(`status(es) have no transition in the pipeline diagram: ${uncovered.join(", ")}. ` + `Add them to scripts/gen-pipeline-diagram.ts.`);
}

// --- emit mermaid stateDiagram-v2 ---
const label = (s: Status | typeof START) => (s === START ? START : `${s} : ${STATUS_LABEL[s]}`);
const declared = new Set<string>();
const lines: string[] = ["stateDiagram-v2", "  direction LR"];
for (const t of TRANSITIONS) {
  for (const s of [t.from, t.to]) {
    if (s !== START && !declared.has(s)) {
      lines.push(`  ${label(s)}`);
      declared.add(s);
    }
  }
}
for (const t of TRANSITIONS) lines.push(`  ${t.from} --> ${t.to} : ${t.trigger}`);
for (const s of TERMINAL) lines.push(`  ${s} --> [*]`);

writeDiagramDoc({
  out: "docs/pipeline.md",
  title: "Application pipeline",
  source:
    "States come from the Status union in lib/types.ts; transitions are declared in " +
    "scripts/gen-pipeline-diagram.ts (each annotated with where the rule lives). " +
    "Run `npm run diagram:pipeline` to regenerate.",
  intro:
    "How a posting moves through the board. Each arrow is labelled with the CoWork job\n" +
    `or event that triggers it. Terminal states (${TERMINAL.join(", ")}) collapse into\n` +
    'the board\'s "Closed" column.',
  mermaid: lines.join("\n"),
});
