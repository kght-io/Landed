// ── "a posting changed stage" ──
// Two places move a posting between stages: updateApplication (you, via the UI) and reconcile (the
// agent, via inbox-sync). Both used to reach UP into the jobs layer to enqueue prep research as a
// side effect — a DB write calling the queue. That was the load-bearing edge of the
// db ↔ jobs ↔ agents import cycle: `jobs` needs `db` to do anything, so `db` needing `jobs` back
// meant no module in that triangle could be read, tested, or moved on its own.
//
// So the direction is inverted. `db` announces what changed and knows nothing about who cares;
// `jobs` subscribes (see ../jobs/subscribe.ts). Adding a second reaction — the chat assistant
// noticing a stage change, say — is a new subscriber rather than a new import edge.
//
// ⚠️ The wiring is an import side effect: a subscriber only exists once its module has been
// evaluated. ../jobs/store.ts imports ./subscribe for exactly this reason, so anything that touches
// the jobs barrel registers it. If you add a subscriber elsewhere, make sure something loads it.

export type StageChange = {
  companyId: number;
  from: string; // the stored stage before the write
  to: string; // …and after
};

// Keyed by subscriber name so a module re-evaluated by the dev server's hot reload replaces its
// listener instead of stacking a second copy.
const listeners = new Map<string, (e: StageChange) => void>();

export function onStageChange(name: string, fn: (e: StageChange) => void): void {
  listeners.set(name, fn);
}

export function emitStageChange(e: StageChange): void {
  if (e.from === e.to) return; // not a transition
  for (const fn of listeners.values()) fn(e);
}
