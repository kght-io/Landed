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
