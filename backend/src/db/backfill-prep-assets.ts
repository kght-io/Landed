// One-time import of the interview-prep knowledge that predates the DB tables: every
// `interview-prep/<slug>/transcripts/*.md` and `interview-prep/<slug>/emails.md` on disk becomes a
// prep_transcripts / prep_emails row. Run version-gated from ./index.ts (the migration path).
//
// Takes the RAW better-sqlite3 handle rather than the Drizzle `db`: this is called from inside
// ./index.ts's connection() while `db` is still being constructed, so importing it would be a cycle.
//
// Two things this deliberately does NOT do:
//   - It never deletes or rewrites what it read. The files stay; from here on they're regenerated
//     dumps of these rows (see prep/export-context.ts), so a bad import can't lose anything.
//   - It does NOT try to split a legacy `emails.md` into per-email rows. Those blobs are curated
//     PROSE the agent wrote — a per-round narrative, not a message dump — so there are no senders,
//     dates, or thread ids in there to recover. Splitting on headings would invent metadata that
//     was never captured. One row per file, tagged source='backfill', keeps the knowledge honest;
//     going forward the interview-emails job submits real per-email records.
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export type BackfillCounts = {
  transcripts: number; // rows inserted (an already-imported file counts 0)
  emails: number;
  // Files we couldn't read. The asset root is typically cloud-synced and can hand back EDEADLK, so
  // a boot may legitimately see less than the whole tree; the caller retries next boot on a
  // non-zero count rather than recording a partial import as finished.
  errors: number;
  // Whether the prep tree was there to read at all. Zero rows with `scanned: true` means "nothing
  // on disk to import" (done); zero rows with `scanned: false` means "no folder yet" (try again) —
  // the distinction that keeps a fresh clone, or a boot before ASSET_ROOT is configured, from
  // marking the import complete and stranding the files it never saw.
  scanned: boolean;
};

const readIfFile = (file: string): string | null => {
  const body = fs.readFileSync(file, "utf8");
  return body.trim() ? body : null;
};

// The first markdown H1 ("# Pendo — Interview Emails") — the closest thing a legacy blob has to a
// subject line. Falls back to null so the reader shows the company instead of an invented title.
const firstHeading = (body: string): string | null =>
  /^#\s+(.+?)\s*$/m.exec(body)?.[1] ?? null;

// Split a transcript's LEADING H1 off into the title. saveTranscript stores the title separately and
// the dump re-prepends it as an H1, so leaving it in the body too would render the heading twice and
// make the exported file differ from the one we imported. Only a heading on the very first line is
// taken — an H1 further down is part of the transcript's own text, and lifting THAT into the title
// would both mislabel the transcript and duplicate the heading on the next export.
function splitTitle(body: string): { title: string | null; body: string } {
  const m = /^#[ \t]+(.+?)[ \t]*(?:\r?\n)/.exec(body);
  if (!m) return { title: null, body };
  return { title: m[1], body: body.slice(m[0].length).replace(/^\r?\n/, "") };
}

export function backfillPrepAssets(sqlite: Database.Database, prepRoot: string): BackfillCounts {
  const counts: BackfillCounts = { transcripts: 0, emails: 0, errors: 0, scanned: false };
  let slugs: fs.Dirent[];
  try {
    slugs = fs.readdirSync(prepRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
    counts.scanned = true;
  } catch {
    return counts; // no readable interview-prep tree — nothing imported, and the caller will retry
  }

  // INSERT OR IGNORE against the (slug, name) / (slug, dedup_key) unique indexes: re-running imports
  // nothing twice, which is what lets a failed boot simply try again.
  const addTranscript = sqlite.prepare(
    `INSERT OR IGNORE INTO prep_transcripts (slug, name, title, body, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const addEmail = sqlite.prepare(
    `INSERT OR IGNORE INTO prep_emails (slug, dedup_key, subject, body, source, captured_at)
     VALUES (?, ?, ?, ?, 'backfill', ?)`,
  );

  for (const d of slugs) {
    const slug = d.name;
    const dir = path.join(prepRoot, slug);

    // transcripts/*.md — every markdown file, whatever it's called. The GLOBAL folder's are prefixed
    // (`acme_hiring-manager-round_transcript-1.md`), so matching transcript-N.md would drop them.
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(dir, "transcripts")).filter((f) => f.toLowerCase().endsWith(".md")).sort();
    } catch { /* no transcripts folder for this company */ }
    for (const name of names) {
      const file = path.join(dir, "transcripts", name);
      try {
        const raw = readIfFile(file);
        if (!raw) continue;
        const t = splitTitle(raw);
        // mtime is the only timestamp these files carry — it IS when the transcript was pasted.
        const at = fs.statSync(file).mtime.toISOString();
        counts.transcripts += addTranscript.run(slug, name, t.title, t.body, at).changes;
      } catch {
        counts.errors++;
      }
    }

    // emails.md — the whole prose blob as ONE row (see the note at the top of this file).
    const emailsFile = path.join(dir, "emails.md");
    try {
      if (fs.existsSync(emailsFile)) {
        const body = readIfFile(emailsFile);
        if (body) {
          const at = fs.statSync(emailsFile).mtime.toISOString();
          counts.emails += addEmail.run(slug, "legacy:emails.md", firstHeading(body), body, at).changes;
        }
      }
    } catch {
      counts.errors++;
    }
  }
  return counts;
}
