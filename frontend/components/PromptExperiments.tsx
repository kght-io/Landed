"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpDown } from "lucide-react";
import type { ExperimentRow, PromptExperiments as Results } from "@landed/backend/db/prompt-experiments";
import type { Outcome } from "@landed/shared/experiments/prompts";

// The raw experiment record: one row per application, with the prompt versions that produced it
// next to the outcome. No charts and no rates — the first stamped runs are only now landing, and a
// summary shipped this early would be a guess at which cut matters. Look at the rows first.

const OUTCOME: Record<Outcome, { label: string; cls: string }> = {
  callback: { label: "Callback", cls: "bg-emerald-500/15 text-emerald-300" },
  no_callback: { label: "No reply", cls: "bg-zinc-700/40 text-zinc-400" },
  pending: { label: "Waiting", cls: "bg-sky-500/15 text-sky-300" },
  excluded: { label: "Excluded", cls: "bg-zinc-800/60 text-zinc-600" },
};

type SortKey = "appliedAt" | "company" | "fitScore" | "outcome";

export default function PromptExperiments() {
  const [data, setData] = useState<Results | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "appliedAt", desc: true });

  useEffect(() => {
    // Fetch-on-mount loader; its setState runs post-await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetch("/api/prompts/results")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const val = (r: ExperimentRow) =>
      sort.key === "fitScore" ? (r.fitScore ?? -1) : sort.key === "outcome" ? r.outcome : (r[sort.key] ?? "");
    return [...data.rows].sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -c : c;
    });
  }, [data, sort]);

  if (!data) return <p className="px-6 py-10 text-[13px] text-zinc-500">Loading…</p>;

  const byId = new Map(data.versions.map((v) => [v.id, v]));
  const version = (id: number | null) => (id == null ? null : `v${byId.get(id)?.version ?? "?"}`);
  const th = (key: SortKey, label: string, right?: boolean) => (
    <th className={`py-1.5 px-2 font-medium ${right ? "text-right" : "text-left"}`}>
      <button
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
        className={`inline-flex items-center gap-1 transition hover:text-zinc-300 ${sort.key === key ? "text-zinc-300" : ""}`}
      >
        {label} <ArrowUpDown size={10} className={sort.key === key ? "opacity-100" : "opacity-30"} />
      </button>
    </th>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-6">
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-[12px] text-zinc-500 transition hover:text-zinc-300">
            <ArrowLeft size={12} /> Stats
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Prompt experiments</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-zinc-500">
            Every application, with the prompt versions that produced it. No rates yet — too few runs are stamped for a
            summary to mean anything, and the wrong summary is harder to unlearn than none. {data.rows.length} applications;
            silence counts as a no after {data.windowDays} days; withdrawn and expired are marked excluded because they were
            your call, not the prompt&apos;s.
          </p>
        </header>

        <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/30">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
                {th("appliedAt", "Applied")}
                {th("company", "Company")}
                <th className="py-1.5 px-2 text-left font-medium">Role</th>
                {th("fitScore", "Fit", true)}
                <th className="py-1.5 px-2 text-left font-medium">Band</th>
                <th className="py-1.5 px-2 text-left font-medium">Fit prompt</th>
                <th className="py-1.5 px-2 text-left font-medium">Tailor prompt</th>
                <th className="py-1.5 px-2 text-left font-medium">State</th>
                {th("outcome", "Outcome")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.postingId} className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/40">
                  <td className="py-1.5 px-2 tabular-nums text-zinc-400">{r.appliedAt}</td>
                  <td className="py-1.5 px-2 text-zinc-200">{r.company}</td>
                  <td className="max-w-xs truncate py-1.5 px-2 text-zinc-400" title={r.role}>{r.role}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">{r.fitScore ?? "—"}</td>
                  <td className="py-1.5 px-2 text-[12px] text-zinc-500">{r.fitBucket}</td>
                  <td className="py-1.5 px-2 tabular-nums text-zinc-300">{version(r.fitPromptVersionId) ?? <Dash />}</td>
                  <td className="py-1.5 px-2 tabular-nums text-zinc-300">
                    {version(r.tailorPromptVersionId) ?? <span className="text-zinc-600">{r.tailored ? "untracked" : "not tailored"}</span>}
                  </td>
                  <td className="py-1.5 px-2 text-[12px] text-zinc-500">{r.state}</td>
                  <td className="py-1.5 px-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${OUTCOME[r.outcome].cls}`}>
                      {OUTCOME[r.outcome].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[12px] text-zinc-600">
          A blank prompt column means that job never ran for this posting — it was applied to without an assessment, or
          without a tailored résumé. Those aren&apos;t failures of a prompt; they&apos;re the applications no prompt touched.
        </p>
      </div>
    </div>
  );
}

const Dash = () => <span className="text-zinc-600">not assessed</span>;
