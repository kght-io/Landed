// A posting id → its company's interview-prep folder key. The same key the exporter, the brief, and
// the pull jobs use, so every route that reaches into `interview-prep/<slug>/` agrees on the folder.
// Null when the id is bad, the posting is gone, or the company doesn't canonicalize.
import { getPosting } from "../db/queries";
import { canonical } from "@landed/shared/agents/canonical";

export function postingPrepSlug(id: string | number): string | null {
  const appId = Number(id);
  if (!Number.isInteger(appId)) return null;
  const p = getPosting(appId);
  return p ? (canonical(p.company)?.key ?? null) : null;
}
