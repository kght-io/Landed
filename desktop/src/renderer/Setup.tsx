// The first thing anyone who is not the author will see.
//
// Everything this app does depends on four things being true, and on the machine it was built on
// all four already were. Elsewhere at least one will not be — and until now that surfaced as a red
// line inside an agent transcript, on a tab they had no reason to open, phrased for whoever wrote
// the code.
//
// So: one screen, the blockers in the order they should be fixed, each saying what is wrong and
// what to do. It gates the app rather than warning alongside it, because a supervisor that cannot
// spawn an agent has nothing to show anyway.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import type { Summary } from "../preflight";

export default function Setup({ onReady }: { onReady: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    const s = await window.landed.preflight();
    setSummary(s);
    setChecking(false);
    if (s.ready) onReady();
  }, [onReady]);

  useEffect(() => {
    // Reading an external system on mount is the rule's own allowed shape; it cannot see through
    // `check`'s await to know the setState lands in a callback. Same handling as Files.tsx.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void check();
  }, [check]);

  const pickFolder = async () => {
    const picked = await window.landed.chooseRoot();
    if (picked) void check();
  };

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-5 px-8">
      <div>
        <h1 className="text-[17px] font-semibold">Before Landed can work</h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          This app runs the agent on your own machine, on your own Claude subscription. A couple of
          things need to be in place first.
        </p>
      </div>

      <div className="space-y-2">
        {summary.blocking.map((p) => (
          <div key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0 text-amber-400" />
              <p className="text-[13px] font-medium">{p.title}</p>
              {p.detail && <code className="ml-auto truncate text-[11.5px] text-zinc-600">{p.detail}</code>}
            </div>
            <p className="mt-1.5 pl-[22px] text-[12.5px] leading-relaxed text-zinc-400">{p.fix}</p>
            {p.id === "folder" && (
              <div className="mt-2 pl-[22px]">
                <button
                  onClick={pickFolder}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700"
                >
                  <FolderOpen size={13} /> Choose folder
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Warnings sit below the blockers and never gate: LibreOffice only affects the PDF half of
            tailoring, and stopping fit or inbox-sync over it would be absurd. */}
        {summary.warnings.map((p) => (
          <div key={p.id} className="rounded-xl border border-zinc-800/60 p-3.5">
            <p className="text-[13px] text-zinc-400">{p.title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{p.fix}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void check()}
          disabled={checking}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[12.5px] ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700 disabled:opacity-50"
        >
          {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check again
        </button>
        {summary.blocking.length === 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-400">
            <Check size={13} /> Ready
          </span>
        )}
      </div>
    </div>
  );
}
