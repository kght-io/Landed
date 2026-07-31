import { eq } from "drizzle-orm";
import { db } from "./index";
import { postings, companies, prepAttempts, prepQuestions, prepCompany, jobs, events } from "./schema";

// Dashboard aggregation — everything the /dashboard page shows, computed from existing tables in one
// pass. `state` is a single point-in-time value, so funnel counts are CUMULATIVE ("reached at least
// this stage"): the `interviewed` flag + downstream states stand in for history.

const APPLIED_STATES = new Set(["applied", "interview", "offer", "accepted", "rejected", "ghost", "withdrawn"]);
const ACTIVE_STATES = new Set(["applied", "interview", "offer"]); // in-flight, not closed
const OFFER_STATES = new Set(["offer", "accepted"]);

export type Tone = "good" | "warning" | "critical" | "neutral" | "accent";
// A time-series computed at two granularities the UI toggles between (default: week). "week" = last
// 12 weeks (Monday-anchored), "month" = last 12 months. Both are always sent so the toggle is instant
// (no refetch).
export type Ranged<T> = { week: T[]; month: T[] };
export type SeriesPoint = { key: string; label: string; count: number };
export type PrepPoint = { key: string; label: string; leetcode: number; systemDesign: number };
export type DashboardStats = {
  kpis: { applied: number; interviewed: number; offers: number; active: number; assessed: number; watchlist: number };
  rates: { interview: number; offer: number }; // fractions 0–1, of applied
  funnel: { key: string; label: string; count: number }[]; // cumulative, ordered
  outcomes: { key: string; label: string; count: number; tone: Tone }[]; // of applications
  applications: Ranged<SeriesPoint>; // applications by appliedDate
  prep: Ranged<PrepPoint>; // two lines: leetcode problems solved + system-design problems practiced
  prepTotals: { attempts: number; companies: number };
  agent: { done: number; queued: number; wip: number };
  recent: { at: string; summary: string; actor: string }[]; // last activity from the change log
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Bucket KEYS — everything in UTC so the keys here and the axes below always agree (mixing local
// getDay() with UTC toISOString silently shifts the day and drops dates into the wrong bucket).
function weekKey(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back up to Monday
  return d.toISOString().slice(0, 10);
}
const monthKey = (iso: string): string => (iso.length >= 7 ? iso.slice(0, 7) : ""); // YYYY-MM

// Bucket AXES — the last `n` week/month starts up to and including the one containing `now`.
function weekAxis(now: Date, n = 12): SeriesPoint[] {
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7));
  const out: SeriesPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const w = new Date(mon);
    w.setUTCDate(w.getUTCDate() - i * 7);
    const key = w.toISOString().slice(0, 10);
    out.push({ key, label: `${key.slice(5, 7)}/${key.slice(8, 10)}`, count: 0 });
  }
  return out;
}
function monthAxis(now: Date, n = 12): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: d.toISOString().slice(0, 7), label: MONTHS[d.getUTCMonth()], count: 0 });
  }
  return out;
}

export function dashboardStats(now: Date = new Date()): DashboardStats {
  const ps = db
    .select({ state: postings.state, fitScore: postings.fitScore, appliedDate: postings.appliedDate, interviewed: postings.interviewed })
    .from(postings)
    .all();
  const cos = db.select({ watchlist: companies.watchlist }).from(companies).all();

  const byState: Record<string, number> = {};
  for (const p of ps) byState[p.state] = (byState[p.state] ?? 0) + 1;
  const n = (pred: (p: (typeof ps)[number]) => boolean) => ps.filter(pred).length;

  const assessed = n((p) => p.fitScore != null);
  const applied = n((p) => APPLIED_STATES.has(p.state) || !!p.appliedDate);
  const interviewed = n((p) => p.interviewed || p.state === "interview" || OFFER_STATES.has(p.state));
  const offers = n((p) => OFFER_STATES.has(p.state));
  const active = n((p) => ACTIVE_STATES.has(p.state) && !OFFER_STATES.has(p.state));
  const watchlist = cos.filter((c) => c.watchlist).length;

  const funnel = [
    { key: "assessed", label: "Assessed", count: assessed },
    { key: "applied", label: "Applied", count: applied },
    { key: "interviewed", label: "Interviewed", count: interviewed },
    { key: "offer", label: "Offer", count: offers },
  ];

  const outcomes: DashboardStats["outcomes"] = [
    { key: "offer", label: "Offer / accepted", count: offers, tone: "good" },
    { key: "active", label: "In progress", count: active, tone: "accent" },
    { key: "rejected", label: "Rejected", count: byState["rejected"] ?? 0, tone: "critical" },
    { key: "ghost", label: "Ghosted", count: byState["ghost"] ?? 0, tone: "warning" },
    { key: "withdrawn", label: "Withdrawn", count: (byState["withdrawn"] ?? 0) + (byState["expired"] ?? 0), tone: "neutral" },
  ];

  // Applications over time — only postings that ACTUALLY reached an applied stage (APPLIED_STATES),
  // bucketed by appliedDate. A stray appliedDate on a still-in-discovery posting (assessed,
  // company_skipped, …) is NOT a submitted application and must not inflate the count.
  const appliedPostings = ps.filter((p) => p.appliedDate && APPLIED_STATES.has(p.state));
  const applications = {
    week: fill(weekAxis(now), appliedPostings, (p) => weekKey(p.appliedDate!)),
    month: fill(monthAxis(now), appliedPostings, (p) => monthKey(p.appliedDate!)),
  };

  // Prep progress over time — two lines: leetcode problems SOLVED (coding track, status solved) and
  // system-design problems PRACTICED (any attempt on the system_design track).
  const attempts = db
    .select({ at: prepAttempts.attemptedAt, status: prepAttempts.status, track: prepQuestions.track })
    .from(prepAttempts)
    .innerJoin(prepQuestions, eq(prepAttempts.questionId, prepQuestions.id))
    .all();
  const prep = {
    week: prepSeries(weekAxis(now), attempts, weekKey),
    month: prepSeries(monthAxis(now), attempts, monthKey),
  };

  const js = db.select({ status: jobs.status }).from(jobs).all();
  const agent = {
    done: js.filter((j) => j.status === "ingested").length,
    queued: js.filter((j) => j.status === "queued").length,
    wip: js.filter((j) => j.status === "wip").length,
  };

  const prepTotals = {
    attempts: attempts.length,
    companies: db.select({ slug: prepCompany.slug }).from(prepCompany).all().length,
  };

  const recent = db
    .select({ at: events.ts, summary: events.summary, actor: events.actor })
    .from(events)
    .all()
    .filter((e) => e.summary)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)
    .map((e) => ({ at: e.at, summary: e.summary ?? "", actor: e.actor }));

  return {
    kpis: { applied, interviewed, offers, active, assessed, watchlist },
    rates: { interview: applied ? interviewed / applied : 0, offer: applied ? offers / applied : 0 },
    funnel,
    outcomes,
    applications,
    prep,
    prepTotals,
    agent,
    recent,
  };
}

// Tally `rows` into a copy of `axis` by the bucket key each row maps to (empty key = skip).
function fill<R>(axis: SeriesPoint[], rows: R[], keyOf: (r: R) => string): SeriesPoint[] {
  const out = axis.map((b) => ({ ...b }));
  const idx = new Map(out.map((b, i) => [b.key, i]));
  for (const r of rows) {
    const i = idx.get(keyOf(r));
    if (i != null) out[i].count += 1;
  }
  return out;
}

// Tally prep attempts into two lines per bucket: leetcode = solved coding attempts, systemDesign =
// any system_design attempt.
type Attempt = { at: string; status: string; track: string };
function prepSeries(axis: SeriesPoint[], rows: Attempt[], keyOf: (iso: string) => string): PrepPoint[] {
  const out: PrepPoint[] = axis.map((b) => ({ key: b.key, label: b.label, leetcode: 0, systemDesign: 0 }));
  const idx = new Map(out.map((b, i) => [b.key, i]));
  for (const r of rows) {
    const i = idx.get(keyOf(r.at));
    if (i == null) continue;
    if (r.track === "coding" && r.status === "solved") out[i].leetcode += 1;
    else if (r.track === "system_design") out[i].systemDesign += 1;
  }
  return out;
}
