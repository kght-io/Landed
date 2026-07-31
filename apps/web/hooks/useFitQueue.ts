"use client";

import { useCallback } from "react";

import type { FitInput } from "@landed/shared/jobs/types";
export type { FitInput };

// Manually queue a posting for fit assessment (your "add JD" on the Fit page).
export function useFitQueue() {
  const addFit = useCallback(async (input: FitInput) => {
    const r = await fetch("/api/jobs/fit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return r.ok;
  }, []);

  return { addFit };
}
