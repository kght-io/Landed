import type { FitGap, Posting, Status } from "@landed/shared/types";
import {
  fitColor, reapplyInfo, STATUS_LABEL, STATUS_CHIP, CHIP_ORDER,
} from "@landed/shared/pipeline/stages";
import type { GroupReapply } from "@landed/shared/pipeline/board";

export function FitBadge({ score, size = "sm" }: { score: number; size?: "sm" | "lg" }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border font-semibold tabular-nums ${fitColor(score)} ${
        size === "lg" ? "px-2.5 py-1 text-sm" : "px-1.5 py-0.5 text-[13px]"
      }`}
    >
      {score}
    </span>
  );
}

// Leveling call from the fit assessment.
const LEVEL_META: Record<string, string> = {
  match: "text-emerald-300 bg-emerald-500/15 ring-emerald-500/25",
  stretch: "text-amber-300 bg-amber-500/15 ring-amber-500/25",
  under: "text-rose-300 bg-rose-500/15 ring-rose-500/25",
  "under-leveled": "text-rose-300 bg-rose-500/15 ring-rose-500/25",
};
export function LevelBadge({ level }: { level: string }) {
  const cls = LEVEL_META[level.toLowerCase().trim()] ?? "text-zinc-300 bg-zinc-700/40 ring-zinc-600/40";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[12px] font-medium ring-1 ring-inset ${cls}`}>
      {level}
    </span>
  );
}

// The fit strengths: a simple bulleted list (emerald accent).
export function StrengthsList({ strengths }: { strengths: string[] }) {
  if (!strengths.length) return null;
  return (
    <ul className="space-y-0.5">
      {strengths.map((s, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[13px] text-zinc-300">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500/60" />
          <span className="flex-1">{s}</span>
        </li>
      ))}
    </ul>
  );
}

// The fit gaps: structured, each with severity + an explanation (detail).
export function GapList({ gaps }: { gaps: FitGap[] }) {
  if (!gaps.length) return null;
  return (
    <ul className="space-y-1.5">
      {gaps.map((g, i) => (
        <li key={i} className="text-[13px] text-zinc-300">
          <div className="flex items-start gap-1.5">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
            <span className="flex-1 font-medium">{g.text}</span>
            {g.severity && (
              <span className={`shrink-0 rounded px-1 py-0.5 text-[11px] font-medium uppercase ${
                g.severity === "hard" ? "text-rose-300 bg-rose-500/15" : "text-zinc-400 bg-zinc-700/40"
              }`}>
                {g.severity}
              </span>
            )}
          </div>
          {g.detail && <p className="ml-2.5 mt-0.5 text-[12px] leading-relaxed text-zinc-500">{g.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

// Reapply rollup for a company/group.
export function ReapplyTag({ r }: { r: GroupReapply }) {
  if (r.state === "eligible")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[12px] font-medium text-emerald-300">
        ✓ reapply eligible
      </span>
    );
  if (r.state === "cooldown")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[12px] font-medium text-amber-300">
        cooldown · until {r.until ?? "?"}
      </span>
    );
  return null;
}

// Reapply state for a single application.
export function ReapplyBadge({ p }: { p: Posting }) {
  const info = reapplyInfo(p);
  if (info.state === "n/a") return null;
  if (info.state === "eligible")
    return (
      <span className="mt-2 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[12px] font-medium text-emerald-300">
        ✓ reapply eligible
      </span>
    );
  return (
    <span className="mt-2 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[12px] font-medium text-amber-300">
      cooldown · reapply after {info.until}
    </span>
  );
}

export function StatusBreakdown({ counts }: { counts: Partial<Record<Status, number>> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {CHIP_ORDER.filter((s) => counts[s]).map((s) => (
        <span key={s} className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${STATUS_CHIP[s]}`}>
          {counts[s]} {STATUS_LABEL[s].toLowerCase()}
        </span>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium uppercase tracking-wider text-zinc-600">{label}</p>
      {children}
    </div>
  );
}
