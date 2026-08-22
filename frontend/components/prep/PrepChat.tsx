"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bot, Send, Loader2, User, Trash2, PanelRightClose, FileText, Maximize2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatState, sendTurn, resetChat, subscribeChat, EMPTY } from "@landed/shared/prep/chat-store";

// A full-height chat with the locked-down interview-prep agent for one company (runs on your
// subscription; read-only file access to that company's prep folder, no other tools). Designed to
// fill a docked side panel. Keyed by `storageId` so each company's chat persists separately; `slug`
// scopes the server turn to the company folder; `context` is the system prompt appended on the first
// turn. The header lists the folder's research .md files so you can see what the coach is reading.
// `note` = a system line (e.g. "session refreshed") rendered muted + centered, not a chat bubble.
type CtxFile = { name: string; size: number; mtime: string };

export default function PrepChat({
  storageId,
  slug,
  context,
  placeholder = "Ask Claude Code…  (Enter to send, Shift+Enter for newline)",
  intro,
  onCollapse,
  fullscreen,
  openUrl,
  heading,
  subheading,
}: {
  storageId: string; // stable per company — keys the persisted history + session
  slug: string; // company folder the server scopes this chat to (interview-prep/<slug>)
  context: string; // appended to the system prompt on the first turn (scope + how to use the files)
  placeholder?: string;
  intro?: string; // empty-state hint
  onCollapse?: () => void; // show a collapse control in the header
  fullscreen?: boolean; // fill-the-window layout (the standalone page) vs the docked pane
  openUrl?: string; // show an "open in its own tab" control pointing at this chat's page
  heading?: string; // the company — the headline full screen, where the drawer isn't there to say it
  subheading?: string; // the role under it
}) {
  // The conversation lives in the store, not here: this component is unmounted every time the drawer
  // switches tabs, and a turn must outlive that (see @landed/shared/prep/chat-store). EMPTY is the
  // server/hydration snapshot — the browser's stored history can't be known server-side, so it lands
  // on the commit after hydration instead of mismatching the HTML.
  const subscribe = useCallback((cb: () => void) => subscribeChat(storageId, cb), [storageId]);
  const { msgs, sid, busy } = useSyncExternalStore(subscribe, () => chatState(storageId), () => EMPTY);
  const [input, setInput] = useState("");
  const [ctxFiles, setCtxFiles] = useState<CtxFile[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin to the newest message. `ctxFiles` is a dependency for a layout reason, not a data one: the
  // context-files strip renders above the log a beat after mount (its fetch resolves), growing the
  // content and leaving an open-on-mount scroll short of the end. `fullscreen` resizes the pane, and
  // `msgs` covers a turn that finished while this component was unmounted.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy, ctxFiles, fullscreen]);

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

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    pendo.track("prep_chat_message_sent", {
      company_slug: storageId,
      message_length: text.length,
      is_first_message: msgs.length === 0,
      session_active: !!sid,
    });
    window.pendo?.trackAgent("prompt", {
      agentId: "rSt-ZD_8KrkEU2tFKqlaoIpAhAw",
      conversationId: sid || storageId,
      messageId: crypto.randomUUID(),
      content: text,
    });
    setInput("");
    // Deliberately not awaited: the turn belongs to the store and completes on its own, so this
    // component unmounting (a tab switch) can't cancel it.
    void sendTurn(storageId, { message: text, context, slug });
  };

  const reset = () => resetChat(storageId);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // Full screen isn't the docked pane stretched: the rules that make a 420px column readable (tight
  // padding, edge-to-edge rows) make a 1440px one worse. So the borders still span the window, while
  // the CONTENT of every row sits in one centred column with room to breathe around it.
  const col = fullscreen ? "mx-auto w-full max-w-4xl" : "";
  const rowPad = fullscreen ? "px-8" : "px-4";

  return (
    <div className="flex h-full flex-col bg-zinc-950/40">
      <div className={`shrink-0 border-b border-zinc-800/60 ${rowPad} ${fullscreen ? "py-4" : "py-2.5"}`}>
      <div className={`flex items-center gap-3 ${col}`}>
        <span className={`flex items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30 ${fullscreen ? "h-9 w-9" : "h-6 w-6"}`}>
          <Bot size={fullscreen ? 17 : 12} className="text-sky-300" />
        </span>
        {/* On its own page the COMPANY is the headline — nothing else on screen says who this is for,
            and a tab full of chats is told apart by the name, not by "Claude Code" repeated. */}
        {fullscreen && heading ? (
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-bold tracking-tight text-zinc-100" title={heading}>{heading}</h1>
            <p className="truncate text-[13px] text-zinc-400">
              {subheading ? `${subheading} · ` : ""}interview prep coach
            </p>
          </div>
        ) : (
          <h3 className="shrink-0 text-[13px] font-semibold text-zinc-100">Claude Code</h3>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-zinc-500">{sid ? "session live" : "new session"}</span>
        {msgs.length > 0 && (
          <button onClick={reset} title="Clear this chat" className="rounded p-1 text-zinc-600 transition hover:bg-zinc-800 hover:text-rose-300">
            <Trash2 size={12} />
          </button>
        )}
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this chat in its own tab"
            className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <Maximize2 size={14} />
          </a>
        )}
        {onCollapse && (
          <button onClick={onCollapse} title="Collapse chat" className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200">
            <PanelRightClose size={14} />
          </button>
        )}
      </div>
      </div>

      {/* Context files — the research .md outputs the coach reads from this company's folder. Shown
          so it's transparent what the assistant is working from, like an agent project's file list. */}
      {ctxFiles.length > 0 && (
        <div className={`shrink-0 border-b border-zinc-800/60 bg-zinc-950/60 py-2 ${rowPad}`}>
          <div className={col}>
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
        </div>
      )}

      <div ref={scrollRef} className={`flex-1 overflow-y-auto ${rowPad} ${fullscreen ? "py-8" : "py-3"}`}>
        <div className={`${col} ${fullscreen ? "space-y-6" : "space-y-3"}`}>
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
      </div>

      <div className={`shrink-0 border-t border-zinc-800/60 ${fullscreen ? `${rowPad} py-5` : "px-3 py-2.5"}`}>
      <div className={`flex items-end gap-2 ${col}`}>
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
    </div>
  );
}
