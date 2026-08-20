"use client";

// The drawer's presentational atoms, shared by the stage panes that were split out of it
// (PrepMaterials, InterviewBriefCard, …). Kept here rather than in CompanyDrawer so a pane can use
// them without importing its own parent — an edge that would be a cycle.

// A small section label.
// Inline-editable text styling, shared by the drawer's EditField and the panes' own inputs.
export const EDIT_BASE =
  "-mx-1 rounded bg-transparent px-1 outline-none transition placeholder:text-zinc-600 hover:bg-zinc-800/50 focus:bg-zinc-900 focus:ring-1 focus:ring-zinc-600";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{children}</p>;
}
