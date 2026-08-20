import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listPostings } from "@landed/backend/db/queries";
import { companySlug } from "@landed/backend/db/prep";
import CompanyChatPage from "@/components/prep/CompanyChatPage";

export const dynamic = "force-dynamic";

// Who this chat is about. The URL carries the prep-folder slug (the same key the folder, the asset
// jobs and the drawer use); the company NAME and role come from the tracker, preferring a posting in
// a live loop — that's the role you're prepping for when a company has more than one.
function companyFor(slug: string): { company: string; role?: string | null } | null {
  const mine = listPostings().filter((p) => companySlug(p.company) === slug);
  if (!mine.length) return null;
  const live = mine.find((p) => p.status === "interview" || p.status === "offer");
  const p = live ?? mine[0];
  return { company: p.company, role: p.role };
}

// The browser tab is the point of this page — several companies open at once, told apart at a glance.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = companyFor(slug);
  return { title: found ? `${found.company} — prep chat` : "Prep chat" };
}

// The per-company prep coach as its own page: the same chat as the pipeline drawer's Chat tab, at its
// own URL so a company's prep can live in a browser tab of its own.
export default async function PrepChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = companyFor(slug);
  if (!found) notFound();
  return <CompanyChatPage slug={slug} company={found.company} role={found.role} />;
}
