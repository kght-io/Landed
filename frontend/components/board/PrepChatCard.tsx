"use client";

import type { Posting } from "@landed/shared/types";
import { canonical } from "@landed/shared/agents/canonical";
import PrepChat from "@/components/prep/PrepChat";
import { companyContext, prepChatHref } from "@/components/prep/companyContext";

// The prep coach, as the drawer's Chat tab. Same chat as before (one session per company, keyed by
// the prep-folder slug — the history follows the company, not the posting); it just lives next to
// the brief now instead of on the /prep page. It fills the drawer body rather than taking a fixed
// height: nothing about the panel scrolls, only the message log inside the chat. The header's expand
// control opens the same conversation at /prep-chat/<slug>, a page you can keep in its own tab.
export default function PrepChatCard({ p }: { p: Posting }) {
  // The company's prep folder key — the same one the export/brief/pull jobs use.
  const slug = canonical(p.company)?.key ?? null;
  if (!slug)
    return <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-[12px] text-zinc-600">No prep folder for {p.company} yet.</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <PrepChat
        storageId={slug}
        slug={slug}
        context={companyContext(p.company, p.role)}
        openUrl={prepChatHref(slug)}
        intro={`Your interview-prep coach for ${p.company}. It reads this company's research files (below) — ask it to quiz you, pressure-test an answer, or dig into a weak spot.`}
        placeholder={`Prep for ${p.company}…`}
      />
    </div>
  );
}
