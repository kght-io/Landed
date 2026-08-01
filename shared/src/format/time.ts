// Shared timestamp formatting for the UI.

// Relative "x ago" for recent times. Beyond a day it falls back to either an absolute
// time-of-day (`absolute: true`, for feeds that group by day already) or an ISO date.
export function ago(iso?: string | null, opts?: { absolute?: boolean }): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return opts?.absolute
    ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : new Date(iso).toISOString().slice(0, 10);
}

// Full local timestamp (date + time) — e.g. the inbox sync watermark.
export function fmtTs(iso?: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString([], {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
