"use client";

import { createContext, useCallback, useContext, useState } from "react";
import AddFitModal from "@/components/AddFitModal";

// Owns the single, app-wide "Add a job by pasting its JD" modal so it can be opened from anywhere
// (the nav rail's global "Add job" action, the pipeline's own button, …) rather than being tied to
// whichever view happens to render the funnel. Pasting a JD is the primary way jobs enter Landed.
type AddJobCtx = { openAddJob: () => void };
const Ctx = createContext<AddJobCtx | null>(null);

export default function AddJobProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openAddJob = useCallback(() => setOpen(true), []);
  return (
    <Ctx.Provider value={{ openAddJob }}>
      {children}
      {open && <AddFitModal onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

export function useAddJob(): AddJobCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAddJob must be used within AddJobProvider");
  return c;
}
