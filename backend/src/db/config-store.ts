import { eq } from "drizzle-orm";
import { db } from "./index";
import { appConfig } from "./schema";

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
