"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { AXIS_LABELS, EXCLUDE_FIELD, type KeywordAxis } from "@landed/shared/jobs/dismiss";
import { suggestExclusions } from "@landed/shared/jobs/exclude-suggest";

// The follow-up to a labelled discard: turn the rejection you just made into a rule, in one click.
//
// The gap it closes: the discard labels fed the EVAL and nothing else. You could tell the system
// "wrong stack" a dozen times and it would keep surfacing iOS roles, because the judgment never
// reached the profile the glance actually reads. The label already names the axis; the keyword is in
// the title of the thing you just threw away.
//
// **A toast, not a modal.** The discard has already committed — it never waits on this, and dismissing
// costs nothing. Bottom-centre, same position and behaviour as the Pipeline's toast, because a card
// that steals focus after every discard is a card you learn to fight.
//
// Anchoring was the alternative and it doesn't work here: the row that was clicked is gone by the
// time this renders (the list reloads), so there is nothing left to point at.
//
// No auto-dismiss timer. This asks for a decision, and a prompt that vanishes mid-read is worse than
// one that waits. It's replaced by the next discard's card, and the × is always there.
export default function ExcludeSuggest({
  axis,
  texts,
  onClose,
}: {
  axis: KeywordAxis;
  /** The discarded postings' text — title plus department. Ranked by how many of them share a term. */
  texts: string[];
  onClose: () => void;
}) {
  const [already, setAlready] = useState<string[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);

  // The current axis has to be known before anything is offered, or the card suggests rules that
  // already exist — which teaches you it isn't listening.
  useEffect(() => {
    let live = true;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => { if (live) setAlready(d.profile?.[EXCLUDE_FIELD[axis]] ?? []); })
      .catch(() => { if (live) setAlready([]); });
    return () => { live = false; };
  }, [axis]);

  const suggestions = useMemo(
    () => (already === null ? [] : suggestExclusions(axis, texts, already)),
    [axis, texts, already],
  );

  const add = async (terms: string[]) => {
    const fresh = terms.map((t) => t.trim()).filter((t) => t && !added.some((a) => a.toLowerCase() === t.toLowerCase()));
    if (!fresh.length) return;
    setAdded((prev) => [...prev, ...fresh]); // optimistic: the click should feel done
    await fetch("/api/profile/exclude", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ axis, terms: fresh }),
    }).catch(() => {});
  };

  // Nothing to offer and nothing typed yet → don't render at all. A prompt offering no options is a
  // click you have to spend to dismiss, and this fires after EVERY labelled discard.
  if (already === null) return null;
  if (!suggestions.length && !added.length && !typing) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex max-w-[min(92vw,640px)] items-center gap-3 rounded-xl bg-zinc-900/95 px-3.5 py-2.5 text-[13px] shadow-xl ring-1 ring-zinc-700/80 backdrop-blur">
        <span className="shrink-0 text-zinc-400">
          {added.length ? (
            <>Added to <span className="text-zinc-200">{AXIS_LABELS[axis]}</span></>
          ) : (
            <>Always skip this? Add to <span className="text-zinc-200">{AXIS_LABELS[axis]}</span></>
          )}
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {added.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-[12px] font-medium text-rose-300">
              <Check size={11} /> {t}
            </span>
          ))}
          {suggestions.filter((s) => !added.some((a) => a.toLowerCase() === s.toLowerCase())).map((s) => (
            <button
              key={s}
              onClick={() => add([s])}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-rose-500/15 hover:text-rose-300 hover:ring-rose-500/40"
            >
              <Plus size={11} /> {s}
            </button>
          ))}

          {/* The escape hatch for what the vocabulary missed — it's a fixed lookup, not a model, so it
              will miss unusual terms. Without this the card would be silently wrong on exactly the
              postings worth a new rule. */}
          {typing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); add(draft.split(",")); setDraft(""); }
                else if (e.key === "Escape") { setTyping(false); setDraft(""); }
              }}
              onBlur={() => { if (draft.trim()) add(draft.split(",")); setDraft(""); setTyping(false); }}
              placeholder="keyword…"
              className="w-28 rounded-md bg-zinc-800 px-2 py-1 text-[12px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-600 focus:ring-zinc-500"
            />
          ) : (
            <button
              onClick={() => setTyping(true)}
              className="rounded-md px-1.5 py-1 text-[12px] text-zinc-500 transition hover:text-zinc-300"
            >
              other…
            </button>
          )}
        </div>

        <button onClick={onClose} className="ml-auto shrink-0 rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300" aria-label="Dismiss">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
