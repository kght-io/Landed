// Turn a raw field diff into something a human reads at a glance. One shared formatter for both
// surfaces on the Changes page: the approval cards (what an inbox sync WANTS to change) and the
// event feed (what already changed). Pure — no DB, no DOM — so the phrasing is directly testable.
//
// The raw form is deliberately terse (`status applied→interview`, `appliedDate ∅→2026-06-25`) because
// it's what the audit log stores; nothing outside this file should render it to a person.

import { STATUS_LABEL } from "./pipeline";
import type { Status } from "./types";

// One field-level change: the column, its previous value, its proposed/new value. Either side may be
// absent — a blank `old` means the field was empty, a blank `new` means it's being cleared.
export type FieldDiff = { field: string; old?: string; new?: string };

export type DescribedChange = {
  label: string; // "Stage", "Applied date", …
  from: string | null; // humanized previous value, null when there wasn't one
  to: string | null; // humanized new value, null when it's being cleared
  text: string; // the whole thing as one sentence
};

const FIELD_LABEL: Record<string, string> = {
  status: "Stage",
  state: "Stage",
  role: "Role",
  title: "Role",
  level: "Level",
  team: "Team",
  location: "Location",
  channel: "Applied via",
  source: "Source",
  url: "Link",
  note: "Note",
  appliedDate: "Applied date",
  updatedAt: "Last update",
  interviewed: "Interviewed",
  interviews: "Interview rounds",
};

// Fall back to a readable label for a column nobody has named yet: `fitScore` → "Fit score".
function labelFor(field: string): string {
  if (FIELD_LABEL[field]) return FIELD_LABEL[field];
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

// Stage values are stored as enum keys (`interview`); people read the pipeline's own names
// ("Interviewing"). Every other value passes through as-is.
function valueFor(field: string, v: string | undefined): string | null {
  const s = v == null || v === "" || v === "∅" ? null : v;
  if (s == null) return null;
  if (field === "status" || field === "state") return STATUS_LABEL[s as Status] ?? s;
  return s;
}

export function describeChange(d: FieldDiff): DescribedChange {
  const label = labelFor(d.field);
  const from = valueFor(d.field, d.old);
  const to = valueFor(d.field, d.new);

  // Fields whose diff reads better as a statement than as an arrow.
  if (d.field === "interviews" && to) return { label, from, to, text: `Adds ${to.replace(/^(\d+) rounds?$/, (_, n) => `${n} interview round${n === "1" ? "" : "s"}`)}` };
  if (d.field === "interviewed") return { label, from, to, text: to === "yes" ? "Marked as interviewed" : "No longer marked as interviewed" };

  if (from && to) return { label, from, to, text: `${label}: ${from} → ${to}` };
  if (to) return { label, from: null, to, text: `${label}: set to ${to}` };
  if (from) return { label, from, to: null, text: `${label}: cleared (was ${from})` };
  return { label, from: null, to: null, text: label };
}

export const describeChanges = (diffs: FieldDiff[]): DescribedChange[] => diffs.map(describeChange);
