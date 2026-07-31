import type Database from "better-sqlite3";

// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so the bootstrap in ./index.ts reads
// `PRAGMA table_info` and then adds what's missing. That's check-then-act, and the two steps aren't
// atomic ACROSS PROCESSES — every process shares one DB file.
//
// It bites during `next build`, which collects page data in parallel workers. Each worker imports
// db/index.ts, each runs the bootstrap, and on a FRESH database they all read table_info before any
// of them writes. The first ALTER wins; the rest die with `duplicate column name`, failing the build.
//
// Losing that race is a success, not an error: the column exists, which is all the caller wanted.
// Swallow exactly that one condition and let everything else through — a typo'd DDL or a missing
// table still has to be loud.
export function addColumn(sqlite: Database.Database, ddl: string): void {
  try {
    sqlite.exec(ddl);
  } catch (err) {
    if (!isDuplicateColumn(err)) throw err;
  }
}

// better-sqlite3 surfaces this as a generic SQLITE_ERROR, so the message is the only discriminator.
const isDuplicateColumn = (err: unknown): boolean =>
  err instanceof Error && /duplicate column name/i.test(err.message);
