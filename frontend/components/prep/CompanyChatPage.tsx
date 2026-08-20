"use client";

import PrepChat from "./PrepChat";
import { companyContext } from "./companyContext";

// The standalone prep-chat page's body. Same chat component as the drawer's Chat tab — same session,
// same localStorage history, keyed by slug — laid out to fill the window instead of a 720px column.
export default function CompanyChatPage({ slug, company, role }: { slug: string; company: string; role?: string | null }) {
  return (
    <div className="h-full">
      <PrepChat
        storageId={slug}
        slug={slug}
        context={companyContext(company, role)}
        fullscreen
        heading={company}
        subheading={role ?? undefined}
        intro={`Your interview-prep coach for ${company}. It reads this company's research files (above) — ask it to quiz you, pressure-test an answer, or dig into a weak spot.`}
        placeholder={`Prep for ${company}…`}
      />
    </div>
  );
}
