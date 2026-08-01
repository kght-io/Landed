"use client";

import { useCallback, useEffect, useState } from "react";
import type { Posting, Status, Tier } from "@landed/shared/types";
import type { ColumnId } from "@landed/shared/pipeline/stages";
import { TODAY, slug } from "@landed/shared/pipeline/board";

// Which status a pipeline column represents. "closed" collapses several outcomes, so a
// drop there means "company_skipped" (you passed) — set rejected/ghost/expired precisely in the drawer.
const STATUS_FOR: Record<ColumnId, Status> = {
  discovered: "discovered", assessed: "assessed", tailoring: "tailoring",
  applied: "applied", interviewing: "interview", closed: "company_skipped",
};

// Side effects of landing on a stage, shared by the drawer selector + drag-drop.
// Only fills info that's missing, so re-setting a stage never clobbers existing data.
// `opts.appliedDate` is the date the user confirmed in the applied-date prompt — when present it
// wins (this is how "added to applied" gets its real, possibly-backdated applied date). Without it
// we only default-stamp today when there's no date yet (drag-drop, which doesn't prompt).
function stageChanges(p: Posting, to: Status, opts?: { appliedDate?: string }): Record<string, unknown> {
  const c: Record<string, unknown> = { status: to };
  if (to === "assessed" && p.fitScore == null) {
    c.fitScore = 70 + Math.floor(Math.random() * 25);
    c.fitSummary = "Stubbed assessment — real fit note comes from Claude later.";
  }
  if (to === "applied") {
    if (opts?.appliedDate) c.appliedDate = opts.appliedDate;
    else if (!p.appliedDate) c.appliedDate = TODAY;
  }
  if (to === "interview") c.interviewed = true; // triggers cooldown if later rejected
  return c;
}

// Owns the applications data: load, optimistic mutate, persist, activity log.
// The mutating helpers stub the real side effects (Claude, asset folder, CSV)
// and log what they *would* do until that plumbing lands.
export function useApplications() {
  const [postings, setPostings] = useState<Posting[]>([]);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const d = await fetch("/api/applications").then((r) => r.json());
    setPostings(d.postings ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Fetch-on-mount loader; its setState runs post-await (async), not synchronously, so it doesn't
    // cause the cascading render the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
  }, [loadAll]);

  // Persist a change to one application, then reconcile with the server's row.
  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const { posting } = await r.json();
      setPostings((all) => all.map((x) => (x.id === id ? posting : x)));
    }
  }, []);

  // Optimistically apply a field change to one posting (bump updatedAt), then persist.
  const applyLocal = useCallback(
    (id: string, changes: Record<string, unknown>) => {
      setPostings((all) => all.map((x) => (x.id === id ? { ...x, ...changes, updatedAt: TODAY } : x)));
      patch(id, changes);
    },
    [patch]
  );

  // Set a posting's stage directly (the drawer's stage selector). Status-dependent
  // side effects only fire when they'd add new info, so re-selecting a stage never
  // clobbers an existing applied date / resume folder.
  const setStatus = useCallback(
    (p: Posting, to: Status, opts?: { appliedDate?: string }) => {
      if (p.status === to) return;
      pendo.track("application_status_changed", {
        posting_id: p.id,
        company: p.company,
        role: p.role,
        from_status: p.status,
        to_status: to,
        has_fit_score: p.fitScore != null,
        fit_score: p.fitScore,
        has_resume: !!p.resumeDir,
      });
      const changes = stageChanges(p, to, opts);
      if (changes.fitScore != null) setActivity(`stub: would call Claude to score fit for ${p.company} — ${p.role}`);
      if (changes.appliedDate) setActivity(`${p.company} → Applied · stub: would re-export job_applications_tracker.csv`);
      if (to === "company_skipped") setActivity(`skipped ${p.company} — ${p.role}`);
      applyLocal(p.id, changes);
    },
    [applyLocal]
  );

  // Drag-drop a single job onto a pipeline column/pane. Same stage side effects as the
  // drawer selector, plus the tailoring column's two panes (Queued vs Tailored), which
  // are distinguished by the resume slug — dropping sets or clears resumeDir.
  const moveJobToStage = useCallback(
    (p: Posting, col: ColumnId, pane?: "queued" | "tailored") => {
      const to = STATUS_FOR[col];
      const changes = p.status === to ? {} as Record<string, unknown> : stageChanges(p, to);
      if (col === "tailoring") {
        if (pane === "tailored" && !p.resumeDir) changes.resumeDir = `${slug(p.company)}-${slug(p.role)}-${p.id}`;
        else if (pane === "queued" && p.resumeDir) changes.resumeDir = null;
      }
      if (Object.keys(changes).length === 0) return;
      applyLocal(p.id, changes);
      setActivity(`${p.company} — ${p.role} → ${col}${pane ? ` · ${pane}` : ""}`);
    },
    [applyLocal]
  );

  // Edit free-form fields on one posting (role, url, location…). Optimistic.
  const setField = useCallback(
    (p: Posting, changes: Partial<Posting>) => {
      const dirty = Object.entries(changes).filter(([k, v]) => (p as Record<string, unknown>)[k] !== v);
      if (!dirty.length) return;
      applyLocal(p.id, Object.fromEntries(dirty));
    },
    [applyLocal]
  );

  // Move ONE posting under a different company (job-level company edit), persist, refresh.
  const moveJob = useCallback(
    async (p: Posting, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === p.company) return;
      setPostings((all) => all.map((x) => (x.id === p.id ? { ...x, company: trimmed } : x)));
      await patch(p.id, { moveToCompany: trimmed });
      loadAll(); // re-group + pick up the target company's tier
    },
    [patch, loadAll]
  );

  // Rename a company (affects all its postings), persist, refresh.
  const renameCompany = useCallback(
    async (company: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === company) return;
      const ids = postings.filter((p) => p.company === company).map((i) => i.id);
      if (!ids.length) return;
      setPostings((all) => all.map((x) => (ids.includes(x.id) ? { ...x, company: trimmed } : x)));
      await patch(ids[0], { companyName: trimmed });
      loadAll();
    },
    [postings, patch, loadAll]
  );

  // Toggle the "interviewed" flag — drives the 6-month reapply cooldown after a rejection.
  const setInterviewed = useCallback(
    (p: Posting, interviewed: boolean) => {
      if (!!p.interviewed === interviewed) return;
      applyLocal(p.id, { interviewed });
    },
    [applyLocal]
  );

  // Move a whole company to a tier (affects all its applications), persist, refresh.
  const setCompanyTier = useCallback(
    async (company: string, tier: Tier) => {
      const items = postings.filter((p) => p.company === company);
      if (!items.length || items[0].tier === tier) return;
      pendo.track("company_tier_changed", {
        company,
        from_tier: items[0].tier,
        to_tier: tier,
      });
      const ids = items.map((i) => i.id);
      setPostings((all) => all.map((x) => (ids.includes(x.id) ? { ...x, tier } : x)));
      await patch(ids[0], { tier });
      loadAll();
    },
    [postings, patch, loadAll]
  );

  // Toggle a company on/off the discovery watchlist (what the agent auto-scans). Company-level,
  // independent of tier; persisted via the upsert endpoint (works even with no postings).
  const setWatchlist = useCallback(
    async (company: string, on: boolean) => {
      setPostings((all) => all.map((x) => (x.company === company ? { ...x, watchlist: on } : x)));
      setActivity(`${on ? "added" : "removed"} ${company} ${on ? "to" : "from"} watchlist`);
      await (on
        ? fetch("/api/watchlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ company }),
          })
        : fetch(`/api/watchlist?company=${encodeURIComponent(company)}`, { method: "DELETE" }));
      loadAll();
    },
    [loadAll]
  );

  // Hard-delete one posting completely. Optimistically drops it from the board, then
  // persists; on failure, reload to restore the true server state.
  const deleteJob = useCallback(
    async (p: Posting) => {
      pendo.track("posting_deleted", {
        posting_id: p.id,
        company: p.company,
        role: p.role,
        status_at_deletion: p.status,
        had_fit_assessment: p.fit != null || p.fitScore != null,
        had_tailored_resume: !!p.resumeDir,
      });
      setPostings((all) => all.filter((x) => x.id !== p.id));
      setActivity(`deleted ${p.company} — ${p.role ?? "—"}`);
      const r = await fetch(`/api/applications/${p.id}`, { method: "DELETE" });
      if (!r.ok) loadAll();
    },
    [loadAll]
  );

  return { postings, loading, activity, reload: loadAll, setStatus, moveJobToStage, setInterviewed, setCompanyTier, setWatchlist, setField, renameCompany, moveJob, deleteJob };
}
