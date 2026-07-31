"use client";

import { useCallback, useEffect, useState } from "react";
import type { PrepQuestion, AttemptStatus } from "@landed/backend/db/prep";

// Loads the prep question bank for one lens ({track?, company?}) with derived progress,
// and owns the mutate→persist→reconcile path (attempts + noted/redo flags). Modeled on
// useApplications. Progress lives in SQLite — the single source of truth, not localStorage.
// Omit `track` (e.g. a company lens) to load every track the company features.
export function usePrep(track?: string, company?: string) {
  const [questions, setQuestions] = useState<PrepQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const qs = new URLSearchParams();
  if (track) qs.set("track", track);
  if (company) qs.set("company", company);
  const url = `/api/prep/questions?${qs.toString()}`;

  const reload = useCallback(async () => {
    const d = await fetch(url).then((r) => r.json()).catch(() => ({}));
    setQuestions(d.questions ?? []);
    setLoading(false);
  }, [url]);

  useEffect(() => {
    // Fetch-on-mount loader; its setState runs post-await (async), not synchronously, so it doesn't
    // cause the cascading render the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  const patchOne = useCallback((id: string, changes: Partial<PrepQuestion>) => {
    setQuestions((all) => all.map((q) => (q.id === id ? { ...q, ...changes } : q)));
  }, []);

  // Record a practice attempt (optionally timed). Optimistically bumps the count, then
  // reconciles with the server's authoritative derived stats.
  const logAttempt = useCallback(
    async (
      id: string,
      opts: { durationSec?: number; status?: AttemptStatus; notes?: string } = {}
    ) => {
      const status = opts.status ?? "solved";
      const _q = questions.find((q) => q.id === id);
      pendo.track("prep_attempt_logged", {
        question_id: id,
        track: _q?.track,
        status,
        duration_sec: opts.durationSec,
        question_name: _q?.name,
      });
      patchOne(id, {
        timesDone: (_q?.timesDone ?? 0) + 1,
        done: status === "solved" ? true : _q?.done ?? false,
      });
      const r = await fetch("/api/prep/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: id, ...opts, status }),
      });
      if (r.ok) {
        const { stats } = await r.json();
        patchOne(id, stats);
      }
    },
    [patchOne, questions]
  );

  // Undo the most recent attempt for a question (the un-check action).
  const undoLast = useCallback(
    async (id: string) => {
      const q = questions.find((x) => x.id === id);
      if (!q?.lastAttemptId) return;
      pendo.track("prep_attempt_undone", {
        question_id: id,
        track: q.track,
      });
      await fetch(`/api/prep/attempts/${q.lastAttemptId}`, { method: "DELETE" });
      await reload();
    },
    [questions, reload]
  );

  const setFlag = useCallback(
    async (id: string, flag: "noted" | "redo", value: boolean) => {
      patchOne(id, { [flag]: value } as Partial<PrepQuestion>);
      await fetch(`/api/prep/progress/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [flag]: value }),
      });
    },
    [patchOne]
  );

  const setNoted = useCallback((id: string, v: boolean) => setFlag(id, "noted", v), [setFlag]);
  const setRedo = useCallback((id: string, v: boolean) => setFlag(id, "redo", v), [setFlag]);

  return { questions, loading, reload, logAttempt, undoLast, setNoted, setRedo };
}
