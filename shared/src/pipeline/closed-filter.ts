// The Closed step's filter: two independent axes that COMBINE — which outcome (rejected, no
// response, skipped…) and whether you actually interviewed. "Rejected + Interviewed" is the whole
// point; it's the question "who turned me down after a real loop?", which the status pills alone
// can't answer.
//
// Pure so the combination and the self-healing are testable without React. The UI (Pipeline.tsx)
// owns only the pills.

import type { Posting, Status } from "../types";

export type ClosedFilter = { status: Status | "all"; interviewed: boolean };

export const NO_CLOSED_FILTER: ClosedFilter = { status: "all", interviewed: false };

// Narrow a selection so it can never point at an empty table — the filter row would otherwise sit
// above nothing with no hint of which pill to un-click. Status heals first (it's the primary axis),
// then interviewed heals within whatever status survived.
export function resolveClosedFilter(base: Posting[], want: ClosedFilter): ClosedFilter {
  const status = want.status !== "all" && !base.some((p) => p.status === want.status) ? "all" : want.status;
  const inStatus = status === "all" ? base : base.filter((p) => p.status === status);
  const interviewed = want.interviewed && inStatus.some((p) => p.interviewed);
  return { status, interviewed };
}

export function applyClosedFilter(base: Posting[], f: ClosedFilter): Posting[] {
  return base.filter((p) => (f.status === "all" || p.status === f.status) && (!f.interviewed || !!p.interviewed));
}

// Faceted counts: every pill answers "what would I get if I clicked this?", holding the OTHER axis
// where it is. Computed from the unfiltered `base` — count them off the filtered list instead and
// every pill but the active one reads 0.
export type ClosedCounts = { all: number; byStatus: Partial<Record<Status, number>>; interviewed: number };

export function closedFilterCounts(base: Posting[], f: ClosedFilter): ClosedCounts {
  const byStatus: Partial<Record<Status, number>> = {};
  for (const p of base) {
    if (f.interviewed && !p.interviewed) continue; // a status pill counts under the live interviewed toggle
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  }
  const inStatus = f.status === "all" ? base : base.filter((p) => p.status === f.status);
  return { all: base.length, byStatus, interviewed: inStatus.filter((p) => !!p.interviewed).length };
}
