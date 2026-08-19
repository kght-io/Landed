import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { promptVersions } from "./schema";
import type { PromptVersionRow } from "./schema";
import { getProfile } from "./profile";
import type { PromptFeature } from "@landed/shared/db/enums";
import { logEvent } from "./events";
import { SEED_FIT_BODY, SEED_TAILOR_BODY } from "./seed-prompts";

// The versioned judgment prompts — the half of the fit / tailoring prompt you own. The other half
// (which MCP tool to call, the result schema, where files land) lives in the repo playbooks and is
// deliberately not editable: a prompt experiment should change how the agent JUDGES, never how the
// workflow runs. See db/schema.ts `promptVersions` for the storage invariants.
//
// The agent never learns that versions exist. `activeGuidance` is spliced into `getContext` under
// the same `fitGuidance` / `tailorGuidance` keys the playbooks already name, so the wire shape is
// unchanged — and the agent can't reason about which version it's on, which is exactly the
// confound the callback measurement is trying to avoid.

// The ship-with defaults live in ./seed-prompts (the leaf boot calls); re-exported here so callers
// have one import for everything prompt-shaped. They seed v1 of each feature on first boot and are
// the floor `activeGuidance` falls back to, so the agent is never handed an empty judgment block.
export { SEED_FIT_BODY, SEED_TAILOR_BODY } from "./seed-prompts";

const SEED_BODY: Record<PromptFeature, string> = { fit: SEED_FIT_BODY, tailoring: SEED_TAILOR_BODY };

// The picker's list: newest first, archived hidden. `includeArchived` is for resolving a version
// a stored result points at — those must stay readable forever.
export function listPromptVersions(feature?: PromptFeature, opts?: { includeArchived?: boolean }): PromptVersionRow[] {
  const where = [
    ...(feature ? [eq(promptVersions.feature, feature)] : []),
    ...(opts?.includeArchived ? [] : [eq(promptVersions.archived, false)]),
  ];
  return db
    .select()
    .from(promptVersions)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(promptVersions.version))
    .all();
}

export function getPromptVersion(id: number): PromptVersionRow | null {
  return db.select().from(promptVersions).where(eq(promptVersions.id, id)).get() ?? null;
}

// The version a run started right now would use. Null before the first version exists.
export function getActivePrompt(feature: PromptFeature): PromptVersionRow | null {
  return (
    db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.feature, feature), eq(promptVersions.active, true)))
      .get() ?? null
  );
}

// What the agent actually reads (via getContext). Falls back to the seed body rather than "" —
// an empty judgment block would silently hand the whole call to the model's own defaults.
export function activeGuidance(feature: PromptFeature): string {
  return getActivePrompt(feature)?.body?.trim() || SEED_BODY[feature];
}

// Append a version. Versions are immutable once written — editing a prompt means minting the next
// one, so a stamped result always resolves to the exact text that produced it. Saving does NOT
// switch the run: a new version only goes live when it's the feature's first, or when you activate
// it explicitly.
export function createPromptVersion(feature: PromptFeature, body: string, label?: string | null): PromptVersionRow {
  return db.transaction((tx) => {
    const max = tx
      .select({ v: sql<number | null>`max(${promptVersions.version})` })
      .from(promptVersions)
      .where(eq(promptVersions.feature, feature))
      .get();
    const version = (max?.v ?? 0) + 1;
    const hasActive = !!tx
      .select({ id: promptVersions.id })
      .from(promptVersions)
      .where(and(eq(promptVersions.feature, feature), eq(promptVersions.active, true)))
      .get();
    const row = tx
      .insert(promptVersions)
      .values({
        feature,
        version,
        body,
        label: label?.trim() || null,
        active: !hasActive, // the first version of a feature takes the empty active slot
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    logEvent({ entity: "prompt", action: "create", source: "ui", actor: "You", summary: `${feature} prompt v${version} saved` });
    return row;
  });
}

// Switch which version future runs read. Deactivate-then-activate inside one transaction: the
// partial unique index rejects two active rows, so the order matters and the pair must be atomic.
export function setActivePromptVersion(id: number): PromptVersionRow | null {
  return db.transaction((tx) => {
    const row = tx.select().from(promptVersions).where(eq(promptVersions.id, id)).get();
    if (!row) return null;
    tx.update(promptVersions)
      .set({ active: false })
      .where(and(eq(promptVersions.feature, row.feature), eq(promptVersions.active, true)))
      .run();
    const next = tx.update(promptVersions).set({ active: true, archived: false }).where(eq(promptVersions.id, id)).returning().get();
    logEvent({ entity: "prompt", action: "update", source: "ui", actor: "You", summary: `${row.feature} prompt v${row.version} is now active` });
    return next;
  });
}

// Hide a version from the picker. Never a delete — postings point at these rows and a result has to
// outlive the prompt that produced it. Refusing to archive the active one keeps a run from starting
// against a version you've decided is retired.
export function archivePromptVersion(id: number): PromptVersionRow | null {
  const row = getPromptVersion(id);
  if (!row) return null;
  if (row.active) throw new Error("cannot archive the active version — activate another one first");
  return db.update(promptVersions).set({ archived: true }).where(eq(promptVersions.id, id)).returning().get() ?? null;
}

// The profile the AGENT sees: the stored profile with the two judgment blocks spliced in from the
// active versions. The keys and their meaning are unchanged from when they lived on the profile
// blob, so /api/context, the MCP tool schema, and both playbooks stay exactly as they are.
export function agentProfile() {
  return { ...getProfile(), fitGuidance: activeGuidance("fit"), tailorGuidance: activeGuidance("tailoring") };
}
