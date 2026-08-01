"use client";

import Field from "@/components/Field";
import { type LevelingRef } from "@landed/shared/config/leveling";
import { EditToggle, PreviewItem } from "@/components/settings/EditControls";

// Editable leveling reference — the anchor every company is matched against in the level popover.
// Edits the human-readable identity (company · role · level); the 1–10 ladder behind it is collected
// from levels.fyi, not edited here. Chrome-less: the settings page owns the card. Null while loading.
export default function LevelingRefPanel({ value, onSave }: { value: LevelingRef | null; onSave: (patch: Partial<LevelingRef>) => void }) {
  if (!value) return <p className="text-[13px] text-zinc-500">Loading…</p>;
  const ref = value;
  const save = onSave;
  const targetMissing = !ref.ladder[ref.targetBand];

  return (
    <EditToggle
      renderPreview={() => (
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          <PreviewItem accent="sky" label="Company" value={ref.company} />
          <PreviewItem accent="sky" label="Role" value={ref.role} />
          <PreviewItem accent="sky" label="Level" value={ref.targetBand} />
          {targetMissing && (
            <p className="text-[11px] text-amber-400/80 sm:col-span-3">⚠ no rung named “{ref.targetBand}” in the levels.fyi ladder</p>
          )}
        </dl>
      )}
      renderEdit={() => (
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
          <Field accent="sky" label="Company" value={ref.company} onCommit={(v) => save({ company: v })} placeholder="e.g. Amazon" />
          <Field accent="sky" label="Role" value={ref.role} onCommit={(v) => save({ role: v })} placeholder="e.g. Software Engineer" />
          <Field accent="sky" label="Level" value={ref.targetBand} onCommit={(v) => save({ targetBand: v.trim() })} placeholder="e.g. L6"
            hint={targetMissing ? "⚠ no rung by this name in the levels.fyi ladder" : "your target level"} />
        </div>
      )}
    />
  );
}
