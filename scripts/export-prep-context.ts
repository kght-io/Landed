// Export per-company interview-prep context for CoWork chats.
//
//   npm run prep:export
//
// Writes <ASSET_ROOT>/interview-prep/<slug>/context.md for every company in the interview/offer
// stage, plus a README index. The generation lives in lib/prep/export-context.ts (shared with the
// in-app per-company "Dump context" button). Idempotent — re-run any time to refresh.
import { exportAllPrepContext, PREP_ROOT } from "@landed/backend/prep/export-context";

const done = exportAllPrepContext();
if (!done.length) {
  console.log("No companies in the interview/offer stage — nothing to export.");
} else {
  for (const d of done) console.log(`✓ ${d.company} → interview-prep/${d.slug}/context.md`);
  console.log(`\nWrote ${done.length} company folder(s) + README to ${PREP_ROOT}`);
}
