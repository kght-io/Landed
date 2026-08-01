import { eq } from "drizzle-orm";
import { db } from "./index";
import { appConfig } from "./schema";

// The inbox-sync watermark: the instant the last inbox-sync result landed in the DB. Written only by
// the inbox-sync job's `afterIngest`; read to build the next run's Gmail search window and to show
// "synced through" in the UI. Lives here — the lowest, dependency-free layer — so both the job
// registry and the queue can name it without importing each other.
export const INBOX_SYNCED_KEY = "inbox_last_synced";

// Persistent key-value store (Gmail refresh token, last-sync cursor, etc.).
export function getConfig(key: string): string | null {
  return db.select().from(appConfig).where(eq(appConfig.key, key)).get()?.value ?? null;
}

export function setConfig(key: string, value: string) {
  db.insert(appConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: appConfig.key, set: { value } })
    .run();
}

export function deleteConfig(key: string) {
  db.delete(appConfig).where(eq(appConfig.key, key)).run();
}
