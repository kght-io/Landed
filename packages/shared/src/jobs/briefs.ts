import type { BriefGap, BriefSource, InterviewBrief, SourcedText } from "../types";
import { str } from "../coerce";

// Helpers for the posting interview-brief history (postings.interview_briefs). One JSON
// InterviewBrief[] holds every generated version, oldest → newest; each generation appends a new
// version (like a RedoTurn agent turn). Mirrors lib/jobs/redolog.ts for the résumé/fit thread.

export function parseBriefs(raw: string | null | undefined): InterviewBrief[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? (a as InterviewBrief[]) : [];
  } catch {
    return [];
  }
}

// The version the NEXT generation will produce = highest existing version + 1 (v1 first). Uses the
// max version rather than length so it stays monotonic even if a version were ever removed.
export const nextBriefVersion = (list: InterviewBrief[]): number =>
  list.reduce((m, b) => Math.max(m, b.version ?? 0), 0) + 1;

// The current brief = the highest-versioned one (what the drawer shows by default), or null.
export const latestBrief = (list: InterviewBrief[]): InterviewBrief | null =>
  list.length ? list.reduce((a, b) => ((b.version ?? 0) >= (a.version ?? 0) ? b : a)) : null;

export const appendBrief = (raw: string | null | undefined, brief: InterviewBrief): string =>
  JSON.stringify([...parseBriefs(raw), brief]);

// Provenance tag on a fact/gap — clamps unknown values to undefined (no chip rendered).
const SOURCES = new Set<BriefSource>(["recruiter", "jd", "online"]);
const coerceSource = (raw: unknown): BriefSource | undefined => {
  const s = str(raw)?.toLowerCase();
  return s && SOURCES.has(s as BriefSource) ? (s as BriefSource) : undefined;
};

// Coerce an untyped agent fact into SourcedText. Accepts a bare string, or `{ text|value, source }`.
// Returns undefined when there's no text so the field is omitted rather than stored empty.
export function coerceSourced(raw: unknown): SourcedText | undefined {
  if (typeof raw === "string") {
    const t = str(raw);
    return t ? { text: t } : undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const text = str(r.text) ?? str(r.value);
  if (!text) return undefined;
  const source = coerceSource(r.source);
  return { text, ...(source ? { source } : {}) };
}

// Coerce an untyped agent `gaps` payload into BriefGap[]. Drops entries with no `area`; clamps
// severity + source to their allowed sets (unknown → undefined). Returns undefined when there's
// nothing usable so the field is omitted rather than stored as [].
const SEVERITIES = new Set(["high", "medium", "low"]);
export function coerceGaps(raw: unknown): BriefGap[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: BriefGap[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const r = g as Record<string, unknown>;
    const area = str(r.area) ?? str(r.text) ?? str(r.gap);
    if (!area) continue;
    const sev = str(r.severity);
    const source = coerceSource(r.source);
    out.push({
      area,
      ...(str(r.why) ?? str(r.detail) ? { why: str(r.why) ?? str(r.detail) } : {}),
      ...(sev && SEVERITIES.has(sev) ? { severity: sev as BriefGap["severity"] } : {}),
      ...(source ? { source } : {}),
    });
  }
  return out.length ? out : undefined;
}
