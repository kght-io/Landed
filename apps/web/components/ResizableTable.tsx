"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

// Per-column widths (px) with drag-to-resize, persisted to localStorage. Use with a
// `table-layout: fixed` table whose total width = sum of the column widths.
export function useResizableColumns(defaults: Record<string, number>, storageKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>(defaults);
  // Latest widths, readable from the drag listeners without re-subscribing them each resize. Synced
  // after commit (a ref must not be mutated during render).
  const ref = useRef(widths);
  useEffect(() => { ref.current = widths; }, [widths]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      // Hydration-safe rehydrate: SSR/first render uses `defaults`, then we restore persisted widths
      // after mount (avoids a mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setWidths((w) => ({ ...w, ...JSON.parse(saved) }));
    } catch {}
  }, [storageKey]);

  const onMouseDown = useCallback(
    (key: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = ref.current[key] ?? 120;
      const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [key]: Math.max(56, startW + ev.clientX - startX) }));
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        try { localStorage.setItem(storageKey, JSON.stringify(ref.current)); } catch {}
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
    },
    [storageKey]
  );

  const total = (keys: string[]) => keys.reduce((s, k) => s + (widths[k] ?? 120), 0);
  return { widths, onMouseDown, total };
}

// A header cell. Pass `width` (fixed-layout tables) or `min`/`max` (auto-layout, flexible columns).
// Drag the right edge to resize when `onResize` is given. Pass `onSort` to make the label a sort
// toggle; `sortDir` ("asc" | "desc" | null) drives the indicator.
export function ResTh({ width, min, max, onResize, onSort, sortDir, className, style, children }: { width?: number; min?: number; max?: number; onResize?: (e: React.MouseEvent) => void; onSort?: () => void; sortDir?: "asc" | "desc" | null; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <th style={{ width, minWidth: min, maxWidth: max, ...style }} className={`relative select-none border-b border-zinc-800/80 px-2.5 py-1.5 text-left align-bottom text-[12px] font-medium uppercase tracking-wider text-zinc-600 first:pl-0 ${className ?? ""}`}>
      {onSort ? (
        <button onClick={onSort} className={`group/sort flex w-full items-center gap-1 truncate transition hover:text-zinc-300 ${sortDir ? "text-zinc-300" : ""}`}>
          <span className="truncate">{children}</span>
          {sortDir === "asc" ? <ChevronUp size={12} className="shrink-0" />
            : sortDir === "desc" ? <ChevronDown size={12} className="shrink-0" />
            : <ChevronsUpDown size={12} className="shrink-0 opacity-0 transition group-hover/sort:opacity-50" />}
        </button>
      ) : (
        <span className="block truncate">{children}</span>
      )}
      {onResize && (
        <span
          onMouseDown={onResize}
          onClick={(e) => e.stopPropagation()}
          className="absolute -right-px top-1.5 bottom-1.5 z-10 w-1.5 cursor-col-resize rounded bg-transparent transition hover:bg-zinc-600"
        />
      )}
    </th>
  );
}
