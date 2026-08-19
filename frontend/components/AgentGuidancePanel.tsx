"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Check, Pencil, Archive } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PromptFeature } from "@landed/shared/db/enums";

// The editable half of the fit / tailoring prompts — how fitness is judged, how a résumé is
// tailored. The workflow half (which tool to call, the result schema, where files land) stays in the
// repo playbooks and is read-only in the app, so an experiment can only ever change the judgment.
//
// Versions are immutable and append-only: editing means saving the NEXT version, and results carry
// the version that produced them, so /dashboard/prompts can attribute callbacks to a prompt. That's
// why this panel does NOT use the commit-on-blur idiom the other settings panels share — blur-saving
// would mint a version every time you tabbed out of the textarea.

type PromptVersion = {
  id: number;
  feature: PromptFeature;
  version: number;
  label: string | null;
  body: string;
  active: boolean;
  archived: boolean;
  createdAt: string;
};

export default function AgentGuidancePanel() {
  return (
    <div className="space-y-6">
      <PromptEditor
        feature="fit"
        title="Fit guidance"
        hint="The whole method for judging fit — how gaps are weighted, how the leveling call is made, how strict to be. fit.md keeps only the plumbing."
      />
      <div className="border-t border-zinc-800" />
      <PromptEditor
        feature="tailoring"
        title="Tailoring guidance"
        hint="The whole method for tailoring — the plan, the zones to work, how far to reword a bullet, the truthfulness bar. tailoring.md keeps only the plumbing."
      />
      <p className="text-[12px] text-zinc-500">
        <Link href="/dashboard/prompts" className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300">
          <BarChart3 size={12} /> See how each version&apos;s applications landed
        </Link>{" "}
        — every application, with the version that produced it.
      </p>
    </div>
  );
}

function PromptEditor({ feature, title, hint }: { feature: PromptFeature; title: string; hint: string }) {
  const [versions, setVersions] = useState<PromptVersion[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (prefer?: "active") => {
      const d = await fetch(`/api/prompts?feature=${feature}`).then((r) => r.json());
      const list: PromptVersion[] = d.versions ?? [];
      setVersions(list);
      setSelectedId((cur) => {
        if (prefer === "active" || cur == null) return list.find((v) => v.active)?.id ?? list[0]?.id ?? null;
        return list.some((v) => v.id === cur) ? cur : (list.find((v) => v.active)?.id ?? null);
      });
    },
    [feature],
  );

  useEffect(() => {
    // Fetch-on-mount loader; its setState runs post-await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!versions) return <p className="text-[13px] text-zinc-500">Loading…</p>;
  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const activeVersion = versions.find((v) => v.active) ?? null;
  const nextVersion = Math.max(0, ...versions.map((v) => v.version)) + 1;

  const patch = async (id: number, body: Record<string, unknown>) => {
    setError(null);
    const r = await fetch(`/api/prompts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? "could not update");
      return;
    }
    await load();
  };

  const saveAsNew = async () => {
    if (!draft.trim()) return;
    setError(null);
    pendo.track("prompt_version_created", { feature });
    const r = await fetch("/api/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature, body: draft, label: label.trim() || null }),
    });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? "could not save");
      return;
    }
    const { version } = (await r.json()) as { version: PromptVersion };
    setEditing(false);
    setLabel("");
    await load();
    setSelectedId(version.id);
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-medium text-zinc-200">{title}</h3>
        {activeVersion && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
            v{activeVersion.version} active
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {versions.length > 1 && !editing && (
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-lg bg-zinc-900 px-2 py-1 text-[12px] text-zinc-300 ring-1 ring-inset ring-zinc-800 outline-none focus:ring-zinc-600"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version}
                  {v.label ? ` — ${v.label}` : ""}
                  {v.active ? " (active)" : ""}
                </option>
              ))}
            </select>
          )}
          {!editing && (
            <button
              onClick={() => {
                setDraft(selected?.body ?? "");
                setEditing(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700"
            >
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>
      </div>
      <p className="text-[12px] text-zinc-500">{hint}</p>

      {editing ? (
        <div className="space-y-2">
          {/* Markdown, and long — this is the whole judgment for the job, not a one-line nudge. */}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={20}
            spellCheck={false}
            className="w-full resize-y rounded-lg bg-zinc-900 px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 focus:ring-zinc-600"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="What are you trying? (optional label)"
              className="min-w-0 flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 placeholder:text-zinc-600 focus:ring-zinc-600"
            />
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={saveAsNew}
              disabled={!draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1 text-[12px] font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
            >
              <Check size={12} /> Save as v{nextVersion}
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">
            Saving keeps v{activeVersion?.version ?? nextVersion - 1} running. Activate v{nextVersion} when you want new runs to use it.
          </p>
        </div>
      ) : (
        <>
          {/* Same renderer the read-only playbook viewer uses, so the guidance and the workflow
              prose it replaced look like one document. */}
          <article className="prose-instructions max-h-96 overflow-y-auto rounded-lg bg-zinc-900/60 px-3 py-2 ring-1 ring-inset ring-zinc-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected?.body ?? "—"}</ReactMarkdown>
          </article>
          {selected && !selected.active && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  pendo.track("prompt_version_activated", { feature });
                  patch(selected.id, { active: true });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-2.5 py-1 text-[12px] font-medium text-sky-300 ring-1 ring-inset ring-sky-500/25 transition hover:bg-sky-500/25"
              >
                <Check size={12} /> Use v{selected.version} from now on
              </button>
              <button
                onClick={() => patch(selected.id, { archived: true })}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-500 transition hover:text-zinc-300"
                title="Hide from this list. Past results keep pointing at it."
              >
                <Archive size={12} /> Archive
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="text-[12px] text-rose-400">{error}</p>}
    </section>
  );
}
