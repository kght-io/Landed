// The prep chat's conversation, kept OUTSIDE React.
//
// The component that renders a chat does not survive the user: switching the drawer's Interview tabs
// unmounts it, so does closing the drawer or moving to the chat's own page. When the turn ran in the
// component, an in-flight fetch resolved into a dead component — the reply was dropped and the new
// session id never reached localStorage, so the next message opened a fresh Claude session with none
// of the conversation in it. That reads exactly like "the session died".
//
// So a turn belongs to the COMPANY, not to a mounted component: this module owns the state, persists
// every mutation immediately, and finishes turns whether or not anyone is watching. Views subscribe
// (useSyncExternalStore) and render whatever the store says.
//
// `deps` is injected so this is testable without a browser — and so the module stays free of any
// direct window/node access, which is what lets it live in `shared`.

export type ChatMsg = { role: "user" | "assistant" | "note"; text: string; error?: boolean };
export type ChatState = { msgs: ChatMsg[]; sid: string | null; busy: boolean };

export type ChatStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
export type TurnRequest = { message: string; sessionId: string | null; context: string; slug: string };
export type TurnResponse = { sessionId?: string; reply?: string; error?: string; isError?: boolean; recovered?: boolean };

type Deps = { storage: ChatStorage | null; post: (body: TurnRequest) => Promise<TurnResponse> };

const browserStorage = (): ChatStorage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // storage disabled (private mode, blocked cookies) — the chat still works, it just forgets
  }
};

let deps: Deps = {
  get storage() { return browserStorage(); },
  post: async (body) => {
    const r = await fetch("/api/agents/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as TurnResponse;
  },
};

// Test seam. Not for production code — the defaults above are the real wiring.
export function __setChatDeps(next: Partial<Deps>): void {
  deps = { ...deps, ...next };
  cache.clear();
  listeners.clear();
}

const MSGS_KEY = (id: string) => `landed.prepchat.${id}.msgs`;
const SID_KEY = (id: string) => `landed.prepchat.${id}.sid`;
const MAX_KEPT = 200; // the tail we persist — enough history to read back, bounded against the quota

export const EMPTY: ChatState = { msgs: [], sid: null, busy: false };

// One cached state object per company, so getSnapshot returns a referentially stable value between
// mutations (useSyncExternalStore re-renders forever otherwise).
const cache = new Map<string, ChatState>();
const listeners = new Map<string, Set<() => void>>();

function read(id: string): ChatState {
  const s = deps.storage;
  if (!s) return EMPTY;
  let msgs: ChatMsg[] = [];
  try {
    const raw = JSON.parse(s.getItem(MSGS_KEY(id)) || "[]");
    if (Array.isArray(raw)) msgs = raw as ChatMsg[];
  } catch { /* corrupt entry — start clean rather than throw at render time */ }
  return { msgs, sid: s.getItem(SID_KEY(id)), busy: false };
}

function emit(id: string): void {
  for (const fn of listeners.get(id) ?? []) fn();
}

// Every mutation goes through here: memory and storage move together, then subscribers are told.
function update(id: string, patch: Partial<ChatState>): ChatState {
  const next = { ...chatState(id), ...patch };
  cache.set(id, next);
  const s = deps.storage;
  if (s) {
    try {
      if (patch.msgs) s.setItem(MSGS_KEY(id), JSON.stringify(next.msgs.slice(-MAX_KEPT)));
      if (patch.sid) s.setItem(SID_KEY(id), next.sid!);
    } catch { /* quota — the in-memory conversation is still correct for this session */ }
  }
  emit(id);
  return next;
}

export function chatState(id: string): ChatState {
  let s = cache.get(id);
  if (!s) cache.set(id, (s = read(id)));
  return s;
}

export function subscribeChat(id: string, fn: () => void): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); };
}

// Drop a conversation AND its session: a cleared chat that kept its session id would resume the very
// history the user just cleared.
export function resetChat(id: string): void {
  cache.set(id, EMPTY);
  const s = deps.storage;
  if (s) {
    try { s.removeItem(MSGS_KEY(id)); s.removeItem(SID_KEY(id)); } catch { /* ignore */ }
  }
  emit(id);
}

// One turn. The user's message is committed before the request goes out, so it survives even if the
// tab, the drawer or the browser closes mid-flight; the reply and session id are committed on the way
// back regardless of whether a component is still mounted to see them.
export async function sendTurn(id: string, opts: { message: string; context: string; slug: string }): Promise<void> {
  const before = chatState(id);
  if (before.busy) return; // one turn at a time per company — the CLI resumes a session serially
  update(id, { msgs: [...before.msgs, { role: "user", text: opts.message }], busy: true });

  try {
    const d = await deps.post({ message: opts.message, sessionId: before.sid, context: opts.context, slug: opts.slug });
    const text = d.reply || d.error || "(no reply)";
    const note: ChatMsg[] = d.recovered
      ? [{ role: "note", text: "↻ The previous session had expired — refreshed it automatically. Your history above is kept here." }]
      : [];
    update(id, {
      msgs: [...chatState(id).msgs, ...note, { role: "assistant", text, error: !!d.error || !!d.isError }],
      ...(d.sessionId ? { sid: d.sessionId } : {}),
      busy: false,
    });
  } catch {
    update(id, {
      msgs: [...chatState(id).msgs, { role: "assistant", text: "Couldn't reach Claude Code.", error: true }],
      busy: false,
    });
  }
}
