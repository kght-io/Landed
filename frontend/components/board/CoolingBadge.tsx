import { Snowflake } from "lucide-react";

// "Discovery is skipping this company until <date>." Shown on the Targets row that owns the control
// and in the company drawer that only reports it, so the same state can't end up wearing two
// different looks. Callers supply the wording, since only they know whether the reader can act on it.
export default function CoolingBadge({ until, title, children }: { until: string; title: string; children?: React.ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-300 tabular-nums ring-1 ring-inset ring-sky-500/25"
    >
      <Snowflake size={10} /> {children ?? until}
    </span>
  );
}
