// Pure domain logic for the board views — grouping, aggregation, reapply rollups.
// No React here, so it's easy to test and reuse.
import type { Posting, Status, Tier } from "./types";
import { reapplyInfo } from "./pipeline";

// TODO: make this the real date once the app isn't seeded with fixed-date data.
export const TODAY = "2026-06-19";

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const dateOf = (p: Posting) => p.appliedDate || p.updatedAt || p.discoveredAt || "";

// A company rollup for the Companies view.
export type CompanyAgg = {
  company: string;
  tier: Tier;
  items: Posting[];
  lastDate?: string;
  newCount: number;
  statusCounts: Partial<Record<Status, number>>;
  skipped: boolean; // derived: you've passed on the whole company (every posting company_skipped)
  watchlist: boolean; // company is on the discovery scan list (denormalized from the company)
};

// A company reads as skipped when it has postings and all of them are company_skipped —
// i.e. the "pass on the company" decision propagated to every open posting. Purely derived,
// so it self-corrects the moment any posting moves back into the pipeline.
export function isCompanySkipped(items: Posting[]): boolean {
  return items.length > 0 && items.every((p) => p.status === "company_skipped");
}

// A company group within a single pipeline column.
export type ColumnGroup = { company: string; tier: Tier; items: Posting[] };

// Group a column's postings by company, most jobs first.
export function groupByCompany(items: Posting[]): ColumnGroup[] {
  const m = new Map<string, ColumnGroup>();
  for (const p of items) {
    let g = m.get(p.company);
    if (!g) { g = { company: p.company, tier: p.tier, items: [] }; m.set(p.company, g); }
    g.items.push(p);
  }
  return [...m.values()].sort((a, b) => b.items.length - a.items.length);
}

// Roll all postings up into company aggregates, most-recently-active first.
export function aggregateCompanies(postings: Posting[]): CompanyAgg[] {
  const m = new Map<string, CompanyAgg>();
  for (const p of postings) {
    let g = m.get(p.company);
    if (!g) {
      g = { company: p.company, tier: p.tier, items: [], newCount: 0, statusCounts: {}, skipped: false, watchlist: !!p.watchlist };
      m.set(p.company, g);
    }
    g.items.push(p);
    g.statusCounts[p.status] = (g.statusCounts[p.status] ?? 0) + 1;
    const d = dateOf(p);
    if (d && (!g.lastDate || d > g.lastDate)) g.lastDate = d;
    if (p.discoveredAt === TODAY && !p.history) g.newCount++;
  }
  for (const g of m.values()) g.skipped = isCompanySkipped(g.items);
  return [...m.values()].sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
}

// Reapply eligibility rolled up to a group: eligible if any closed job is eligible
// now, otherwise cooldown until the soonest date a job frees up.
export type GroupReapply = { state: "eligible" | "cooldown" | "none"; until?: string };

export function groupReapply(items: Posting[]): GroupReapply {
  const infos = items.map((i) => reapplyInfo(i)).filter((i) => i.state !== "n/a");
  if (!infos.length) return { state: "none" };
  if (infos.some((i) => i.state === "eligible")) return { state: "eligible" };
  const untils = infos
    .map((i) => (i.state === "cooldown" ? i.until : undefined))
    .filter((u): u is string => !!u)
    .sort();
  return { state: "cooldown", until: untils[0] };
}

// Companies under an active reapply cooldown → the soonest date they free up.
// A cooldown is a company-wide signal, so every posting at the company inherits it
// (e.g. a freshly-discovered role at a company that already rejected you).
export function companyCooldowns(postings: Posting[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groupByCompany(postings)) {
    const r = groupReapply(g.items);
    if (r.state === "cooldown" && r.until) out[g.company] = r.until;
  }
  return out;
}
