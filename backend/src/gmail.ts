import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { simpleParser } from "mailparser";
import { getConfig, setConfig, deleteConfig } from "./db/config-store";

// App-owned Gmail access over IMAP, authed with a Gmail **app password** (no Google Cloud OAuth).
// This is what makes inbox-sync client-agnostic: the jobhunt MCP server exposes searchGmail /
// getGmailThread backed by this, so the headless Claude Code runner (strict MCP config) can read
// mail over the app's own IMAP connection — no external Gmail connector needed. Read-only — we never
// write/label/delete.
//
// Gmail's IMAP exposes its full search syntax via X-GM-RAW (imapflow `{ gmraw }`) and stable thread
// ids via X-GM-THRID (`{ threadId }` / message.threadId) — so the playbook's `after:` /
// `-category:promotions` / `filename:invite.ics` queries work unchanged, and the thread id we return
// is the same one Gmail's web inbox opens at `#all/<id>`.

const HOST = "imap.gmail.com";
const PORT = 993;
const SNIPPET_LEN = 300;

// Credentials: env wins (GMAIL_USER / GMAIL_APP_PASSWORD), else the app_config values set via the
// Connect-Gmail settings form. App passwords are 16 chars, often pasted with spaces — strip them.
export function gmailCredentials(): { user: string; pass: string } | null {
  const user = process.env.GMAIL_USER || getConfig("gmail_user") || "";
  const raw = process.env.GMAIL_APP_PASSWORD || getConfig("gmail_app_password") || "";
  const pass = raw.replace(/\s+/g, "");
  return user && pass ? { user, pass } : null;
}

export function gmailConfigured(): boolean {
  return gmailCredentials() !== null;
}

// Persist credentials from the settings form (used by /api/gmail/connect after a successful test).
export function saveGmailCredentials(user: string, appPassword: string) {
  setConfig("gmail_user", user.trim());
  setConfig("gmail_app_password", appPassword.replace(/\s+/g, ""));
}

export function clearGmailCredentials() {
  deleteConfig("gmail_user");
  deleteConfig("gmail_app_password");
}

function clientOpts(creds: { user: string; pass: string }): ImapFlowOptions {
  return {
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
    logger: false, // imapflow is chatty; we don't want its pino stream in the app logs
  };
}

// Run `fn` against a freshly-connected client and always tear it down. A short-lived connection per
// request is simplest and fine at our call rate (no long-lived socket to babysit in Next.js).
async function withClient<T>(fn: (client: ImapFlow, allMail: string) => Promise<T>): Promise<T> {
  const creds = gmailCredentials();
  if (!creds) throw new Error("Gmail not configured — set an app password in Settings.");
  const client = new ImapFlow(clientOpts(creds));
  await client.connect();
  try {
    const allMail = await allMailPath(client);
    const lock = await client.getMailboxLock(allMail);
    try {
      return await fn(client, allMail);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// Gmail's "All Mail" folder — the one to search so archived/sent threads are covered. Prefer the
// \All special-use flag (locale-proof), fall back to the canonical English name, then INBOX.
async function allMailPath(client: ImapFlow): Promise<string> {
  try {
    const boxes = await client.list();
    const all = boxes.find((b) => b.specialUse === "\\All");
    if (all) return all.path;
    if (boxes.some((b) => b.path === "[Gmail]/All Mail")) return "[Gmail]/All Mail";
  } catch {
    // list() can fail on odd servers — fall through to a sensible default
  }
  return "INBOX";
}

export type GmailThreadSummary = {
  threadId: string;
  subject: string;
  from: string;
  date: string | null; // ISO
  snippet: string;
  labels: string[];
  messages: number; // message count in the thread (within the searched mailbox)
};

export type GmailMessage = { from: string; to: string; date: string | null; subject: string; text: string };
export type GmailThread = { threadId: string; subject: string; messages: GmailMessage[] };

const addr = (a: unknown): string => {
  // imapflow envelope address: { name, address }[]
  if (!Array.isArray(a)) return "";
  return a.map((x: { name?: string; address?: string }) => x.name || x.address || "").filter(Boolean).join(", ");
};

// Validate credentials by connecting + opening All Mail. Returns the resolved user on success.
export async function testGmailConnection(creds?: { user: string; pass: string }): Promise<{ ok: boolean; user?: string; error?: string }> {
  const c = creds ?? gmailCredentials();
  if (!c) return { ok: false, error: "no credentials" };
  const client = new ImapFlow(clientOpts(c));
  try {
    await client.connect();
    await allMailPath(client);
    return { ok: true, user: c.user };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// Search Gmail with the same query syntax as the web inbox (via X-GM-RAW), grouped into threads
// newest-first. `limit` caps the number of THREADS returned (snippets are fetched only for those).
export async function searchThreads(query: string, limit = 50): Promise<GmailThreadSummary[]> {
  const cap = Math.min(Math.max(limit, 1), 100);
  return withClient(async (client) => {
    const uids = (await client.search({ gmraw: query }, { uid: true })) || [];
    if (!uids.length) return [];
    // Newest first; over-fetch a little so grouping still yields ~cap distinct threads.
    const newest = uids.sort((a, b) => b - a).slice(0, cap * 3);

    // One pass for envelope + thread id + labels (cheap, no bodies).
    type Row = { uid: number; threadId: string; subject: string; from: string; date: string | null; labels: string[] };
    const rows: Row[] = [];
    for await (const m of client.fetch(newest, { uid: true, envelope: true, threadId: true, labels: true }, { uid: true })) {
      rows.push({
        uid: m.uid,
        threadId: String(m.threadId ?? m.uid),
        subject: m.envelope?.subject || "(no subject)",
        from: addr(m.envelope?.from),
        date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null,
        labels: m.labels ? [...m.labels] : [],
      });
    }

    // Group by thread, keep the latest message per thread, cap to `limit` threads.
    const byThread = new Map<string, { latest: Row; count: number }>();
    for (const r of rows) {
      const g = byThread.get(r.threadId);
      if (!g) byThread.set(r.threadId, { latest: r, count: 1 });
      else {
        g.count++;
        if ((r.date ?? "") > (g.latest.date ?? "")) g.latest = r;
      }
    }
    const groups = [...byThread.values()]
      .sort((a, b) => (b.latest.date ?? "").localeCompare(a.latest.date ?? ""))
      .slice(0, cap);

    // Fetch a short snippet for each kept thread's latest message only (bounded token cost).
    const out: GmailThreadSummary[] = [];
    for (const g of groups) {
      out.push({
        threadId: g.latest.threadId,
        subject: g.latest.subject,
        from: g.latest.from,
        date: g.latest.date,
        snippet: await snippetFor(client, g.latest.uid),
        labels: g.latest.labels,
        messages: g.count,
      });
    }
    return out;
  });
}

// First ~300 chars of a message's plain-text body, whitespace-collapsed. Best-effort.
async function snippetFor(client: ImapFlow, uid: number): Promise<string> {
  try {
    const dl = await client.download(uid, undefined, { uid: true });
    if (!dl?.content) return "";
    const parsed = await simpleParser(dl.content);
    const text = (parsed.text || parsed.subject || "").replace(/\s+/g, " ").trim();
    return text.slice(0, SNIPPET_LEN);
  } catch {
    return "";
  }
}

// Full thread by its X-GM-THRID (the id searchThreads returns), oldest message first.
export async function getThread(threadId: string): Promise<GmailThread | null> {
  return withClient(async (client) => {
    const uids = (await client.search({ threadId }, { uid: true })) || [];
    if (!uids.length) return null;
    const messages: GmailMessage[] = [];
    for (const uid of uids.sort((a, b) => a - b)) {
      const dl = await client.download(uid, undefined, { uid: true });
      if (!dl?.content) continue;
      const p = await simpleParser(dl.content);
      messages.push({
        from: p.from?.text || "",
        to: Array.isArray(p.to) ? p.to.map((t) => t.text).join(", ") : p.to?.text || "",
        // (p.to can be one AddressObject or an array of them)
        date: p.date ? p.date.toISOString() : null,
        subject: p.subject || "",
        text: (p.text || "").trim(),
      });
    }
    return { threadId, subject: messages[0]?.subject || "(no subject)", messages };
  });
}

// Every file attachment across a thread's messages. simpleParser already parses the full MIME tree
// (getThread just discards `p.attachments`); here we keep them. Inline/embedded parts (a cid, i.e.
// signature images) are skipped — only real attachments (a filename, not related-inline). The
// caller writes these to disk (see backend/src/prep/attachments.ts). Returns [] when the thread has none.
export type GmailAttachment = { filename: string; contentType: string; content: Buffer };
export async function getThreadAttachments(threadId: string): Promise<GmailAttachment[]> {
  return withClient(async (client) => {
    const uids = (await client.search({ threadId }, { uid: true })) || [];
    if (!uids.length) return [];
    const out: GmailAttachment[] = [];
    for (const uid of uids.sort((a, b) => a - b)) {
      const dl = await client.download(uid, undefined, { uid: true });
      if (!dl?.content) continue;
      const p = await simpleParser(dl.content);
      for (const a of p.attachments ?? []) {
        // Skip inline/related parts (embedded images referenced by cid) — keep real attachments.
        if (a.related || a.contentDisposition === "inline") continue;
        if (!a.content) continue;
        out.push({ filename: a.filename || "attachment", contentType: a.contentType || "application/octet-stream", content: a.content });
      }
    }
    return out;
  });
}
