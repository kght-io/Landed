"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Anchor a popover just below a clicked element. Fixed-positioned so it isn't clipped by a
// table's overflow.
export function anchorFrom(e: React.MouseEvent): { x: number; y: number } {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

// A click-dismissable popover panel: full-screen backdrop (closes on click) + a fixed card at
// `at`. Callers own the open state + trigger; this is just the panel chrome. After mount it
// measures itself and shifts to stay within the viewport, so triggers near the bottom/right edge
// don't get clipped.
export default function PopoverPanel({
  at,
  onClose,
  className,
  children,
}: {
  at: { x: number; y: number };
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y + 4 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const M = 8; // viewport margin
    const { width, height } = el.getBoundingClientRect();
    let left = at.x;
    let top = at.y + 4;
    if (left + width > window.innerWidth - M) left = Math.max(M, window.innerWidth - width - M);
    if (top + height > window.innerHeight - M) top = Math.max(M, window.innerHeight - height - M);
    setPos({ left, top });
  }, [at.x, at.y]);

  // Portal to <body>: triggers live inside FROZEN (position:sticky, z-index) table cells, each its
  // own stacking context — a `fixed z-[60]` panel rendered there is trapped within the cell and the
  // page chrome (sticky spine z-30, other frozen columns) paints over it. Portaling escapes to the
  // root stacking context where z-[60] wins. (anchorFrom already gives viewport coords, so fixed
  // positioning stays correct from the body.)
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* Above the floating the agent button (z-50) so it can't overlap the panel or eat its clicks. */}
      <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        className={`fixed z-[60] rounded-lg border border-zinc-700 bg-zinc-900 text-left shadow-xl shadow-black/40 ${className ?? ""}`}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
