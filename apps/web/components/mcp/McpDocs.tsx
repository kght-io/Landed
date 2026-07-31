"use client";

import { useState } from "react";
import { Lock, Pencil } from "lucide-react";
import TabBar from "@/components/prep/TabBar";
import type { McpCategory, McpToolDoc } from "@/lib/mcp-tools";

// Per-category presentation: the four capabilities the agent works in. Order here = tab order.
const CATEGORIES: { key: McpCategory; label: string; blurb: string; text: string; dot: string }[] = [
  { key: "read", label: "Read", blurb: "Safe lookups — pull pipeline state, never mutate.", text: "text-sky-300", dot: "bg-sky-400" },
  { key: "scan", label: "Scan", blurb: "Fetch & scrape job boards on demand.", text: "text-amber-300", dot: "bg-amber-400" },
  { key: "queue", label: "Queue", blurb: "Lease and drain work jobs (the agent loop).", text: "text-violet-300", dot: "bg-violet-400" },
  { key: "write", label: "Write", blurb: "Mutate the pipeline — every change is logged to Changes.", text: "text-emerald-300", dot: "bg-emerald-400" },
];

// Render prose with `inline code` spans lifted out of the description — makes the long tool
// descriptions read like real API docs instead of a wall of text.
function Prose({ text }: { text: string }) {
  return (
    <p className="text-[13px] leading-relaxed text-zinc-400">
      {text.split(/(`[^`]+`)/g).map((seg, i) =>
        seg.startsWith("`") && seg.endsWith("`") && seg.length > 1 ? (
          <code key={i} className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[12px] text-zinc-200">{seg.slice(1, -1)}</code>
        ) : (
          <span key={i}>{seg}</span>
        ),
      )}
    </p>
  );
}

function ToolCard({ tool, cat }: { tool: McpToolDoc; cat: (typeof CATEGORIES)[number] }) {
  const sig = tool.params.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ");
  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 transition hover:border-zinc-700/80">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-mono text-[14px] leading-tight">
          <span className={`font-semibold ${cat.text}`}>{tool.name}</span>
          <span className="text-zinc-600">({sig})</span>
        </h3>
        <span
          title={tool.readOnly ? "Read-only — safe, no side effects" : "Mutates state (logged to Changes)"}
          className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${tool.readOnly ? "bg-zinc-800 text-zinc-400" : "bg-zinc-800 text-amber-300/90"}`}
        >
          {tool.readOnly ? <Lock size={9} /> : <Pencil size={9} />}
          {tool.readOnly ? "read-only" : "writes"}
        </span>
      </div>

      <div className="mt-2"><Prose text={tool.description} /></div>

      {tool.params.length > 0 ? (
        <dl className="mt-3 space-y-2 border-t border-zinc-800/70 pt-3">
          {tool.params.map((p) => (
            <div key={p.name} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px] leading-relaxed">
              <dt className="flex items-center gap-1.5 font-mono text-zinc-300">
                {p.name}
                <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-500">{p.type}</span>
                {p.required && <span className="text-[10px] font-semibold uppercase text-rose-300/80">req</span>}
              </dt>
              <dd className="self-center text-zinc-500">{p.description ?? <span className="text-zinc-600">—</span>}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[12px] text-zinc-600">No parameters.</p>
      )}
    </section>
  );
}

export default function McpDocs({ tools }: { tools: McpToolDoc[] }) {
  const present = CATEGORIES.filter((c) => tools.some((t) => t.category === c.key));
  const [tab, setTab] = useState<string>("all");
  const countOf = (key: McpCategory) => tools.filter((t) => t.category === key).length;
  const tabs = [
    { id: "all", label: `All ${tools.length}` },
    ...present.map((c) => ({ id: c.key, label: `${c.label} ${countOf(c.key)}` })),
  ];
  const shown = present.filter((c) => tab === "all" || c.key === tab);

  return (
    <div>
      <div className="mb-5"><TabBar tabs={tabs} active={tab} onChange={setTab} /></div>
      <div className="space-y-10">
        {shown.map((c) => {
          const list = tools.filter((t) => t.category === c.key);
          return (
            <section key={c.key}>
              <div className="mb-3 flex items-baseline gap-2.5">
                <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                <h2 className={`text-[13px] font-semibold uppercase tracking-wider ${c.text}`}>{c.label}</h2>
                <span className="text-[12px] text-zinc-500">{c.blurb}</span>
                <span className="ml-auto text-[11px] tabular-nums text-zinc-600">{list.length}</span>
              </div>
              <div className="space-y-3">{list.map((t) => <ToolCard key={t.name} tool={t} cat={c} />)}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
