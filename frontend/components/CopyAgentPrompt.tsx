"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { jobVerb, jobPlaybook } from "@/components/jobMeta";

// The exact thing to say to the desktop agent — copied to the clipboard so it's paste-ready. A short
// "clear my queue" is too vague for the agent to act on reliably, so spell out the workflow. The prompt
// is SCOPED TO ONE TYPE (the tab you're viewing): it tells the agent to drain just that queue via
// claimNext({ type }) and stop — matching the server-side one-type-at-a-time rule. Shared by the
// floating queue and the Agents page so they never drift.
export function promptFor(type: string): string {
  return (
    `Work ONLY my Landed "${type}" queue this run. Call claimNext({ type: "${type}" }) to lease the next ${type} job — it returns the job with its task + params and a live claim. ` +
    `Follow its playbook in instructions/${jobPlaybook(type)} and submit the outcome with the submitJobResult tool (jobId = the job's id), echoing back each posting's id; you must still hold the lease when you submit. ` +
    `Then call claimNext({ type: "${type}" }) again, repeating until it returns { job: null } — that means this queue is fully cleared, so stop and give me a one-line summary. Do NOT start any other job type. ` +
    `For a redo job (a re-queued fit/tailoring carrying my redo note), read the prior conversation in the job's task and address my latest redo note specifically — tailoring redos must be saved to the exact versioned resume/<slug>/v<N>/ folder the job names.`
  );
}

// One-click "copy the agent instruction" button, scoped to a single job type.
export function CopyPrompt({ type, className }: { type: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(promptFor(type))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };
  return (
    <button
      onClick={copy}
      title={`Copy the instruction to paste into the agent — scoped to the ${jobVerb(type)} queue`}
      className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-violet-500 px-2 py-1.5 text-[12px] font-medium text-violet-50 transition hover:bg-violet-400 ${className ?? ""}`}
    >
      {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy prompt — {jobVerb(type)}</>}
    </button>
  );
}
