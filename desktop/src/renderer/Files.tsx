// The chosen folder, as a browser. The one view with no web-app counterpart — the browser cannot
// see the user's disk, which is the whole reason this app exists.

import { useCallback, useEffect, useState } from "react";
import { FileText, Folder, FolderOpen } from "lucide-react";
import { fmtBytes } from "@landed/shared/format/bytes";

type Entry = { name: string; dir: boolean; bytes: number | null };

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

export default function Files() {
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [root, setRoot] = useState("");

  // Read first, then commit both pieces of state together. Setting cwd up front would repaint the
  // breadcrumb against the previous folder's contents for a frame — and it puts a synchronous
  // setState inside the mount effect below, which is the thing the hooks rule is right to flag.
  const go = useCallback(async (rel: string) => {
    const listing = await window.landed.list(rel);
    setCwd(rel);
    setEntries(listing);
  }, []);

  // Reading the folder over IPC on mount is the rule's own allowed shape — subscribe to an external
  // system, set state when it answers — but the analysis cannot see through `go`'s await to know the
  // setState lands in a callback rather than in the effect body. Scoped off with the reason, the
  // same way frontend/components/AutoWorkController.tsx handles it.
  useEffect(() => {
    void window.landed.root().then(setRoot);
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void go("");
  }, [go]);

  const parts = cwd ? cwd.split("/") : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 pb-2 text-[12px] text-zinc-500">
        <button onClick={() => void go("")} className="rounded px-1.5 py-0.5 transition hover:bg-zinc-900 hover:text-zinc-200">
          Home
        </button>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-zinc-700">/</span>
            <button
              onClick={() => void go(parts.slice(0, i + 1).join("/"))}
              className="rounded px-1.5 py-0.5 transition hover:bg-zinc-900 hover:text-zinc-200"
            >
              {p}
            </button>
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        {entries.length === 0 ? (
          <p className="p-6 text-center text-[12px] text-zinc-600">
            {cwd ? "This folder is empty." : "Nothing here yet — the agent writes résumés and prep material into this folder."}
          </p>
        ) : (
          <ul>
            {entries.map((e) => (
              <li
                key={e.name}
                onClick={() => (e.dir ? void go(join(cwd, e.name)) : void window.landed.open(join(cwd, e.name)))}
                className="group flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] transition hover:bg-zinc-900/60"
              >
                {e.dir ? (
                  <Folder size={14} className="shrink-0 text-zinc-500" />
                ) : (
                  <FileText size={14} className="shrink-0 text-zinc-600" />
                )}
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-zinc-600">
                  {e.bytes == null ? "" : fmtBytes(e.bytes)}
                </span>
                <button
                  onClick={(ev) => {
                    ev.stopPropagation(); // revealing is not opening
                    void window.landed.reveal(join(cwd, e.name));
                  }}
                  className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-200"
                  title="Show in Finder"
                >
                  <FolderOpen size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 text-[11.5px] text-zinc-600">
        <span className="truncate font-mono">{root}</span>
        <span className="flex-1" />
        <button onClick={() => void window.landed.reveal("")} className="rounded px-1.5 py-0.5 transition hover:bg-zinc-900 hover:text-zinc-300">
          Reveal
        </button>
      </div>
    </div>
  );
}
