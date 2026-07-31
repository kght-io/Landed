// Populate the local DB with realistic FAKE data so a fresh clone shows a working, populated
// pipeline (discovery → fit → tailor → apply → interview → closed) without needing the CoWork
// agent, Gmail, or a Claude subscription. For demos, screenshots, and UI/data-layer development.
//
//   npm run seed:demo
//
// Idempotent + SAFE: it only ever touches the fictional companies listed below (and their
// postings) — your real companies/applications are left untouched. Re-running refreshes the demo.
// Writes to the local gitignored DB only.
import { db } from "@landed/core/db";
import { companies, postings } from "@landed/core/db/schema";
import { inArray, eq } from "drizzle-orm";

const NOW = "2026-07-20T12:00:00.000Z";

type Tier = "tier1" | "tier2" | "tier3";
type State = typeof postings.$inferInsert.state;

type Co = {
  name: string;
  tier: Tier;
  watchlist?: boolean;
  ats?: string;
  slug?: string;
  fetchMethod?: string;
  careersUrl?: string;
  titles?: string[];
  location?: string;
};

// All fictional — chosen so `seed:demo` can wipe + refresh only its own rows.
const COMPANIES: Co[] = [
  { name: "Acme Robotics", tier: "tier1", watchlist: true, ats: "greenhouse", slug: "acme", fetchMethod: "api", careersUrl: "https://acme.example.com/careers", titles: ["Senior", "Staff"], location: "NYC|remote" },
  { name: "Globex", tier: "tier1", watchlist: true, ats: "ashby", slug: "globex", fetchMethod: "api", careersUrl: "https://globex.example.com/jobs", titles: ["Staff"], location: "Remote (US)" },
  { name: "Initech", tier: "tier2", watchlist: true, ats: "greenhouse", slug: "initech", fetchMethod: "api", careersUrl: "https://initech.example.com/careers", titles: ["Senior"], location: "SF|remote" },
  { name: "Umbrella Systems", tier: "tier2", watchlist: true, careersUrl: "https://umbrella.example.com/careers", fetchMethod: "careers-get", titles: ["Senior", "Staff"] },
  { name: "Hooli", tier: "tier1" },
  { name: "Stark Industries", tier: "tier1" },
  { name: "Wayne Enterprises", tier: "tier2" },
  { name: "Cyberdyne", tier: "tier3" },
  { name: "Soylent Corp", tier: "tier2" },
  { name: "Vandelay Industries", tier: "tier3" },
  { name: "Wonka Labs", tier: "tier3" },
  { name: "Tyrell Corp", tier: "tier1" },
];

// A compact FitAssessment blob for assessed/tailored/tracker rows.
const fit = (call: string, summary: string, strengths: string[], gaps: string[]) =>
  JSON.stringify({
    levelMatch: { call, why: `Scope and impact read as ${call}.` },
    recommendation: "apply",
    summary,
    strengths,
    gaps: gaps.map((text) => ({ text, severity: "minor" })),
  });

type Post = {
  company: string;
  title: string;
  state: State;
  level?: string;
  team?: string;
  location?: string;
  url?: string;
  fitScore?: number;
  fitDetail?: string;
  appliedDate?: string;
  interviewed?: boolean;
  note?: string;
};

// Spread across every funnel stage so the board, drawer, and dashboard all have something to show.
const POSTINGS: Post[] = [
  // Fit Assessment — freshly discovered, awaiting your triage (no score yet)
  { company: "Hooli", title: "Senior Software Engineer, Platform", state: "review", location: "Remote (US)", url: "https://hooli.example.com/jobs/1" },
  { company: "Cyberdyne", title: "Staff Engineer, ML Systems", state: "matched", location: "Austin, TX" },
  // Fit Assessment — queued for CoWork to score
  { company: "Acme Robotics", title: "Staff Software Engineer, Controls", state: "fit_queue", location: "NYC" },
  { company: "Globex", title: "Senior Backend Engineer", state: "fit_queue", location: "Remote (US)" },
  // Fit Assessment — scored
  { company: "Initech", title: "Senior Software Engineer", state: "assessed", level: "Senior", team: "Payments", fitScore: 84,
    fitDetail: fit("Senior", "Strong backend + distributed-systems match; team owns core payments.", ["Distributed systems", "Payments domain"], ["No Go experience listed"]) },
  { company: "Soylent Corp", title: "Staff Engineer, Data Platform", state: "assessed", level: "Staff", team: "Data", fitScore: 71,
    fitDetail: fit("Staff", "Good platform overlap; lighter on the streaming stack they emphasize.", ["Data platform", "Leadership scope"], ["Kafka/Flink depth", "Fewer 0→1 examples"]) },
  // Tailor
  { company: "Wayne Enterprises", title: "Senior Software Engineer, Security", state: "tailoring", level: "Senior", team: "Security", fitScore: 88,
    fitDetail: fit("Senior", "Excellent security + backend fit.", ["AppSec", "Backend"], ["No formal pentest cert"]) },
  { company: "Globex", title: "Staff Software Engineer, Infra", state: "tailored", level: "Staff", team: "Infra", fitScore: 90,
    fitDetail: fit("Staff", "Top match — infra scope and scale line up.", ["Kubernetes", "Scale", "Leadership"], []) },
  // Apply Later — ready to submit
  { company: "Umbrella Systems", title: "Senior Software Engineer", state: "apply_later", level: "Senior", team: "Core", fitScore: 79,
    fitDetail: fit("Senior", "Solid all-round fit; parked pending referral.", ["Full-stack", "Ownership"], ["Unknown comp band"]) },
  // Applied
  { company: "Stark Industries", title: "Staff Software Engineer, Agents", state: "applied", level: "Staff", team: "AI", fitScore: 92, appliedDate: "2026-07-05",
    fitDetail: fit("Staff", "Agentic-systems experience is a direct match.", ["Multi-agent systems", "LLM integration"], []) },
  { company: "Acme Robotics", title: "Senior Software Engineer, Simulation", state: "applied", level: "Senior", team: "Sim", fitScore: 80, appliedDate: "2026-07-12" },
  // Interviewing
  { company: "Initech", title: "Senior Software Engineer, Payments", state: "interview", level: "Senior", team: "Payments", fitScore: 86, appliedDate: "2026-06-20", interviewed: true, note: "Onsite scheduled — system design + 2 coding." },
  { company: "Tyrell Corp", title: "Staff Software Engineer, Platform", state: "interview", level: "Staff", team: "Platform", fitScore: 89, appliedDate: "2026-06-15", interviewed: true },
  // Offer
  { company: "Wonka Labs", title: "Senior Software Engineer", state: "offer", level: "Senior", team: "Product", fitScore: 83, appliedDate: "2026-06-01", interviewed: true, note: "Verbal offer — negotiating." },
  // Closed
  { company: "Vandelay Industries", title: "Senior Backend Engineer", state: "accepted", level: "Senior", appliedDate: "2026-05-10", interviewed: true, note: "Accepted 🎉" },
  { company: "Soylent Corp", title: "Senior Software Engineer, Growth", state: "rejected", level: "Senior", appliedDate: "2026-06-08", interviewed: true },
  { company: "Hooli", title: "Staff Engineer, Search", state: "ghost", level: "Staff", appliedDate: "2026-05-28" },
];

function main() {
  const names = COMPANIES.map((c) => c.name);

  // Idempotent refresh: remove only THIS seed's companies + their postings (children first for the FK).
  const existing = db.select().from(companies).all().filter((c) => names.includes(c.name));
  if (existing.length) {
    const ids = existing.map((c) => c.id);
    db.delete(postings).where(inArray(postings.companyId, ids)).run();
    db.delete(companies).where(inArray(companies.id, ids)).run();
  }

  // Companies
  const idByName = new Map<string, number>();
  for (const c of COMPANIES) {
    const row = db.insert(companies).values({
      name: c.name,
      tier: c.tier,
      watchlist: c.watchlist ?? false,
      ats: c.ats ?? null,
      slug: c.slug ?? null,
      fetchMethod: c.fetchMethod ?? null,
      careersUrl: c.careersUrl ?? null,
      targetTitles: c.titles ? JSON.stringify(c.titles) : null,
      targetLocation: c.location ?? null,
      lastScrapedAt: c.watchlist ? NOW : null,
      createdAt: NOW,
      updatedAt: NOW,
    }).returning({ id: companies.id }).get();
    idByName.set(c.name, row.id);
  }

  // Postings
  for (const p of POSTINGS) {
    const companyId = idByName.get(p.company);
    if (companyId == null) throw new Error(`demo posting references unknown company: ${p.company}`);
    db.insert(postings).values({
      companyId,
      title: p.title,
      location: p.location ?? null,
      url: p.url ?? null,
      verdict: "kept",
      state: p.state,
      fitScore: p.fitScore ?? null,
      fitDetail: p.fitDetail ?? null,
      level: p.level ?? null,
      team: p.team ?? null,
      source: "manual",
      note: p.note ?? null,
      interviewed: p.interviewed ?? false,
      appliedDate: p.appliedDate ?? null,
      discoveredAt: NOW,
      scannedAt: NOW,
      updatedAt: NOW,
    }).run();
  }

  console.log(`Seeded ${COMPANIES.length} demo companies and ${POSTINGS.length} postings across the pipeline.`);
  console.log("Open http://localhost:3000 to see the populated board. Re-run any time to refresh; your real data is untouched.");
}

main();
