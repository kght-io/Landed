"use client";

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bot, Send, Loader2, User, Trash2, PanelRightClose, FileText, Maximize2, Paperclip, Image as ImageIcon, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatState, sendTurn, resetChat, subscribeChat, EMPTY, type ChatMsg, type ChatAttachment } from "@landed/shared/prep/chat-store";
import { UPLOAD_ACCEPT, isImageAttachment } from "@landed/shared/prep/attachments";

// A full-height chat with the locked-down interview-prep agent for one company (runs on your
// subscription; read-only file access to that company's prep folder, no other tools). Designed to
// fill a docked side panel. Keyed by `storageId` so each company's chat persists separately; `slug`
// scopes the server turn to the company folder; `context` is the system prompt appended on the first
// turn. The header lists the folder's research .md files so you can see what the coach is reading.
// `note` = a system line (e.g. "session refreshed") rendered muted + centered, not a chat bubble.
type CtxFile = { name: string; size: number; mtime: string };

// The picker offers exactly what the server accepts — one list, in shared. The server still
// validates; this is only the nicer front door.
const ACCEPT = UPLOAD_ACCEPT.join(",");

// One attachment, as a chip. The same chip in both places it appears — staged in the composer (where
// it can still be dropped, hence `onRemove`) and settled in the turn above it — so a file doesn't
// change appearance the moment you send it.
function FileChip({ file, onRemove }: { file: ChatAttachment; onRemove?: () => void }) {
  const Icon = isImageAttachment(file.name) ? ImageIcon : FileText;
  return (
    <span className={`flex max-w-full items-center gap-1 rounded-lg bg-zinc-800 py-1 text-[12px] text-zinc-300 ring-1 ring-inset ring-zinc-700 ${onRemove ? "pl-2 pr-1" : "px-2"}`}>
      <Icon size={11} className="shrink-0 text-sky-300" />
      <span className="truncate">{file.name}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          title="Don't send this one"
          className="shrink-0 rounded p-0.5 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-200"
        ><X size={11} /></button>
      )}
    </span>
  );
}

// One rendered turn, memoized — and the memo is load-bearing, not a micro-optimization. The composer
// textarea's state lives in PrepChat, so WITHOUT this every keystroke re-rendered the whole
// transcript, and react-markdown re-parses its source on every render (it caches nothing). That cost
// ~1.1ms per assistant turn per character: fine on an empty chat, ~60ms/keystroke at 50 turns —
// several dropped frames per letter, getting worse the longer you talk.
//
// The bail-out is exact because the store hands back a referentially stable snapshot (see
// shared/src/prep/chat-store.ts), so `m` is the same object between turns. It also pays off while a
// turn streams, when the store DOES change on every tick but the settled turns above it don't.
const Message = memo(function Message({ m }: { m: ChatMsg }) {
  if (m.role === "note")
    return <p className="px-2 py-1 text-center text-[11px] leading-relaxed text-zinc-600">{m.text}</p>;

  // User turns stay a compact right-aligned bubble (plain text — you typed it).
  if (m.role === "user")
    return (
      <div className="flex flex-row-reverse items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-700 ring-1 ring-zinc-600">
          <User size={12} className="text-zinc-300" />
        </span>
        <div className="flex max-w-[85%] flex-col items-end gap-1">
          {/* Only render the bubble when something was typed — a turn can be attachments alone. */}
          {m.text.trim() && (
            <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-sky-600 px-3 py-1.5 text-[13px] leading-relaxed text-white">
              {m.text}
            </div>
          )}
          {m.attachments?.map((f) => <FileChip key={f.relPath} file={f} />)}
        </div>
      </div>
    );

  // Assistant turns render as full-width markdown prose (headings, lists, code, tables), the
  // way a Claude/the agent reply reads — not a cramped bubble. Errors stay plain text.
  return (
    <div className="flex items-start gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30">
        <Bot size={12} className="text-sky-300" />
      </span>
      {m.error ? (
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-rose-500/20 px-3 py-1.5 text-[13px] leading-relaxed text-rose-100">
          {m.text}
        </div>
      ) : (
        <div className="prose-instructions min-w-0 flex-1 pt-0.5">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{m.text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
});

// Hoisted out of the render: an inline `components={{...}}` object is a new identity every time,
// which would make react-markdown redo its work even behind the memo.
const MD_COMPONENTS = { a: (props: React.ComponentPropsWithoutRef<"a">) => <a {...props} target="_blank" rel="noopener noreferrer" /> };

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
  // Files staged for the NEXT turn. They're uploaded the moment you pick them (so the chip can show
  // a real saved name and a failure surfaces immediately, not on send), then named in the turn.
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const attach = useCallback(async (files: FileList | File[] | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      for (const f of list) form.append("file", f);
      const r = await fetch(`/api/prep/company/${slug}/uploads`, { method: "POST", body: form });
      const d = await r.json();
      if (Array.isArray(d.uploads)) setPending((p) => [...p, ...d.uploads]);
      // A partial success still lands its good files — say what didn't make it rather than
      // silently dropping it.
      if (d.error || d.errors?.length)
        setUploadError(d.errors?.length ? d.errors.map((e: { name: string; error: string }) => `${e.name}: ${e.error}`).join("; ") : String(d.error));
    } catch {
      setUploadError("Couldn't attach that file.");
    } finally {
      setUploading(false);
    }
  }, [slug]);

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
    // Attachments alone are a valid turn — dragging in a screenshot and hitting send is a normal
    // way to ask "what do you make of this?".
    if ((!text && !pending.length) || busy || uploading) return;
    pendo.track("prep_chat_message_sent", {
      company_slug: storageId,
      message_length: text.length,
      is_first_message: msgs.length === 0,
      session_active: !!sid,
      attachment_count: pending.length,
    });
    window.pendo?.trackAgent("prompt", {
      agentId: "rSt-ZD_8KrkEU2tFKqlaoIpAhAw",
      conversationId: sid || storageId,
      messageId: crypto.randomUUID(),
      content: text,
    });
    const attachments = pending;
    setInput("");
    setPending([]);
    setUploadError(null);
    // Deliberately not awaited: the turn belongs to the store and completes on its own, so this
    // component unmounting (a tab switch) can't cancel it.
    void sendTurn(storageId, { message: text, context, slug, attachments });
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
        {msgs.map((m, i) => <Message key={i} m={m} />)}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30"><Bot size={12} className="text-sky-300" /></span>
            <Loader2 size={13} className="animate-spin" /> thinking…
          </div>
        )}
        </div>
      </div>

      {/* Drop anywhere on the composer, not just on a target the size of a button. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void attach(e.dataTransfer.files); }}
        className={`shrink-0 border-t transition ${dragging ? "border-sky-500/60 bg-sky-500/5" : "border-zinc-800/60"} ${fullscreen ? `${rowPad} py-5` : "px-3 py-2.5"}`}
      >
      {/* Staged files, shown before you send so you can drop one you picked by mistake. They're
          already on disk at this point — removing a chip just un-names it for this turn. */}
      {(pending.length > 0 || uploadError) && (
        <div className={`mb-2 flex flex-wrap items-center gap-1.5 ${col}`}>
          {pending.map((f) => (
            <FileChip
              key={f.relPath}
              file={f}
              onRemove={() => setPending((p) => p.filter((x) => x.relPath !== f.relPath))}
            />
          ))}
          {uploadError && <span className="text-[12px] text-rose-300">{uploadError}</span>}
        </div>
      )}
      <div className={`flex items-end gap-2 ${col}`}>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => { void attach(e.target.files); e.target.value = ""; /* re-picking the same file must re-fire */ }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || busy}
          title="Attach a photo, PDF or text file for the coach to read"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-400 ring-1 ring-inset ring-zinc-800 transition enabled:hover:text-zinc-100 enabled:hover:ring-zinc-700 disabled:opacity-40"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          // Pasting a screenshot straight from the clipboard is the fastest path here, and the one
          // people reach for first.
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) { e.preventDefault(); void attach(files); }
          }}
          rows={1}
          placeholder={placeholder}
          className="max-h-32 flex-1 resize-none rounded-xl bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none ring-1 ring-inset ring-zinc-800 placeholder:text-zinc-600 focus:ring-sky-500/40"
        />
        <button
          onClick={send}
          disabled={busy || uploading || (!input.trim() && !pending.length)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white transition enabled:hover:bg-sky-500 disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
      </div>
    </div>
  );
}
