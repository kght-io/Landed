"use client";

import { useState } from "react";
import PopoverPanel, { anchorFrom } from "@/components/Popover";
import { DISMISS_REASONS, DISMISS_REASON_HINTS, DISMISS_REASON_LABELS, type DismissReason } from "@landed/shared/jobs/dismiss";

// The one reason menu, shared by every place a posting can be discarded — the Scan-results tab and
// the Pipeline, per-row and in bulk. Deliberately one component rather than four call sites reading
// the same constant: a taxonomy that renders differently in different places is one people learn
// twice, and the labels are the supervised signal the scan filter is scored against.
//
// Every path through it commits a LABELLED discard. There is no unlabelled option, because being the
// path of least resistance is exactly how a label set ends up full of nulls — `Other` is the escape,
// and it costs the same single click as any other reason.
export default function DiscardMenu({
  at,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  onPick: (r: DismissReason) => void;
  onClose: () => void;
}) {
  return (
    <PopoverPanel at={at} onClose={onClose} className="p-1">
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Discard as</div>
        {DISMISS_REASONS.map((r) => (
          <button
            key={r}
            onClick={(e) => { e.stopPropagation(); onPick(r); onClose(); }}
            title={DISMISS_REASON_HINTS[r]}
            className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-rose-300 transition hover:bg-zinc-800"
          >
            {DISMISS_REASON_LABELS[r]}
          </button>
        ))}
      </div>
    </PopoverPanel>
  );
}

// A discard control: one button that opens the menu. `render` draws the trigger, so a caller can
// match its own surroundings (an icon-only cell action, or a labelled bar button) without the menu
// wiring being copied along with it.
export function DiscardButton({
  onPick,
  disabled,
  render,
}: {
  onPick: (r: DismissReason) => void;
  disabled?: boolean;
  render: (open: (e: React.MouseEvent) => void, isOpen: boolean) => React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      {render((e) => {
        e.stopPropagation();
        if (!disabled) setPos(pos ? null : anchorFrom(e));
      }, !!pos)}
      {pos && <DiscardMenu at={pos} onPick={onPick} onClose={() => setPos(null)} />}
    </>
  );
}
