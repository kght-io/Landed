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
import AgentsLive from "@/components/AgentsLive";
import Files from "./Files";
import { useState } from "react";

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

function App() {
  const [view, setView] = useState<"agent" | "files">("agent");
  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-200">
      <header className="flex items-center gap-3 px-4 pt-3 pb-2 [-webkit-app-region:drag]">
        <h1 className="text-[13px] font-semibold">Landed</h1>
        <nav className="flex gap-1 [-webkit-app-region:no-drag]">
          {(["agent", "files"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-2.5 py-1 text-[12px] capitalize transition ${
                view === v ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {v}
            </button>
          ))}
        </nav>
        <span className="flex-1" />
        <button
          onClick={() => void window.landed.openInBrowser()}
          className="rounded-lg bg-zinc-800 px-3 py-1 text-[12px] text-zinc-200 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700 [-webkit-app-region:no-drag]"
        >
          Open Landed in browser →
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {view === "agent" ? <AgentsLive /> : <Files />}
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
