// Loose coercion for untyped agent / JSON result records (fields come in as `unknown`).
export const str = (v: unknown): string | undefined => (v == null || v === "" ? undefined : String(v));
// Returns a real number or null — never NaN. Callers rely on the `?? fallback` idiom
// (`num(x) ?? 40`), and `NaN ?? 40` is NaN, so a leaked NaN would silently defeat the
// default. Non-numeric input (e.g. an agent returning "high" or "N/A") coerces to null.
export const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

// --- reporting the fallbacks -------------------------------------------------------------------
// str/num answer "what is this value?". The rest of this file answers "what did we do when we
// couldn't tell?".
//
// Leniency toward agent output is deliberate (see agents/sources/inbox.ts) — a record we can
// half-read beats one we reject. But a fallback nobody records is indistinguishable from a value
// that was right: an unrecognized status becomes "applied" and then proposes a real-looking stage
// change on the Changes page. Collect the substitutions so the caller can SAY what it decided.
// Note the asymmetry — an ABSENT optional field is normal and never warns; only an unreadable one.

export type CoerceWarning = {
  subject?: string; // which record it came from, for a human ("Netflix — Senior SWE")
  field: string; // the field we couldn't read ("status")
  value: string; // what the agent actually sent ("ghosted")
  used: string; // what we substituted ("applied")
};

export type WarningLog = ReturnType<typeof warningLog>;

export function warningLog() {
  const list: CoerceWarning[] = [];
  return {
    list,
    // Look `key` up in `map`; on a miss, record the substitution and return `fallback`. `key` is
    // pre-normalized by the caller (each map normalizes differently) while `value` is what actually
    // arrived — that's the one a human needs to see.
    pick<T extends string>(map: Record<string, T>, key: string, fallback: T, about: { subject?: string; field: string; value: string }): T {
      const hit = map[key];
      if (hit !== undefined) return hit;
      list.push({ ...about, used: fallback });
      return fallback;
    },
  };
}

// One human-readable clause for a run's warnings, or "" when there were none — so a caller can
// append it to a summary unconditionally. Lists a few by name; a long tail just gets counted,
// because the summary sits on a job row, not in a log.
export function describeWarnings(list: CoerceWarning[], show = 3): string {
  if (!list.length) return "";
  const named = list.slice(0, show).map((w) => `${w.field} "${w.value}"→${w.used}`).join(", ");
  const rest = list.length - show;
  return `${list.length} unreadable value${list.length === 1 ? "" : "s"} (${named}${rest > 0 ? `, +${rest} more` : ""})`;
}
