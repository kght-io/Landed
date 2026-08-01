"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, History } from "lucide-react";
import { STATUS_LABEL, STATUS_CHIP } from "@landed/shared/pipeline/stages";
import type { Status } from "@landed/shared/types";

export type TrackerItem = { role: string; status: string; date?: string; appliedDate?: string; interviewed?: boolean };

type Bucket = "recent" | "old";

// Compact per-company tracker badge under the name: two chips — a count of recent applications
// (≤1 month, clock) and older ones (>1 month, history). Hover a chip to see the labelled list.
// The detail card is `fixed` (so the table's overflow can't clip it) and stays open while you
// move onto it.
export default function TrackerTag({ items }: { items: TrackerItem[] }) {
  const [hover, setHover] = useState<{ bucket: Bucket; x: number; y: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  if (!items.length) return null;

  const cut = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const eff = (i: TrackerItem) => i.appliedDate ?? i.date ?? "";
  const byDesc = (a: TrackerItem, b: TrackerItem) => eff(b).localeCompare(eff(a));

  const recent = items.filter((i) => { const e = eff(i); return !e || e >= cut; }).sort(byDesc);
  const old = items.filter((i) => { const e = eff(i); return e && e < cut; }).sort(byDesc);

  const show = (e: React.MouseEvent, bucket: Bucket) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHover({ bucket, x: r.left, y: r.bottom });
  };
  const scheduleHide = () => { hideTimer.current = setTimeout(() => setHover(null), 120); };
  const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };

  const rows = hover?.bucket === "recent" ? recent : hover?.bucket === "old" ? old : [];
  const label = hover?.bucket === "recent" ? "less than 1 month ago" : "more than 1 month ago";

  // A count chip. Plain function (not a component) so it isn't "created during render".
  const chip = (bucket: Bucket, n: number, Icon: typeof Clock, color: string) =>
    n === 0 ? null : (
      <span
        onMouseEnter={(e) => show(e, bucket)}
        onMouseLeave={scheduleHide}
        title={`${n} application${n === 1 ? "" : "s"} ${bucket === "recent" ? "≤" : ">"}1 month ago`}
        className={`inline-flex cursor-default items-center gap-1 text-[12px] font-medium tabular-nums ${color}`}
      >
        <Icon size={11} className="shrink-0" />
        {n}
      </span>
    );

  return (
    <>
      <div className="mt-1 flex items-center gap-2.5">
        {/* recent (≤1mo) = orange (recent activity); older (>1mo) = green */}
        {chip("recent", recent.length, Clock, "text-amber-400")}
        {chip("old", old.length, History, "text-emerald-400")}
      </div>
      {hover && rows.length > 0 && (
        <HoverCard at={hover} onEnter={cancelHide} onLeave={scheduleHide}>
          <p className="mb-1.5 px-1 text-[12px] font-medium text-zinc-400">
            {rows.length} application{rows.length === 1 ? "" : "s"} {label}
          </p>
          {rows.map((i, idx) => (
            <div key={idx} className="flex items-center gap-2 py-0.5 text-[13px]">
              <span className="w-[72px] shrink-0 tabular-nums text-zinc-500">{eff(i) || "—"}</span>
              <span className="flex-1 truncate text-zinc-300">{i.role}</span>
              <span className={`shrink-0 rounded px-1 py-0.5 text-[12px] font-medium ${STATUS_CHIP[i.status as Status] ?? "text-zinc-400"}`}>
                {STATUS_LABEL[i.status as Status] ?? i.status}
                {i.status === "rejected" && i.interviewed ? " (interviewed)" : ""}
              </span>
            </div>
          ))}
        </HoverCard>
      )}
    </>
  );
}

// A fixed, viewport-clamped hover card (no backdrop, unlike the click PopoverPanel) so it can be
// kept open while the cursor moves from the chip onto it. PORTALED to <body> (like PopoverPanel /
// LinkPreview): this renders from inside a FROZEN sticky table cell whose own stacking context would
// otherwise trap the `fixed z-[60]` card beneath the sticky spine / frozen columns. `at` is already
// viewport coords (getBoundingClientRect), so fixed positioning stays correct from the body.
function HoverCard({ at, onEnter, onLeave, children }: { at: { x: number; y: number }; onEnter: () => void; onLeave: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y + 4 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const M = 8;
    const { width, height } = el.getBoundingClientRect();
    let left = at.x;
    let top = at.y + 4;
    if (left + width > window.innerWidth - M) left = Math.max(M, window.innerWidth - width - M);
    if (top + height > window.innerHeight - M) top = Math.max(M, window.innerHeight - height - M);
    setPos({ left, top });
  }, [at.x, at.y]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="fixed z-[60] max-h-80 w-80 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-left shadow-xl shadow-black/40"
    >
      {children}
    </div>,
    document.body,
  );
}
