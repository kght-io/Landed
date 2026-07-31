"use client";

import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";

// Compact reference to the asset folder the app + agent share — just the resolved paths plus an
// "Open in Finder" convenience. (The full in-app browser was removed as out of place in Settings.)
export default function AssetFolderInfo() {
  const [paths, setPaths] = useState<{ assetRoot: string; instructionsRoot: string } | null>(null);

  useEffect(() => {
    fetch("/api/config/paths").then((r) => r.json()).then(setPaths).catch(() => {});
  }, []);

  const open = () => fetch("/api/config/paths", { method: "POST" }).catch(() => {});

  return (
    <div className="space-y-3">
      <dl className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-[12px]">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-zinc-500">Asset root</dt>
          <dd className="min-w-0 break-all font-mono text-zinc-300">{paths?.assetRoot ?? "…"}</dd>
        </div>
        <div className="mt-1 flex gap-2">
          <dt className="w-24 shrink-0 text-zinc-500">Instructions</dt>
          <dd className="min-w-0 break-all font-mono text-zinc-300">{paths?.instructionsRoot ?? "…"}</dd>
        </div>
      </dl>
      <div className="flex items-center gap-3">
        <button
          onClick={open}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700"
        >
          <FolderOpen size={13} /> Open in Finder
        </button>
        <span className="text-[12px] text-zinc-500">Relocating the folder is an <span className="font-mono">.env</span> change + restart.</span>
      </div>
    </div>
  );
}
