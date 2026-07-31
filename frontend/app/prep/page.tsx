import { listQuestions, listCompanyProfiles, listFeedback, getCompanyProfile, companySlug } from "@landed/backend/db/prep";
import { listPostings } from "@landed/backend/db/queries";
import { isActivelyInterviewing, isPastInterviewed, nextUpcomingRound, nextRoundKindLabel } from "@landed/shared/prep/landing";
import PrepTabs, { type PrepCardData, type InterviewingData } from "@/components/prep/PrepTabs";
import type { Posting } from "@landed/shared/types";

export const dynamic = "force-dynamic";

// Progress over a question set: solved (≥1 solved attempt) / total.
function progress(qs: { done: boolean }[]) {
  const done = qs.filter((q) => q.done).length;
  return { done, total: qs.length, pct: qs.length ? Math.round((done / qs.length) * 100) : 0 };
}

// Companies with a posting currently in the interview/offer stage, with their prep-profile summary
// and the application's next step (pipeline status + next scheduled round). Companies with no profile
// yet show as "researching" (the agent auto-queues a prep-research job on stage entry). Collapsed by
// canonical slug so multiple postings at one company show once.
function interviewingCompanies(postings: Posting[]): InterviewingData[] {
  const byCompany = new Map<string, Posting>();
  for (const p of postings) {
    if (!isActivelyInterviewing(p)) continue;
    const slug = companySlug(p.company);
    if (!byCompany.has(slug)) byCompany.set(slug, p);
  }
  return [...byCompany.entries()].map(([slug, p]) => {
    const profile = getCompanyProfile(slug);
    const questions = profile ? listQuestions({ company: slug }) : [];
    const confirmed = questions.filter((q) => q.companyConfidence === "confirmed").length;
    const next = nextUpcomingRound(p.interviews);
    return {
      slug,
      name: p.company,
      role: p.role,
      status: p.status,
      researched: !!profile,
      overview: profile?.overview ?? null,
      rounds: profile?.rounds.length ?? 0,
      questions: questions.length,
      confirmed,
      likely: questions.length - confirmed,
      done: questions.filter((q) => q.done).length,
      pendingFeedback: profile ? listFeedback(slug).filter((f) => f.status === "queued").length : 0,
      nextStepLabel: nextRoundKindLabel(next),
      nextStepDate: next?.date ?? null,
    };
  });
}

export default function PrepLanding() {
  const postings = listPostings();
  const coding = listQuestions({ track: "coding" });
  const systemDesign = listQuestions({ track: "system_design" });

  const interviewing = interviewingCompanies(postings);
  const interviewingSlugs = new Set(interviewing.map((c) => c.slug));

  // Generic tracks — always shown under the "General Prep Tracker" tab.
  const tracks: PrepCardData[] = [
    {
      href: "/prep/coding",
      iconKey: "coding",
      title: "Leetcode",
      sub: "Problems by topic · curriculum · patterns",
      accent: "from-emerald-400 to-sky-500",
      ...progress(coding),
    },
    {
      href: "/prep/system-design",
      iconKey: "system-design",
      title: "System Design",
      sub: "Question bank · game plan · tech decisions",
      accent: "from-sky-400 to-indigo-500",
      ...progress(systemDesign),
    },
  ];

  // Past interviewed companies: researched profiles whose loop actually concluded (a terminal
  // outcome after interviewing) and that aren't currently interviewing. Rendered as company cards.
  const pastSlugs = new Set<string>();
  for (const p of postings) if (isPastInterviewed(p)) pastSlugs.add(companySlug(p.company));
  const past: PrepCardData[] = listCompanyProfiles()
    .filter((p) => !interviewingSlugs.has(p.slug) && pastSlugs.has(p.slug))
    .map((p) => {
      const qs = listQuestions({ company: p.slug });
      const sub = [
        `${p.categories.length} categor${p.categories.length === 1 ? "y" : "ies"}`,
        p.rounds.length ? `${p.rounds.length} rounds` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        href: `/prep/company/${p.slug}`,
        iconKey: "company" as const,
        title: p.name,
        sub: sub || "Company-specific prep",
        accent: "from-fuchsia-400 to-purple-500",
        ...progress(qs),
      };
    });

  return (
    <div className="flex h-full flex-col text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 px-6 py-3.5 backdrop-blur">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">Interview Prep</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">Track progress across coding, system design, and company-specific prep.</p>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <PrepTabs tracks={tracks} interviewing={interviewing} past={past} />
        </div>
      </div>
    </div>
  );
}
