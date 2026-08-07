import { db } from "./index";
import { events } from "./schema";

// The change log's single writer. A LEAF of the db layer on purpose: queries.ts is the top of that
// layer, so anything queries.ts imports (cooldown.ts, stage-change.ts) can't reach back up to it for
// an audit row. Extracting the writer here is the same move stage-change.ts made — every table
// that records "who changed what" appends through one function, so the events schema has one writer.

export type LogArgs = {
  actor?: string; // default You (UI is the human)
  source?: string; // default ui
  entity?: string;
  entityId?: number;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  summary: string;
};

export function logEvent(a: LogArgs) {
  db.insert(events)
    .values({
      ts: new Date().toISOString(),
      actor: a.actor ?? "You",
      source: a.source ?? "ui",
      entity: a.entity ?? "application",
      entityId: a.entityId,
      action: a.action,
      field: a.field,
      oldValue: a.oldValue,
      newValue: a.newValue,
      summary: a.summary,
    })
    .run();
}

// Actor/source overlay for a logEvent spread. An undefined actor → {} so logEvent keeps its
// app-UI defaults (You / "ui"); a named actor (e.g. "CoWork" for an MCP-driven edit) tags both
// the actor and a matching source so a bot edit isn't mislabeled as a manual "ui" change. The
// caller passes the actor it read from the request (see actorFromRequest in the API routes).
export const by = (actor?: string): { actor?: string; source?: string } =>
  actor ? { actor, source: "cowork" } : {};
