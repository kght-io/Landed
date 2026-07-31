"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Send, Loader2, User } from "lucide-react";

// An interactive chat with a headless Claude Code agent (runs on your subscription, has the jobhunt
// MCP server + asset-folder access). Just talk to it — "tailor the résumé for posting 123", "drain
// the fit queue", "what's in my inbox?" — and it acts. Multi-turn via a resumed session id.
type Msg = { role: "user" | "assistant"; text: string; error?: boolean };

const MSGS_KEY = "landed.claudechat.msgs";
const SID_KEY = "landed.claudechat.sid";

export default function ClaudeChat() {
  // History + session persist across reloads (lazy init from localStorage; write-back effect below).
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try { const a = JSON.parse(localStorage.getItem(MSGS_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sid, setSid] = useState<string | null>(() => (typeof window === "undefined" ? null : localStorage.getItem(SID_KEY)));
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy]);
  useEffect(() => {
    try { localStorage.setItem(MSGS_KEY, JSON.stringify(msgs.slice(-200))); } catch { /* quota — skip */ }
  }, [msgs]);
  useEffect(() => { if (sid) localStorage.setItem(SID_KEY, sid); }, [sid]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    pendo.track("agent_chat_message_sent", {
      message_length: text.length,
      is_first_message: msgs.length === 0,
      chat_context: "main",
      session_active: !!sid,
    });
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: sid }),
      });
      const d = await r.json();
      if (d.sessionId) setSid(d.sessionId);
      setMsgs((m) => [...m, { role: "assistant", text: d.reply || d.error || "(no reply)", error: !!d.error || !!d.isError }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "Couldn't reach Claude Code.", error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/30">
      <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30"><Bot size={12} className="text-sky-300" /></span>
        <h2 className="text-[13px] font-semibold text-zinc-100">Claude Code</h2>
        <span className="rounded bg-sky-500/20 px-1.5 text-[10px] font-medium text-sky-200">chat</span>
        <span className="ml-auto text-[11px] text-zinc-500">{sid ? "session live" : "new session"}</span>
      </div>

      <div ref={scrollRef} className="max-h-96 space-y-3 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && (
          <p className="py-6 text-center text-[12px] text-zinc-500">
            💬 Talk to Claude Code — it has your queue + résumé tools. Try “what’s in my fit inbox?” or “drain the fit queue.”
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex items-start gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ${m.role === "user" ? "bg-zinc-700 ring-zinc-600" : "bg-sky-500/15 ring-sky-500/30"}`}>
              {m.role === "user" ? <User size={12} className="text-zinc-300" /> : <Bot size={12} className="text-sky-300" />}
            </span>
            <div className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[12px] leading-relaxed ${
              m.role === "user" ? "rounded-br-md bg-sky-600 text-white" : m.error ? "rounded-bl-md bg-rose-500/20 text-rose-100" : "rounded-bl-md bg-zinc-800 text-zinc-100"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30"><Bot size={12} className="text-sky-300" /></span>
            <Loader2 size={13} className="animate-spin" /> thinking…
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-zinc-800/60 px-3 py-2.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder="Message Claude Code…  (Enter to send, Shift+Enter for newline)"
          className="max-h-32 flex-1 resize-none rounded-xl bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none ring-1 ring-inset ring-zinc-800 placeholder:text-zinc-600 focus:ring-sky-500/40"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white transition enabled:hover:bg-sky-500 disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </section>
  );
}
