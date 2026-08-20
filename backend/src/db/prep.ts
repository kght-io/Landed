import { eq } from "drizzle-orm";
import { db } from "./index";
import { prepCompany } from "./schema";
import type { PrepCompanyRow } from "./schema";
import { canonical } from "@landed/shared/agents/canonical";

// ── Per-company prep profiles ──
// What survives of the retired question-research feature: the canonical company key every
// interview-prep surface agrees on, and read access to the profiles already in the DB (rounds,
// process, overview) so a company researched before the retirement still shows up in its
// context.md dump. Nothing writes these rows any more — see backend/src/prep/export-context.ts
// for the reader, and the git history for the research job that used to fill them.

// `key` links a round to the loop model. Optional so older profiles without keys still parse.
export type PrepRound = { key?: string; name: string; format?: string; focus?: string };
export type PrepCategory = { key: string; label: string; description?: string; kind: string };
export type PrepSource = { label: string; url?: string };

export type CompanyProfile = {
  slug: string;
  name: string;
  overview?: string; // product/company summary
  process?: string;
  rounds: PrepRound[];
  categories: PrepCategory[];
  sources: PrepSource[];
  researchedAt?: string;
};

function parseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toProfile(r: PrepCompanyRow): CompanyProfile {
  return {
    slug: r.slug,
    name: r.name,
    overview: r.overview ?? undefined,
    process: r.process ?? undefined,
    rounds: parseJSON<PrepRound[]>(r.rounds, []),
    categories: parseJSON<PrepCategory[]>(r.categories, []),
    sources: parseJSON<PrepSource[]>(r.sources, []),
    researchedAt: r.researchedAt ?? undefined,
  };
}

export function getCompanyProfile(slug: string): CompanyProfile | null {
  const r = db.select().from(prepCompany).where(eq(prepCompany.slug, slug)).get();
  return r ? toProfile(r) : null;
}

// Canonical company key — the same key the interview-prep/<slug>/ folder, the asset jobs, and the
// prep chat use. Falls back to a plain slug when the name doesn't canonicalize (keeps an oddly-named
// company addressable).
const plainSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const companySlug = (name: string): string => canonical(name)?.key ?? plainSlug(name);
