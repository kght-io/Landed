// Backfill: delete non-local roles from the Filtered / Discarded archive piles across every company.
// Going forward the scan purges each company as it runs (see backend/src/jobs/scan.ts purgeNonLocal); this
// clears the backlog accumulated before that rule. Run: npm run purge:nonlocal
import { purgeAllNonLocal } from "@landed/backend/jobs/scan";

const removed = purgeAllNonLocal();
console.log(`Purged ${removed} non-local role${removed === 1 ? "" : "s"} from the Filtered / Discarded piles.`);
