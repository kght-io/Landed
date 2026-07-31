"use client";

import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import { onboardingAllDone, OPEN_GETSTARTED_EVENT, type OnboardingStatus } from "@landed/shared/onboarding-shared";

// The empty-table placeholder. For a not-yet-set-up install it also offers a "Get started" button that
// re-opens the onboarding checklist (its progress is saved). Once setup is complete it's just the
// plain "nothing here" line, so an established user with an empty stage isn't nagged.
export default function EmptyStateGetStarted({ label = "nothing in this step" }: { label?: string }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  useEffect(() => {
    fetch("/api/onboarding").then((r) => r.json()).then((d) => setStatus(d.status ?? null)).catch(() => {});
  }, []);
  const setupIncomplete = status != null && !onboardingAllDone(status);

  return (
    <div className="rounded-xl border border-dashed border-zinc-800/80 py-10 text-center">
      <p className="text-[13px] text-zinc-600">{label}</p>
      {setupIncomplete && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_GETSTARTED_EVENT))}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-[13px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 transition hover:bg-emerald-500/25"
        >
          <Rocket size={13} /> Get started
        </button>
      )}
    </div>
  );
}
