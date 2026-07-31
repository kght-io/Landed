"use client";

import { MON_TEMPLATE, MON_DRILLS } from "@landed/shared/prep/reference/system-design-data";
import { SectionTitle } from "../ui";

// The monitoring answer framework: a causal chain (business → leading indicator), plus
// worked drills per system.
export default function Monitoring() {
  return (
    <div className="space-y-8">
      <div>
        <SectionTitle title="Monitoring Answer Template" sub="Not four random metrics — a causal chain that tells a story." />
        <p className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4 text-[14px] italic leading-relaxed text-zinc-400">
          {MON_TEMPLATE.formula}
        </p>
        <div className="mt-3 space-y-2">
          {MON_TEMPLATE.layers.map((l) => (
            <div key={l.name} className="rounded-lg border border-zinc-800/60 p-3">
              <p className="text-sm font-semibold text-zinc-200">{l.name}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-400">{l.desc}</p>
              <p className="mt-1 text-[13px] text-zinc-500"><span className="font-semibold text-zinc-400">e.g.</span> {l.example}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-amber-200/80">
          <span className="font-semibold">External deps. </span>
          {MON_TEMPLATE.externalDeps}
        </p>
      </div>

      <div>
        <SectionTitle title="Worked Drills" sub="Trace each system from business metric down to its leading indicator." />
        <div className="space-y-2">
          {MON_DRILLS.map((d) => (
            <div key={d.system} className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4">
              <p className="mb-2 text-sm font-semibold text-zinc-100">{d.system}</p>
              <dl className="space-y-1 text-[13px]">
                <Row label="Business" value={d.business} />
                <Row label="Service" value={d.service} />
                <Row label="Infra" value={d.infra} />
                <Row label="Leading" value={d.leading} accent />
                <Row label="Chain" value={d.chain} />
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className={`w-16 shrink-0 font-semibold ${accent ? "text-emerald-300/90" : "text-zinc-500"}`}>{label}</dt>
      <dd className="text-zinc-400">{value}</dd>
    </div>
  );
}
