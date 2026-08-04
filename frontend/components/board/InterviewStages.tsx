"use client";

// The interviewing stage, read as STAGES rather than as a flat list of rounds. A recruiter's process
// is a handful of named blocks ("Technical Assessment"), and one block routinely holds several
// back-to-back interviews on the same day — so "Round 3 of 7" pointed at one interview when three
// were coming. This shows the whole pipeline as a rail, opens any stage (including ones you haven't
// reached — that's how you prep for them), and links whatever files the recruiter sent for it.

import { useState } from "react";
import { CheckCircle2, ChevronRight, Circle, ExternalLink, FolderOpen, Users, XCircle } from "lucide-react";
import type { InterviewRound, Posting } from "@landed/shared/types";
import {
  ROUND_KIND_LABEL, currentStageIndex, hasDetail, loopStages, roundWhen, stageWhen, type LoopStage,
} from "@landed/shared/pipeline/interview-loop";
import { AttachmentChip, revealPrepFolder } from "./PrepFiles";

// Who you're meeting, as a line of "Name · Title" chips.
function Interviewers({ people }: { people: NonNullable<InterviewRound["interviewers"]> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((who, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-zinc-800/70 px-1.5 py-0.5 text-[12px] text-zinc-300">
          <Users size={11} className="text-zinc-500" />
          {who.name}
          {who.title && <span className="text-zinc-500">· {who.title}</span>}
        </span>
      ))}
    </div>
  );
}

// Everything `interview-emails` captured about one round, below its headline. Each block renders
// only if that piece was actually captured, so a thin round degrades to nothing rather than to a
// column of "—". Before this the same content existed only as prose in emails.md, which no screen read.
function RoundDetail({ r }: { r: InterviewRound }) {
  const [showPrep, setShowPrep] = useState(false);
  return (
    <div className="mt-2 space-y-2">
      {r.interviewers?.length ? <Interviewers people={r.interviewers} /> : null}
      {r.format && <p className="text-[12px] text-zinc-500">{r.format}</p>}
      {r.whatToExpect && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">What to expect</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300">{r.whatToExpect}</p>
        </div>
      )}
      {r.prepNotes?.length ? (
        <div>
          <button
            onClick={() => setShowPrep((v) => !v)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-zinc-400 transition hover:text-zinc-200"
          >
            <ChevronRight size={12} className={`transition ${showPrep ? "rotate-90" : ""}`} />
            How to prepare ({r.prepNotes.length})
          </button>
          {showPrep && (
            <ul className="mt-1 space-y-1 pl-4">
              {r.prepNotes.map((n, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-zinc-400">
                  <span className="mr-1.5 text-zinc-600">•</span>{n}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {r.notes && <p className="text-[12px] leading-relaxed text-zinc-500">{r.notes}</p>}
    </div>
  );
}

// Everything a state looks like, in one table — an icon for a round, a mark + dot for the rail, the
// note under the header, and the chip the rail shows on the stage you're on. `awaiting` is the one
// worth spelling out: the day came and went with no outcome on record, so it happened and the
// next-step email hasn't landed. `chip` says "next step" only where a step is actually left to
// take, so a round you've already sat never reads like it's about to happen.
type StateMeta = {
  icon: typeof Circle;
  mark: string;
  note: string | null;
  chip: string | null;
  tone: string;
  dot: string;
};
const STATE_META: Record<LoopStage["state"], StateMeta> = {
  passed: { icon: CheckCircle2, mark: "✓", note: "passed", chip: null, tone: "text-emerald-300",
    dot: "bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/40" },
  rejected: { icon: XCircle, mark: "✕", note: "rejected", chip: null, tone: "text-rose-300",
    dot: "bg-rose-500/20 text-rose-200 hover:bg-rose-500/30" },
  awaiting: { icon: Circle, mark: "◍", note: "done — awaiting their next step", chip: "pending", tone: "text-sky-300",
    dot: "bg-sky-500/20 text-sky-200 hover:bg-sky-500/30" },
  upcoming: { icon: Circle, mark: "●", note: null, chip: "next step", tone: "text-amber-300",
    dot: "bg-amber-500/25 text-amber-200 hover:bg-amber-500/40" },
  // stageWhen already says "Not scheduled" — the note would only repeat it.
  unscheduled: { icon: Circle, mark: "○", note: null, chip: "next step", tone: "text-zinc-400",
    dot: "border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300" },
  unknown: { icon: Circle, mark: "?", note: null, chip: "pending", tone: "text-sky-300",
    dot: "border border-dashed border-sky-500/50 text-sky-300 hover:border-sky-400" },
};
const SELECTED_DOT = "bg-emerald-500 text-emerald-950 ring-2 ring-emerald-400/50";

// A round shows its own outcome once it has one; until then it inherits its stage's state, which is
// what makes a pending round in a day that's already behind you read as done rather than as due.
const roundState = (r: InterviewRound, stage: LoopStage["state"]): LoopStage["state"] =>
  r.outcome && r.outcome !== "pending" ? r.outcome : stage;

// The loop's pipeline. Deliberately not the drawer's outer StageRail: there, stages you haven't
// reached are inert; here EVERY node is clickable, because a stage you haven't reached is exactly
// the one you want to read ahead on.
function PipelineRail({ stages, current, selected, onSelect }: {
  stages: LoopStage[];
  current: number;
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex items-start">
      {stages.map((s, i) => {
        const isSel = i === selected;
        const isCur = i === current;
        const { mark, chip, note, tone, dot } = STATE_META[s.state];
        return (
          <div key={s.key} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i > 0 ? (i <= current ? "bg-emerald-500/40" : "bg-zinc-800") : "bg-transparent"}`} />
              <button
                type="button"
                onClick={() => onSelect(i)}
                title={`${s.label} · ${stageWhen(s)}`}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] leading-none transition ${isSel ? SELECTED_DOT : dot}`}
              >
                {mark}
              </button>
              <span className={`h-0.5 flex-1 ${i < stages.length - 1 ? (i < current ? "bg-emerald-500/40" : "bg-zinc-800") : "bg-transparent"}`} />
            </div>
            <span
              title={s.label}
              className={`mt-1 w-full truncate px-0.5 text-center text-[10px] ${isSel ? "font-semibold text-zinc-100" : "text-zinc-500"}`}
            >
              {s.label}
            </span>
            {isCur && chip && (
              <span title={note ?? undefined} className={`w-full truncate text-center text-[9px] font-medium uppercase tracking-wide ${tone}`}>
                {chip}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// One round inside the open stage: headline + when, expanding to everything captured about it.
function RoundRow({ r, defaultOpen, stageState }: { r: InterviewRound; defaultOpen: boolean; stageState: LoopStage["state"] }) {
  const [open, setOpen] = useState(defaultOpen);
  const { icon: Icon, tone } = STATE_META[roundState(r, stageState)];
  const expandable = hasDetail(r);
  return (
    <li className="relative">
      <span className="absolute -left-[22px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-950">
        <Icon size={14} className={tone} />
      </span>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left disabled:cursor-default"
      >
        {expandable && <ChevronRight size={12} className={`shrink-0 text-zinc-500 transition ${open ? "rotate-90" : ""}`} />}
        <span className="truncate text-[13px] font-medium text-zinc-200">{ROUND_KIND_LABEL[r.kind ?? "other"]}</span>
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-zinc-500">{roundWhen(r)}</span>
      </button>
      {open && expandable ? <RoundDetail r={r} /> : null}
      {r.joinUrl && (
        <a
          href={r.joinUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-emerald-300 transition hover:text-emerald-200"
        >
          <ExternalLink size={11} /> Join
        </a>
      )}
    </li>
  );
}

// The files this stage's threads carried, as links into the company's attachments folder.
function StageResources({ postingId, files }: { postingId: string; files: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-emerald-500/15 pt-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Resources</span>
      {files.map((name) => <AttachmentChip key={name} postingId={postingId} name={name} />)}
      <button
        onClick={() => revealPrepFolder(postingId)}
        title="Reveal the attachments folder"
        className="inline-flex items-center gap-1 text-[12px] text-zinc-500 transition hover:text-zinc-300"
      >
        <FolderOpen size={11} /> folder
      </button>
    </div>
  );
}

// The interviewing card: which stage you're on, the whole pipeline, and every round inside the open
// one. Also serves the closed stage as the interview history — `currentStageIndex` then opens on the
// last stage reached rather than on an upcoming one.
export default function InterviewStages({ p, rounds }: { p: Posting; rounds: InterviewRound[] }) {
  const stages = loopStages(rounds);
  const current = currentStageIndex(stages);
  // Selection is held by (posting, stage key) rather than by index, so it survives a refresh that
  // re-derives the stages but falls back to the current stage the moment the drawer swaps postings
  // or the loop reshapes under it — no effect needed to re-point it.
  const [pick, setPick] = useState<{ id: string; key: string } | null>(null);
  const picked = pick?.id === p.id ? stages.findIndex((s) => s.key === pick.key) : -1;
  const selected = picked >= 0 ? picked : current;

  if (!stages.length) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
        <span className="text-[15px] font-semibold text-emerald-200">Interviewing</span>
        <p className="mt-1 text-[13px] text-zinc-300">No rounds scheduled yet — Sync Inbox to pull them in.</p>
        {p.appliedDate && <p className="mt-1.5 text-[12px] text-zinc-500">Applied {p.appliedDate}</p>}
      </div>
    );
  }

  const s = stages[selected];
  const single = s.rounds.length === 1;
  const select = (i: number) => setPick({ id: p.id, key: stages[i].key });
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[15px] font-semibold text-emerald-200">
          Stage {selected + 1} of {stages.length}
        </span>
        <span className="truncate text-[13px] font-medium text-zinc-200">· {s.label}</span>
        {p.status === "offer" && (
          <span className="ml-auto shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[12px] font-medium text-emerald-300">offer</span>
        )}
      </div>

      <div className="mt-2.5 mb-3">
        <PipelineRail stages={stages} current={current} selected={selected} onSelect={select} />
      </div>

      <p className="text-[13px] text-zinc-400">
        {stageWhen(s)}
        {STATE_META[s.state].note && (
          <span className={`ml-1.5 ${STATE_META[s.state].tone}`}>· {STATE_META[s.state].note}</span>
        )}
      </p>

      {!s.rounds.length ? (
        <p className="mt-1.5 text-[12px] text-zinc-500">
          They haven&apos;t said what&apos;s next — Sync Inbox to pull it in when they do.
        </p>
      ) : single ? (
        <>
          {hasDetail(s.rounds[0]) ? <RoundDetail r={s.rounds[0]} /> : (
            <p className="mt-1.5 text-[12px] text-zinc-500">
              No detail captured yet — Pull interview emails to fill in who, the format, and what to expect.
            </p>
          )}
          {s.rounds[0].joinUrl && (
            <a
              href={s.rounds[0].joinUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-1 text-[12px] font-medium text-emerald-950 transition hover:bg-emerald-400"
            >
              <ExternalLink size={11} /> Join
            </a>
          )}
        </>
      ) : (
        <ol className="relative ml-1 mt-2 space-y-3 border-l border-zinc-800 pl-4">
          {s.rounds.map((r, i) => (
            <RoundRow key={r.id ?? i} r={r} stageState={s.state} defaultOpen={s.rounds.length <= 3 && hasDetail(r)} />
          ))}
        </ol>
      )}

      {s.attachments.length > 0 && <StageResources postingId={p.id} files={s.attachments} />}
      {p.appliedDate && <p className="mt-1.5 text-[12px] text-zinc-500">Applied {p.appliedDate}</p>}
    </div>
  );
}
