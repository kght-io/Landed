"use client";

import { useState } from "react";
import { CheckCircle2, Sparkles, ExternalLink } from "lucide-react";
import type { PrepQuestion } from "@landed/backend/db/prep";

const isUrl = (s?: string) => !!s && /^https?:\/\//i.test(s);
// Trim a URL to a readable label (host + first path segment).
const shortUrl = (u: string) => {
  try {
    const { hostname, pathname } = new URL(u);
    const seg = pathname.split("/").filter(Boolean)[0];
    return hostname.replace(/^www\./, "") + (seg ? `/${seg}` : "");
  } catch {
    return u;
  }
};

// A per-question confidence tag (🟢 confirmed / 🟡 likely). Clicking it reveals WHY — the
// `companyConfidenceReason` (or the company note as a fallback) — and, for confirmed questions, the
// `source` as a link. Renders nothing for generic (non-company) questions with no confidence.
//
// The trigger is a <span role="button">, not a <button>, because the SD/behavioral cards wrap their
// header row in a toggle <button> and nesting interactive elements is invalid; stopPropagation keeps
// a tag click from also expanding the card.
export default function ConfidenceTag({ q }: { q: PrepQuestion }) {
  const [open, setOpen] = useState(false);
  const conf = q.companyConfidence;
  if (!conf) return null;
  const confirmed = conf === "confirmed";
  const reason = q.companyConfidenceReason || q.companyNote;
  const source = q.companySource;
  const tone = confirmed
    ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"
    : "bg-amber-500/10 text-amber-300 ring-amber-500/25";

  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
  };

  return (
    <span className="relative inline-flex">
      <span
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") toggle(e);
        }}
        title="Why?"
        className={`inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset transition hover:brightness-125 ${tone}`}
      >
        {confirmed ? <CheckCircle2 size={11} /> : <Sparkles size={11} />}
        {confirmed ? "confirmed" : "likely"}
      </span>

      {open && (
        <>
          {/* click-away catcher */}
          <span className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <span
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-full z-20 mt-1 block w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 text-left shadow-xl shadow-black/40"
          >
            <span className={`mb-1 block text-[11px] font-semibold uppercase tracking-wider ${confirmed ? "text-emerald-300" : "text-amber-300"}`}>
              {confirmed ? "Confirmed — asked before" : "Likely — predicted"}
            </span>
            <span className="block text-[12px] leading-relaxed text-zinc-300">
              {reason || (confirmed ? "Reported as actually asked in this loop." : "Predicted from the role + the company's patterns.")}
            </span>
            {/* Every question is expected to cite where it came from — show it (or flag the gap). */}
            <span className="mt-2 block border-t border-zinc-800 pt-2 text-[12px]">
              <span className="text-zinc-500">Source: </span>
              {source ? (
                isUrl(source) ? (
                  <a
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200"
                  >
                    {shortUrl(source)}
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-zinc-300">{source}</span>
                )
              ) : (
                <span className="italic text-zinc-600">not cited</span>
              )}
            </span>
          </span>
        </>
      )}
    </span>
  );
}
