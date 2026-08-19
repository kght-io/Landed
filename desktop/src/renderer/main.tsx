// The renderer, built from the WEB APP'S OWN COMPONENTS.
//
// AgentsLive and everything under it are imported from frontend/ rather than reimplemented, so the
// agent view here is the agent view there — not a lookalike that drifts. Two seams make that work,
// and both are build-time aliases (see desktop/build.mjs):
//
//   @/components/AgentChatsProvider → ./providers/AgentChatsProvider
//       The only genuinely different piece. The web one tails an SSE stream; this one reads the
//       transcript main has been folding. Same contract, so the component cannot tell.
//
//   @/*  →  frontend/*     @landed/shared/*  →  shared/src/*
//       Everything else — the queue provider, AgentQueue, Playbook, jobMeta — is unchanged.
//
// The fetch shim below is what lets those unchanged pieces work: they call relative "/api/..."
// paths, and this window is a file:// origin.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AgentChatsProvider from "./providers/AgentChatsProvider";
import AgentQueueProvider from "@/components/AgentQueueProvider";
import AgentsView from "@/components/AgentsView";
import Files from "./Files";
import Setup from "./Setup";
import { AUTO_WORK_KEY } from "@/components/AutoWorkController";
import { useEffect, useState } from "react";

// Relative /api calls go through main, which has no CORS to satisfy and already holds the Access
// token. Installed before anything renders so no component can race it.
const nativeFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith("/api/")) return nativeFetch(input as RequestInfo, init);
  const res = await window.landed.apiFetch(url, {
    method: init?.method,
    body: typeof init?.body === "string" ? init.body : undefined,
  });
  return new Response(res.body, {
    status: res.status || 502,
    headers: { "content-type": "application/json" },
  });
}) as typeof window.fetch;

/**
 * Make the ported page's Auto-work toggle mean something here.
 *
 * On the web it says "let the browser start agents on its own". On this machine it has to mean
 * something stronger — "let this app run agents at all" — because this process is the one that works
 * while nobody is watching. The toggle itself is the web component's, storing a boolean in
 * localStorage; this bridges that to the supervisor so flipping it actually stops the drain.
 *
 * Seeded from the supervisor rather than from localStorage, so a pause set before a restart shows
 * as paused instead of the switch and the behaviour disagreeing.
 */
function useAutoWorkBridge() {
  useEffect(() => {
    const read = () => {
      try {
        return localStorage.getItem(AUTO_WORK_KEY) !== "false";
      } catch {
        return true;
      }
    };

    void window.landed.drainEnabled().then((on) => {
      try {
        localStorage.setItem(AUTO_WORK_KEY, JSON.stringify(on));
      } catch {
        /* quota — the toggle just shows its default */
      }
      // usePersistentState reads through a cache keyed on the raw string, so it needs telling.
      window.dispatchEvent(new CustomEvent("landed:persistent-state", { detail: AUTO_WORK_KEY }));
    });

    const onChange = (e: Event) => {
      if (e instanceof StorageEvent ? e.key !== AUTO_WORK_KEY : (e as CustomEvent).detail !== AUTO_WORK_KEY) return;
      void window.landed.setDrainEnabled(read());
    };
    window.addEventListener("landed:persistent-state", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("landed:persistent-state", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
}

function App() {
  const [view, setView] = useState<"agents" | "files">("agents");
  // Null until the first check answers, so the agents view never flashes before we know whether it
  // can do anything. Once ready it stays ready — re-gating mid-session on a blip would be worse
  // than letting a transcript report the failure.
  const [ready, setReady] = useState<boolean | null>(null);
  useAutoWorkBridge();

  useEffect(() => {
    void window.landed.preflight().then((s) => setReady(s.ready));
  }, []);
  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-200">
      {/* The window is titleBarStyle: "hiddenInset", so macOS draws its traffic lights OVER the top
          left of the content. This strip is the room they need — draggable, since removing the title
          bar also removed the only place to grab the window. */}
      <div className="flex h-9 shrink-0 items-center gap-1 pr-3 pl-20 [-webkit-app-region:drag]">
        {(["agents", "files"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-2.5 py-1 text-[12px] capitalize transition [-webkit-app-region:no-drag] ${
              view === v ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            {v}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={() => void window.landed.openInBrowser()}
          className="rounded-md px-2.5 py-1 text-[12px] text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200 [-webkit-app-region:no-drag]"
        >
          Open in browser →
        </button>
      </div>

      {/* AgentsView unchanged from the web app — its own header, its Chat / Monitor / MCP tabs, its
          own scrolling. Files is the one view with no counterpart there. */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {ready === null ? null : !ready ? (
          <Setup onReady={() => setReady(true)} />
        ) : view === "agents" ? (
          <AgentsView />
        ) : (
          <div className="h-full px-6 py-5">
            <Files />
          </div>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AgentQueueProvider>
      <AgentChatsProvider>
        <App />
      </AgentChatsProvider>
    </AgentQueueProvider>
  </StrictMode>,
);
