"use client";

import { useEffect, useState } from "react";
import { Mail, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Status = { connected: boolean; user: string | null; source: "env" | "config" | null };

// Connect-Gmail card: stores a Gmail app password so the app can read mail over IMAP, which is what
// powers inbox-sync for EVERY client (the agent + the headless Claude Code runner) via the jobhunt
// searchGmail/getGmailThread MCP tools. Read-only access; the password lives in the local DB.
export default function GmailConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    fetch("/api/gmail").then((r) => r.json()).then(setStatus).catch(() => setStatus({ connected: false, user: null, source: null }));
  useEffect(() => { refresh(); }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/gmail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: user.trim(), appPassword: pass }),
    }).then((x) => x.json()).catch(() => ({ error: "request failed" }));
    setBusy(false);
    if (r.ok) { pendo.track("gmail_connected", { success: true }); setPass(""); setUser(""); refresh(); }
    else setError(r.error || "couldn't connect — check the address and app password");
  };

  const disconnect = async () => {
    setBusy(true);
    await fetch("/api/gmail", { method: "DELETE" }).catch(() => {});
    pendo.track("gmail_disconnected");
    setBusy(false);
    refresh();
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/30">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300"><Mail size={15} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Gmail</p>
          <p className="truncate text-[13px] text-zinc-500">
            Read-only inbox access for inbox-sync — used by every agent over MCP.
          </p>
        </div>
        {status?.connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
            <CheckCircle2 size={13} /> Connected
          </span>
        ) : (
          <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-[12px] font-medium text-zinc-400">Not connected</span>
        )}
      </div>

      <div className="border-t border-zinc-800/80 px-4 py-3">
        {status === null ? (
          <div className="flex items-center gap-2 text-[13px] text-zinc-500"><Loader2 size={14} className="animate-spin" /> checking…</div>
        ) : status.connected ? (
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[13px] text-zinc-400">
              {status.user}
              {status.source === "env" && <span className="ml-2 text-[12px] text-zinc-600">(set via environment)</span>}
            </p>
            {status.source !== "env" && (
              <button
                onClick={disconnect}
                disabled={busy}
                className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700 disabled:opacity-40"
              >
                Disconnect
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[12px] leading-relaxed text-zinc-500">
              Paste a Gmail <span className="text-zinc-300">app password</span> (needs 2-Step Verification on). Create one at{" "}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-violet-200">
                myaccount.google.com/apppasswords
              </a>. Stored locally; read-only.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="you@gmail.com"
                className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-600 focus:ring-zinc-500"
              />
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && user.trim() && pass) connect(); }}
                placeholder="app password"
                className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-600 focus:ring-zinc-500"
              />
              <button
                onClick={connect}
                disabled={busy || !user.trim() || !pass}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-[13px] font-medium text-violet-50 transition enabled:hover:bg-violet-400 disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Connect
              </button>
            </div>
            {error && (
              <p className="flex items-center gap-1.5 text-[12px] text-rose-300"><AlertCircle size={13} /> {error}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
