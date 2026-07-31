// Seed prep_questions from the extracted CoWork artifact data. Idempotent: upserts on
// id and NEVER touches prep_attempts / prep_progress, so re-running is safe and preserves
// your practice history. Run: npm run seed:prep
import { db } from "@landed/core/db";
import { prepQuestions } from "@landed/core/db/schema";
import { sql } from "drizzle-orm";
import { PREP_SEED } from "@landed/shared/prep/seed-data";

function main() {
  let inserted = 0;
  let updated = 0;
  for (const q of PREP_SEED) {
    const values = {
      id: q.id,
      track: q.track,
      name: q.name,
      prompt: q.prompt ?? null,
      difficulty: q.difficulty ?? null,
      priority: q.priority ?? null,
      url: q.url ?? null,
      leetcodeNum: q.leetcodeNum ?? null,
      tags: JSON.stringify(q.tags ?? []),
      companies: JSON.stringify(q.companies ?? []),
      content: JSON.stringify(q.content ?? {}),
      plan: q.plan ? JSON.stringify(q.plan) : null,
      sortOrder: q.sortOrder ?? null,
    };
    const existed = db.select({ id: prepQuestions.id }).from(prepQuestions).where(sql`id = ${q.id}`).get();
    db.insert(prepQuestions)
      .values(values)
      .onConflictDoUpdate({ target: prepQuestions.id, set: values })
      .run();
    if (existed) updated++;
    else inserted++;
  }

  const total = db.select({ c: sql<number>`count(*)` }).from(prepQuestions).get();
  console.log(`prep seed done — ${inserted} inserted, ${updated} updated, ${total?.c} total rows`);
}

main();
