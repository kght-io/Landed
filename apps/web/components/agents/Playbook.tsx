"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";

// Read-only view of a single instruction .md file (a job's playbook or a guide). Instructions carry
// the agents' MCP wiring + operating rules, so they're edited in the repo (instructions/) — not from
// the UI. Shared by the Agents page's Guides list (inline, capped height) and the per-agent
// Instructions drawer (`fill` — stretches to the bottom).
export default function Playbook({ path, fill = false }: { path: string; fill?: boolean }) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");

  useEffect(() => {
    let active = true;
    // Reset to the loading state when `path` changes, before re-fetching; a one-shot transition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    fetch(`/api/instructions/file?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => { if (!active) return; setContent(d.content ?? ""); setStatus("idle"); })
      .catch(() => active && setStatus("error"));
    return () => { active = false; };
  }, [path]);

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : "border-t border-zinc-800/80"}>
      <div className={`flex shrink-0 items-center gap-2 px-4 py-2 ${fill ? "border-b border-zinc-800/80" : ""}`}>
        <span className="truncate font-mono text-[12px] text-zinc-600">{path}</span>
        <span className="ml-auto shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-400" title="Instructions are edited in the repo, not the UI">
          read-only
        </span>
      </div>
      {status === "loading" ? (
        <div className={`flex items-center gap-2 px-4 py-6 text-[13px] text-zinc-500 ${fill ? "flex-1" : ""}`}>
          <Loader2 size={13} className="animate-spin" /> loading…
        </div>
      ) : status === "error" ? (
        <div className={`px-4 py-6 text-[13px] text-rose-300 ${fill ? "flex-1" : ""}`}>Couldn’t load this file.</div>
      ) : (
        <article className={`prose-instructions overflow-auto px-4 py-3 ${fill ? "min-h-0 flex-1" : "max-h-[28rem]"}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
