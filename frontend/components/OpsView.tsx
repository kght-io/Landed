"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, HardDrive } from "lucide-react";
import type { FitBucket } from "@landed/shared/experiments/prompts";

// Ops answers ONE question: is the pipeline making the same calls you would?
//
// It used to answer "is the machine alive" — queue depth, in-flight, failures, an agent-health
// table. All of that moved to Agents › Dashboard, where the per-agent telemetry already lives, and
// liveness is something you notice anyway on a single-user local app. What you cannot notice is a
// stage quietly disagreeing with you, which is what everything below measures.

type Funnel = {
  fetched: number; mechanical: number; glance: number; you: number; unattributed: number;
  triage: number; fit: number; applied: number; levelled: number; widened: number;
};
type ScanQuality = { agreed: number; discarded: number; undecided: number; decided: number; precision: number | null; byReason: Record<string, number> };
type FitQuality = {
  truePositives: number; trueNegatives: number; falsePositives: number; falseNegatives: number;
  pending: number; decided: number; precision: number | null; recall: number | null;
};
type CallbackBand = { bucket: FitBucket; applications: number; decided: number; callbacks: number; rate: number | null };
type OpsFile = { label: string; path: string; bytes: number; note?: string };
type Ops = {
  funnel: Funnel;
  quality: {
    since: string;
    era: { version: number; effectiveFrom: string; changed: string[] } | null;
    scan: ScanQuality; fit: FitQuality; callback: CallbackBand[];
  };
  storage: OpsFile[];
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const mb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const n = (v: number) => v.toLocaleString();

// A rate and the count it rests on, always together: 57% of 35 decisions is a different claim from
// 57% of 3,500, and a bare percentage reads as settled either way.
function Rate({ label, value, detail, warn }: { label: string; value: string; detail: string; warn?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
      <span className="w-20 shrink-0 text-zinc-500">{label}</span>
      <span className="w-12 shrink-0 tabular-nums font-medium text-zinc-200">{value}</span>
      <span className="text-[12px] text-zinc-500">{detail}</span>
      {warn && (
        <span className="inline-flex items-center gap-1 text-[12px] text-amber-300">
          <AlertTriangle size={11} /> {warn}
        </span>
      )}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-400">
        {title}
        {aside && <span className="text-[11px] font-normal normal-case tracking-normal text-zinc-600">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

export default function OpsView() {
  const [d, setD] = useState<Ops | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // No setState in the effect body — that's the cascading-render rule. Loading is derived below.
    fetch("/api/ops")
      .then((r) => r.json())
      .then((j) => { setFailed(!!j.error); setD(j.error ? null : j); })
      .catch(() => setFailed(true));
  }, []);

  if (!d) {
    return (
      <div className="flex items-center gap-2 px-6 py-10 text-[13px] text-zinc-500">
        {failed ? "Couldn't load ops." : <><Loader2 size={14} className="animate-spin" /> loading…</>}
      </div>
    );
  }

  const { funnel: f, quality: q, storage } = d;
  const highBand = q.callback.find((b) => b.bucket === "80+");
  const midBand = q.callback.find((b) => b.bucket === "60-79");
  // The single most important line on the page, and it reads as "fine" unless something says
  // otherwise: if a high score converts no better than a middling one, the score isn't measuring
  // anything the market agrees with.
  const scoreIsInert =
    highBand?.rate != null && midBand?.rate != null && highBand.rate <= midBand.rate + 0.05;

  const stage = (label: string, value: number) => (
    <span className="whitespace-nowrap">
      <span className="tabular-nums text-zinc-200">{n(value)}</span> <span className="text-zinc-600">{label}</span>
    </span>
  );

  return (
    <div className="flex h-full flex-col text-zinc-100">
      <header className="px-6 pt-3.5">
        <h1 className="text-[15px] font-semibold tracking-tight">Ops</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">Is the pipeline making the calls you would?</p>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5">
        <Section
          title="Pipeline"
          aside={q.era ? `preference era v${q.era.version} · since ${q.era.effectiveFrom.slice(0, 10)}` : `since ${q.since.slice(0, 10)}`}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            {stage("scanned", f.fetched)}
            <span className="text-zinc-700">→</span>
            {stage("triage", f.triage)}
            <span className="text-zinc-700">→</span>
            {stage("in fit", f.fit)}
            <span className="text-zinc-700">→</span>
            {stage("applied", f.applied)}
          </div>
          <div className="mt-2 space-y-0.5 text-[12px] text-zinc-500">
            <div><span className="inline-block w-16 tabular-nums text-zinc-400">{n(f.mechanical)}</span> cut by filter</div>
            <div><span className="inline-block w-16 tabular-nums text-zinc-400">{n(f.glance)}</span> cut at glance <span className="text-zinc-600">— the agent</span></div>
            <div><span className="inline-block w-16 tabular-nums text-zinc-400">{n(f.you)}</span> you discarded</div>
            <div><span className="inline-block w-16 tabular-nums text-zinc-600">{n(f.unattributed)}</span> <span className="text-zinc-600">unattributed — pre-dates the labels</span></div>
          </div>
        </Section>

        <Section title="Quality">
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h3 className="mb-2 text-[12px] font-medium text-zinc-300">scan → triage</h3>
              <div className="space-y-1">
                <Rate label="precision" value={pct(q.scan.precision)} detail={`${q.scan.agreed} kept of ${q.scan.decided} decided · ${q.scan.undecided} undecided`} />
                {/* Not zero — uncomputable. A posting the filter dropped leaves no trace of whether
                    you'd have wanted it, so only sampling the drops can answer this. Saying so beats
                    an empty row, which would read as "fine". */}
                <Rate label="recall" value="—" detail="unmeasurable — a dropped posting leaves no trace" />
              </div>
              {Object.keys(q.scan.byReason).length > 0 && (
                <p className="mt-2 text-[12px] text-zinc-500">
                  discarded:{" "}
                  {Object.entries(q.scan.byReason).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h3 className="mb-2 text-[12px] font-medium text-zinc-300">fit → advance</h3>
              <div className="space-y-1">
                <Rate label="precision" value={pct(q.fit.precision)} detail={`${q.fit.truePositives} advanced of ${q.fit.truePositives + q.fit.falsePositives} it said yes to`} />
                {/* The one that costs a job rather than a run — and the one a merged accuracy figure
                    hid completely, because correctly binning obvious rejects is the easy half. */}
                <Rate
                  label="recall"
                  value={pct(q.fit.recall)}
                  detail={`${q.fit.truePositives} of ${q.fit.truePositives + q.fit.falseNegatives} you wanted`}
                  warn={q.fit.recall !== null && q.fit.recall < 0.6 ? "misses jobs you'd take" : undefined}
                />
              </div>
              <p className="mt-2 text-[12px] text-zinc-600 tabular-nums">
                TP {q.fit.truePositives} · TN {q.fit.trueNegatives} · FP {q.fit.falsePositives} · FN {q.fit.falseNegatives} · {q.fit.pending} pending
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h3 className="mb-2 text-[12px] font-medium text-zinc-300">apply → callback</h3>
              <div className="space-y-1">
                {q.callback.filter((b) => b.applications > 0).map((b) => (
                  <Rate
                    key={b.bucket}
                    label={b.bucket}
                    value={pct(b.rate)}
                    detail={`${b.applications} apps · ${b.decided} decided · ${b.callbacks} callbacks`}
                  />
                ))}
              </div>
              {scoreIsInert && (
                <p className="mt-2 inline-flex items-start gap-1.5 text-[12px] text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  A high score converts no better than a middling one — the score isn&apos;t predicting outcomes.
                </p>
              )}
            </div>
          </div>
        </Section>

        <Section title="Disk">
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-left text-[12px]">
              <tbody>
                {storage.map((s) => (
                  <tr key={s.path} className="border-b border-zinc-800/60 last:border-b-0">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-zinc-300"><HardDrive size={12} className="text-zinc-600" />{s.label}</span>
                      {s.note && <span className="ml-2 text-zinc-600">{s.note}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-600">{s.path}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{mb(s.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
