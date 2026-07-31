"use client";

import { useEffect, useState } from "react";
import { EditToggle, PreviewItem } from "@/components/settings/EditControls";

// Standing guidance for how the agents assess fit and tailor résumés — the safe, editable knob for
// steering those phases (the playbooks themselves are read-only). Stored on the profile
// (fitGuidance / tailorGuidance) and read by fit.md / tailoring.md via getContext. Ships with
// sensible defaults; blank a field to fall back to the playbook's own judgement.
type Guidance = { fitGuidance: string; tailorGuidance: string };

export default function AgentGuidancePanel() {
  const [p, setP] = useState<Guidance | null>(null);
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => setP({ fitGuidance: d.profile?.fitGuidance ?? "", tailorGuidance: d.profile?.tailorGuidance ?? "" }))
      .catch(() => {});
  }, []);
  if (!p) return <p className="text-[13px] text-zinc-500">Loading…</p>;

  const save = (patch: Partial<Guidance>) => {
    pendo.track("agent_guidance_updated", { changed_fields: Object.keys(patch).join(",") });
    setP({ ...p, ...patch });
    fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
  };

  return (
    <EditToggle
      renderPreview={() => (
        <dl className="space-y-4">
          <PreviewItem label="Fit guidance" value={p.fitGuidance} full />
          <PreviewItem label="Tailoring guidance" value={p.tailorGuidance} accent="sky" full />
        </dl>
      )}
      renderEdit={() => (
        <div className="space-y-4">
          <GuidanceField label="Fit guidance" value={p.fitGuidance} onCommit={(v) => save({ fitGuidance: v })} />
          <GuidanceField label="Tailoring guidance" value={p.tailorGuidance} onCommit={(v) => save({ tailorGuidance: v })} />
        </div>
      )}
    />
  );
}

// Uncontrolled textarea — commits on blur when changed, so there's no controlled-state sync to keep.
function GuidanceField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <textarea
        defaultValue={value}
        onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
        rows={4}
        className="w-full resize-y rounded-lg bg-zinc-900 px-3 py-2 text-[13px] leading-relaxed text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 focus:ring-zinc-600"
      />
    </label>
  );
}
