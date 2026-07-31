"use client";

import { COMPLEXITY } from "@landed/shared/prep/reference/coding-data";
import { SectionTitle } from "../ui";

function Table({ cols, rows }: { cols: { key: string; label: string }[]; rows: readonly Record<string, string>[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800/70">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            {cols.map((c) => (
              <th key={c.key} className="px-3 py-2 font-semibold uppercase tracking-wider text-zinc-500 text-[12px]">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-800/50 last:border-0">
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 align-top ${c.key === "name" ? "font-medium text-zinc-200" : c.key === "note" ? "text-zinc-500" : "font-mono text-zinc-300"}`}
                >
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Big-O cheat sheet: data structures, algorithms, sorting.
export default function ComplexityRef() {
  return (
    <div className="space-y-7">
      <SectionTitle title="Complexity Reference" sub="Know these cold. State time AND space proactively in interviews." />

      <div>
        <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-600">Data Structures</p>
        <Table
          cols={[
            { key: "name", label: "Structure" },
            { key: "access", label: "Access" },
            { key: "search", label: "Search" },
            { key: "insert", label: "Insert" },
            { key: "delete", label: "Delete" },
            { key: "space", label: "Space" },
            { key: "note", label: "Note" },
          ]}
          rows={COMPLEXITY.dataStructures}
        />
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-600">Algorithms</p>
        <Table
          cols={[
            { key: "name", label: "Algorithm" },
            { key: "time", label: "Time" },
            { key: "space", label: "Space" },
            { key: "note", label: "Note" },
          ]}
          rows={COMPLEXITY.algorithms}
        />
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-600">Sorting</p>
        <Table
          cols={[
            { key: "name", label: "Algorithm" },
            { key: "avg", label: "Avg" },
            { key: "worst", label: "Worst" },
            { key: "space", label: "Space" },
            { key: "stable", label: "Stable" },
            { key: "note", label: "Note" },
          ]}
          rows={COMPLEXITY.sorting}
        />
      </div>
    </div>
  );
}
