// Coercion for the `emails` array on an interview-emails result — the structured per-email records
// the agent submits instead of writing a prose emails.md blob. Agent JSON arrives as `unknown`, so
// everything here is forgiving: an email we can only half-read still carries its body, which is the
// part that matters for retrieval. Pure (no DB, no fs) so it lives in shared and is directly testable.
import { str, num, strList } from "../util/coerce";
import type { PrepEmail } from "../types";

// The body is the only required field — an entry with nothing to read is dropped rather than stored
// as an empty row. Field aliases mirror what a model plausibly emits (`text`/`sender`/`sentAt`).
export function incomingEmails(raw: unknown): PrepEmail[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((e): PrepEmail => {
      const o = (e ?? {}) as Record<string, unknown>;
      const round = num(o.round);
      return {
        threadId: str(o.threadId) ?? str(o.thread) ?? str(o.gmailThreadId),
        messageId: str(o.messageId) ?? str(o.id) ?? str(o.gmailMessageId),
        subject: str(o.subject) ?? str(o.title),
        from: str(o.from) ?? str(o.sender),
        to: strList(o.to ?? o.recipients),
        date: str(o.date) ?? str(o.sentAt) ?? str(o.receivedAt),
        round: round != null && round > 0 ? round : undefined,
        attachments: strList(o.attachments ?? o.files),
        body: str(o.body) ?? str(o.text) ?? str(o.content) ?? "",
      };
    })
    .filter((e) => e.body.trim().length > 0);
  return out.length ? out : undefined;
}

// The per-company dedup key, so re-running a capture over the same threads is a no-op. Prefer the
// Gmail message id; fall back to the thread + date + subject triple; and when the agent supplied
// none of those, fingerprint the body so two DIFFERENT bodies still get two rows.
export function prepEmailKey(e: PrepEmail): string {
  if (e.messageId) return `msg:${e.messageId}`;
  const parts = [e.threadId ?? "", e.date ?? "", e.subject ?? ""];
  if (parts.some(Boolean)) return `hdr:${parts.join("|")}`;
  return `body:${fingerprint(e.body)}`;
}

// djb2 over the body — a short, stable, dependency-free content key. Not a security hash; it only
// has to separate distinct emails within one company's capture.
function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
