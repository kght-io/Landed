// Seed the DB from the real tracker.csv. Run: npx tsx scripts/import-tracker.ts
// Re-run with FORCE=1 to wipe + reimport.
import fs from "node:fs";
import { db } from "@landed/backend/db";
import { companies, postings } from "@landed/backend/db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { PATHS } from "@landed/backend/config";
import { TRACKER_STAGES } from "@landed/shared/pipeline";
import { norm } from "@landed/shared/agents/canonical";
import { isTarget } from "@landed/shared/targets.mjs";

const tierFor = (name: string) =>
  isTarget(norm(name)) ? "tier2" : "tier3";

function mapStatus(raw: string): { status: "applied" | "rejected"; channel?: "referral"; note?: string } {
  const s = raw.trim().toLowerCase();
  if (s.startsWith("rejected (interview")) return { status: "rejected", note: "reached interview" };
  if (s.startsWith("rejected")) return { status: "rejected" };
  if (s === "referral") return { status: "applied", channel: "referral" };
  return { status: "applied" };
}

function main() {
  // One unified table now: the tracker = postings in a TRACKER stage. Scoped so a re-import
  // never touches the discovery scan rows (the firehose).
  const existing = db.select({ c: sql<number>`count(*)` }).from(postings).where(inArray(postings.state, [...TRACKER_STAGES])).get();
  if (existing && existing.c > 0) {
    if (!process.env.FORCE) {
      console.error(`DB already has ${existing.c} tracked postings. Re-run with FORCE=1 to wipe + reimport.`);
      process.exit(1);
    }
    db.delete(postings).where(inArray(postings.state, [...TRACKER_STAGES])).run();
  }

  const text = fs.readFileSync(PATHS.tracker(), "utf8");
  const rows = text.split(/\r?\n/).filter((l) => l.trim().length).slice(1);

  const companyId = new Map<string, number>();
  let imported = 0;

  for (const line of rows) {
    const [companyRaw, role, status, link, applied, updated] = line.split(",");
    const name = (companyRaw || "").trim();
    if (!name) continue;

    let cid = companyId.get(name.toLowerCase());
    if (!cid) {
      const existingCo = db.select().from(companies).where(eq(companies.name, name)).get();
      cid =
        existingCo?.id ??
        (() => { const ts = new Date().toISOString(); return db.insert(companies).values({ name, tier: tierFor(name), createdAt: ts, updatedAt: ts }).returning({ id: companies.id }).get().id; })();
      companyId.set(name.toLowerCase(), cid);
    }

    const m = mapStatus(status || "applied");
    db.insert(postings).values({
      companyId: cid,
      title: (role || "").trim() || "(untitled)",
      state: m.status,
      verdict: "kept",
      channel: m.channel,
      url: (link || "").trim() || null,
      source: "manual",
      note: m.note,
      historical: true,
      appliedDate: (applied || "").trim() || null,
      updatedAt: (updated || "").trim() || null,
      scannedAt: (applied || "").trim() || new Date().toISOString(),
    }).run();
    imported++;
  }

  const co = db.select({ c: sql<number>`count(*)` }).from(companies).get();
  console.log(`Imported ${imported} tracked postings across ${co?.c} companies.`);
}

main();
