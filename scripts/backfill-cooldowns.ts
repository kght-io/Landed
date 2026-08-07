// One-time backfill: apply the company cooldown to rejections that predate the feature.
//
// The live rule only fires when a rejection LANDS (see backend/src/db/cooldown.ts), so companies
// that already rejected you after a real interview loop would otherwise keep showing up until they
// happen to reject you again. This walks every company once and stores what the rule says.
//
//   npx tsx scripts/backfill-cooldowns.ts          # show what would change
//   npx tsx scripts/backfill-cooldowns.ts --apply  # write it
//
// Safe to re-run: the rule only ever extends a date, and a cooldown you've cleared by hand will
// come back if you re-run this — that's the one thing to know before using --apply twice.
import { db } from "../backend/src/db";
import { companies } from "../backend/src/db/schema";
import { backfillCompanyCooldown } from "../backend/src/db/cooldown";
import { listPostings } from "../backend/src/db/queries";
import { groupByCompany } from "../shared/src/pipeline/board";
import { companyCooldown } from "../shared/src/pipeline/cooldown";

const apply = process.argv.includes("--apply");
// One decision per company, computed once and read three times below — the rule is the same one
// backfillCompanyCooldown re-derives from the DB when it writes.
const decisions = new Map(groupByCompany(listPostings()).map((g) => [g.company, companyCooldown(g.items)]));

let cooled = 0;
for (const co of db.select().from(companies).all()) {
  const decision = decisions.get(co.name);
  if (!decision?.cool) continue;
  cooled++;
  console.log(`${apply ? "cooling" : "would cool"} ${co.name.padEnd(24)} until ${decision.until}  (rejected ${decision.from})`);
  if (apply) backfillCompanyCooldown(co.id);
}

// Companies with a rejection on record that did NOT earn a cooldown — worth naming, since "nothing
// happened" is otherwise indistinguishable from "the script didn't see it".
for (const [name, d] of decisions) {
  if (!d.cool && d.reason !== "no-qualifying-rejection") console.log(`skipping ${name.padEnd(24)} — ${d.reason}`);
}

console.log(`\n${cooled} compan${cooled === 1 ? "y" : "ies"} ${apply ? "cooled" : "would be cooled"}.${apply ? "" : "  Re-run with --apply to write."}`);
