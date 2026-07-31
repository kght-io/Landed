"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Send, Loader2, User, Trash2, PanelRightClose, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// A full-height chat with the locked-down interview-prep agent for one company (runs on your
// subscription; read-only file access to that company's prep folder, no other tools). Designed to
// fill a docked side panel. Keyed by `storageId` so each company's chat persists separately; `slug`
// scopes the server turn to the company folder; `context` is the system prompt appended on the first
// turn. The header lists the folder's research .md files so you can see what the coach is reading.
// `note` = a system line (e.g. "session refreshed") rendered muted + centered, not a chat bubble.
type Msg = { role: "user" | "assistant" | "note"; text: string; error?: boolean };
type CtxFile = { name: string; size: number; mtime: string };

export default function PrepChat({
  storageId,
  slug,
  context,
  placeholder = "Ask Claude Code…  (Enter to send, Shift+Enter for newline)",
  intro,
  onCollapse,
}: {
  storageId: string; // stable per company — keys the persisted history + session
  slug: string; // company folder the server scopes this chat to (interview-prep/<slug>)
  context: string; // appended to the system prompt on the first turn (scope + how to use the files)
  placeholder?: string;
  intro?: string; // empty-state hint
  onCollapse?: () => void; // show a collapse control in the header
}) {
  const MSGS_KEY = `landed.prepchat.${storageId}.msgs`;
  const SID_KEY = `landed.prepchat.${storageId}.sid`;

  const [msgs, setMsgs] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try { const a = JSON.parse(localStorage.getItem(MSGS_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sid, setSid] = useState<string | null>(() => (typeof window === "undefined" ? null : localStorage.getItem(SID_KEY)));
  const [ctxFiles, setCtxFiles] = useState<CtxFile[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy]);
  // The research files the coach reads from this company's folder — shown so the context is visible,
  // like an agent project's file list. Refetched after each turn (a turn can dump/refresh them).
  useEffect(() => {
    let alive = true;
    fetch(`/api/prep/company/${slug}/files`)
      .then((r) => r.json())
      .then((d) => { if (alive && Array.isArray(d.files)) setCtxFiles(d.files); })
      .catch(() => { /* non-critical — just hides the list */ });
    return () => { alive = false; };
  }, [slug, busy]);
  useEffect(() => {
    try { localStorage.setItem(MSGS_KEY, JSON.stringify(msgs.slice(-200))); } catch { /* quota — skip */ }
  }, [msgs, MSGS_KEY]);
  useEffect(() => { if (sid) localStorage.setItem(SID_KEY, sid); }, [sid, SID_KEY]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    pendo.track("prep_chat_message_sent", {
      company_slug: storageId,
      message_length: text.length,
      is_first_message: msgs.length === 0,
      session_active: !!sid,
    });
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    const conversationId = sid || storageId;
    window.pendo?.trackAgent("prompt", {
      agentId: "rSt-ZD_8KrkEU2tFKqlaoIpAhAw",
      conversationId,
      messageId: crypto.randomUUID(),
      content: text,
    });
    try {
      const r = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Always send scope + slug: `context` seeds the first turn AND any background recovery (if the
        // session died, the server re-seeds a fresh one); `slug` keeps the turn locked to this
        // company's prep folder (read-only, no other tools).
        body: JSON.stringify({ message: text, sessionId: sid, context, slug }),
      });
      const d = await r.json();
      if (d.sessionId) setSid(d.sessionId);
      const replyText = d.reply || d.error || "(no reply)";
      window.pendo?.trackAgent("agent_response", {
        agentId: "rSt-ZD_8KrkEU2tFKqlaoIpAhAw",
        conversationId,
        messageId: crypto.randomUUID(),
        content: replyText,
      });
      setMsgs((m) => [
        ...m,
        ...(d.recovered ? [{ role: "note" as const, text: "↻ The previous session had expired — refreshed it automatically. Your history above is kept here." }] : []),
        { role: "assistant" as const, text: replyText, error: !!d.error || !!d.isError },
      ]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "Couldn't reach Claude Code.", error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setMsgs([]);
    setSid(null);
    try { localStorage.removeItem(MSGS_KEY); localStorage.removeItem(SID_KEY); } catch { /* ignore */ }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950/40">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 px-4 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30"><Bot size={12} className="text-sky-300" /></span>
        <h3 className="text-[13px] font-semibold text-zinc-100">Claude Code</h3>
        <span className="ml-auto text-[11px] text-zinc-500">{sid ? "session live" : "new session"}</span>
        {msgs.length > 0 && (
          <button onClick={reset} title="Clear this chat" className="rounded p-1 text-zinc-600 transition hover:bg-zinc-800 hover:text-rose-300">
            <Trash2 size={12} />
          </button>
        )}
        {onCollapse && (
          <button onClick={onCollapse} title="Collapse chat" className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200">
            <PanelRightClose size={14} />
          </button>
        )}
      </div>

      {/* Context files — the research .md outputs the coach reads from this company's folder. Shown
          so it's transparent what the assistant is working from, like an agent project's file list. */}
      {ctxFiles.length > 0 && (
        <div className="shrink-0 border-b border-zinc-800/60 bg-zinc-950/60 px-4 py-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Context · reading from this folder</p>
          <ul className="flex flex-wrap gap-1.5">
            {ctxFiles.map((f) => (
              <li
                key={f.name}
                title={`${(f.size / 1024).toFixed(1)} KB · updated ${new Date(f.mtime).toLocaleString()}`}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800/60 px-1.5 py-0.5 text-[11px] text-zinc-300 ring-1 ring-zinc-700/60"
              >
                <FileText size={10} className="text-sky-300/80" />
                {f.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && (
          <p className="py-6 text-center text-[12px] leading-relaxed text-zinc-500">{intro ?? "Your interview-prep coach for this company — it reads this company's research files and helps you prep."}</p>
        )}
        {msgs.map((m, i) => {
          if (m.role === "note")
            return <p key={i} className="px-2 py-1 text-center text-[11px] leading-relaxed text-zinc-600">{m.text}</p>;

          // User turns stay a compact right-aligned bubble (plain text — you typed it).
          if (m.role === "user")
            return (
              <div key={i} className="flex flex-row-reverse items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-700 ring-1 ring-zinc-600">
                  <User size={12} className="text-zinc-300" />
                </span>
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-sky-600 px-3 py-1.5 text-[13px] leading-relaxed text-white">
                  {m.text}
                </div>
              </div>
            );

          // Assistant turns render as full-width markdown prose (headings, lists, code, tables), the
          // way a Claude/the agent reply reads — not a cramped bubble. Errors stay plain text.
          return (
            <div key={i} className="flex items-start gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30">
                <Bot size={12} className="text-sky-300" />
              </span>
              {m.error ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-rose-500/20 px-3 py-1.5 text-[13px] leading-relaxed text-rose-100">
                  {m.text}
                </div>
              ) : (
                <div className="prose-instructions min-w-0 flex-1 pt-0.5">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
                  >
                    {m.text}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30"><Bot size={12} className="text-sky-300" /></span>
            <Loader2 size={13} className="animate-spin" /> thinking…
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-end gap-2 border-t border-zinc-800/60 px-3 py-2.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={placeholder}
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
    </div>
  );
}
