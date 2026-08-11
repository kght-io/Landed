// Reads + writes for the prep KNOWLEDGE tables — pasted call transcripts and captured interview
// emails. These used to be markdown under <ASSET_ROOT>/interview-prep/<slug>/, which a hosted
// backend can't see; the rows are the record now and those files are regenerated dumps (the pattern
// context.md already follows). Artifacts — résumés, PDF attachments — deliberately stayed on disk.
//
// Everything here is keyed by the canonical company SLUG (db/prep.ts companySlug), the same key as
// prep_company.slug and the interview-prep/<slug>/ folder — not a posting id and not slugFor().
import { and, asc, eq, max } from "drizzle-orm";
import { db } from "./index";
import { jsonArray } from "./queries";
import { prepEmails, prepTranscripts } from "./schema";
import { prepEmailKey } from "@landed/shared/agents/emails";
import type { PrepEmail, PrepTranscript } from "@landed/shared/types";

// ── Transcripts ───────────────────────────────────────────────────────────────────────────────

// Every stored transcript for a company, NEWEST FIRST — the order the drawer's list and the
// context dump both want (the most recent call is the one you're prepping off).
export function listTranscriptRows(slug: string): PrepTranscript[] {
  return db.select().from(prepTranscripts).where(eq(prepTranscripts.slug, slug)).all()
    .map((r): PrepTranscript => ({ name: r.name, title: r.title ?? undefined, body: r.body, at: r.createdAt }))
    .sort((a, b) => b.at.localeCompare(a.at) || b.name.localeCompare(a.name));
}

export function getTranscriptRow(slug: string, name: string): PrepTranscript | null {
  const r = db.select().from(prepTranscripts)
    .where(and(eq(prepTranscripts.slug, slug), eq(prepTranscripts.name, name))).get();
  return r ? { name: r.name, title: r.title ?? undefined, body: r.body, at: r.createdAt } : null;
}

// Store one transcript. `name` is the per-company unique key (and the dump filename), so a repeat
// name overwrites rather than duplicating — the caller mints a fresh one via nextTranscriptName.
export function insertTranscriptRow(slug: string, t: PrepTranscript): PrepTranscript {
  const existing = db.select().from(prepTranscripts)
    .where(and(eq(prepTranscripts.slug, slug), eq(prepTranscripts.name, t.name))).get();
  const vals = { slug, name: t.name, title: t.title ?? null, body: t.body, createdAt: t.at };
  if (existing) db.update(prepTranscripts).set(vals).where(eq(prepTranscripts.id, existing.id)).run();
  else db.insert(prepTranscripts).values(vals).run();
  return t;
}

// ── Emails ────────────────────────────────────────────────────────────────────────────────────

// A company's captured emails, OLDEST FIRST — mail reads as a conversation, so the natural order is
// chronological. Rows with no date (the backfilled prose blobs) sort last, after everything dated.
export function listPrepEmails(slug: string): PrepEmail[] {
  return db.select().from(prepEmails).where(eq(prepEmails.slug, slug)).orderBy(asc(prepEmails.id)).all()
    .map((r): PrepEmail => ({
      threadId: r.threadId ?? undefined,
      messageId: r.messageId ?? undefined,
      subject: r.subject ?? undefined,
      from: r.sender ?? undefined,
      to: jsonArray<string>(r.recipients),
      date: r.sentAt ?? undefined,
      round: r.round ?? undefined,
      attachments: jsonArray<string>(r.attachments),
      body: r.body,
    }))
    .sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || (a.date ?? "").localeCompare(b.date ?? ""));
}

// When this company's mail was last captured (max captured_at), or null if none — what the drawer's
// prep-materials panel used to read off emails.md's mtime.
export function emailsCapturedAt(slug: string): string | null {
  return db.select({ at: max(prepEmails.capturedAt) }).from(prepEmails).where(eq(prepEmails.slug, slug)).get()?.at ?? null;
}

// Merge captured emails into a company's rows, keyed by prepEmailKey — so re-running a capture over
// threads it already read is a no-op, and a thread that has grown since only adds its new messages.
// An existing row is updated only when something actually differs (a re-read that fills in a subject
// the first pass missed lands; an identical re-read doesn't). Returns rows inserted or updated.
// `dryRun` counts what WOULD change without writing, so a summary can be built before committing.
export function upsertPrepEmails(slug: string, emails: PrepEmail[], opts: { dryRun?: boolean } = {}): number {
  if (!emails.length) return 0;
  const existing = new Map(
    db.select().from(prepEmails).where(eq(prepEmails.slug, slug)).all().map((r) => [r.dedupKey, r] as const),
  );
  const now = new Date().toISOString();
  let changed = 0;
  for (const e of emails) {
    const dedupKey = prepEmailKey(e);
    const prior = existing.get(dedupKey);
    const list = (v: string[] | undefined) => (v?.length ? JSON.stringify(v) : null);
    // `e.X ?? prior.X`: a re-capture that read less than the first one keeps what's stored, the same
    // merge contract upsertInterviews uses. The body is required, so it always reflects the last read.
    const vals = {
      slug, dedupKey,
      threadId: e.threadId ?? prior?.threadId ?? null,
      messageId: e.messageId ?? prior?.messageId ?? null,
      subject: e.subject ?? prior?.subject ?? null,
      sender: e.from ?? prior?.sender ?? null,
      recipients: list(e.to) ?? prior?.recipients ?? null,
      sentAt: e.date ?? prior?.sentAt ?? null,
      round: e.round ?? prior?.round ?? null,
      attachments: list(e.attachments) ?? prior?.attachments ?? null,
      body: e.body,
      source: "interview-emails",
    };
    if (prior) {
      const differs = (Object.keys(vals) as (keyof typeof vals)[]).some((k) => prior[k] !== vals[k]);
      if (!differs) continue;
      if (!opts.dryRun) db.update(prepEmails).set(vals).where(eq(prepEmails.id, prior.id)).run();
    } else if (opts.dryRun) {
      // Nothing was written, so remember the shape we WOULD have inserted — otherwise a batch that
      // repeats a key counts it twice and the preview disagrees with the real run.
      existing.set(dedupKey, { id: 0, capturedAt: now, ...vals });
    } else {
      // Keep the map pointing at the row we just wrote, so a batch that repeats one key updates it
      // rather than hitting the unique index — and so the second entry's content isn't lost to an
      // UPDATE against a row id that never existed.
      existing.set(dedupKey, db.insert(prepEmails).values({ ...vals, capturedAt: now }).returning().get());
    }
    changed++;
  }
  return changed;
}
