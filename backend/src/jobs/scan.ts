// Mechanical board scan — NO LLM, zero API cost. The app fetches ATS job boards (clean JSON
// APIs, unlike JS-rendered career pages) and returns a filtered shortlist. The agent keeps all
// judgment (glance/fit); this just hands it postings instead of a 498-job haystack.
//
// Covered now: greenhouse (boards-api) + ashby (posting-api) — the slug-templated boards.
// `custom`/`verify` ATSes need bespoke adapters → returned as status "unsupported".
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { companies, postings } from "../db/schema";
import { TRACKER_STAGES } from "@landed/shared/pipeline/stages";
import { canonical, norm } from "@landed/shared/agents/canonical";
import { getProfile } from "../db/profile";
import { isCompanyCooling } from "../db/cooldown";
import { termMatcher } from "@landed/shared/jobs/exclude";
// stripHtml lives in `shared` so the triage panel can reuse its entity decoding to repair JDs that
// were stored before the double-decode fix — without re-scanning every board.
import { stripHtml } from "@landed/shared/jobs/jd";
import { coerceLadderMap, type LadderMap } from "@landed/shared/config/ladder";

export type ScannedJob = {
  company: string;
  title: string;
  location: string | null;
  url: string | null;
  atsId: string | null;
  updatedAt: string | null;
  team: string | null;
  department: string | null; // ATS department/category — drives the engineering-discipline filter
  jd?: string | null; // plain text; included on the per-company drill-down (withJd), not the overview
};

export type ScanResult = {
  company: string;
  ats: string | null;
  // ok = app scanned it (fetchMethod api). manual = the agent fetches it itself (careers-get/
  // browser) — fetchMethod/careersUrl/fetchRecipe tell it how. unsupported = needs research.
  status: "ok" | "manual" | "unsupported" | "error";
  fetched: number; // total jobs on the board (api only)
  matched: ScannedJob[]; // after filter + dedup (api only)
  duplicates: number; // matched the filter but already tracked
  // present on status:"manual" — the instructions for the agent's own fetch
  fetchMethod?: string | null;
  careersUrl?: string | null;
  fetchRecipe?: string | null;
  // The company's rung → seniority mapping (stage 2a), handed over WITH the shortlist so the glance
  // can make a level call without a second lookup. null = never researched, which is not the same as
  // an empty ladder: the glance must treat "no map" as "keep, I can't judge level here".
  ladderMap?: LadderMap | null;
  error?: string;
};

const TIMEOUT_MS = 15000;
async function getJSON(url: string): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(t);
  }
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// --- lenient mechanical filter (coarse pre-filter; the agent's glance is the real one) -------
// The title-token machinery that used to live here (TITLE_SYNONYMS / titleTokens / matchesTitle /
// isQuant, plus the ENG_POS_TITLE + ENG_DEPT discipline check) is GONE, not disabled. Seniority and
// discipline are stage-2 judgments now — see classifyJob's note — and a dead code path that still
// compiles is an invitation to wire it back up by accident.
// Location is decided entirely by the profile: `locations` (where you'll work), `excludeLocationTerms`
// (locales out of range even when a posting says "remote") and `allowLocationTerms` (what re-admits a
// posting that names both, e.g. a dual US/Canada listing). The spellings a city goes by belong in
// `locations` as well — there is no alias table, so a short form matches because it's written there.
export type LocationFilter = {
  include: (s: string) => boolean; // in your target locations — always true when you set none
  exclude: (s: string) => boolean;
  allow: (s: string) => boolean;
  guard: boolean; // whether the excluded-locale guard applies at all
};

// Split on both `|` and `,` so either format tokenizes: the profile's prose ("New York, Remote")
// and the pipe form ("New York City|Brooklyn").
const locTokens = (loc: string): string[] => loc.split(/[|,]/).map((p) => p.trim()).filter(Boolean);

function matchesLocation(loc: string | null, f: LocationFilter): boolean {
  if (!loc) return true; // unknown location → keep (don't silently drop)
  // The guard runs FIRST, even with no target tokens: an excluded locale drops even when it says
  // "remote", unless the posting also carries an allow term (dual listings stay).
  if (f.guard && f.exclude(loc) && !f.allow(loc)) return false;
  return f.include(loc);
}

// The location gate, compiled once per scan from the profile — the same `locations` the fit pass
// reads, NOT a per-company field, so every company scans against one location identity. Shared by
// the scan classifier and the non-local purge so both decide "is this role in range?" identically.
// The guard stands down when your own target names an excluded locale with no allow term: you asked
// for that place.
function locFilter(): LocationFilter {
  const p = getProfile();
  const loc = p.locations?.trim() ?? "";
  const tokens = loc ? locTokens(loc) : [];
  const exclude = termMatcher(p.excludeLocationTerms);
  const allow = termMatcher(p.allowLocationTerms);
  return {
    // No target locations means no city criterion — the guard alone decides.
    include: tokens.length ? termMatcher(tokens) : () => true,
    exclude,
    allow,
    guard: !(loc && exclude(loc) && !allow(loc)),
  };
}

// The stored ladder map, or null. Unreadable JSON is indistinguishable from absent — both mean the
// glance has nothing to judge level against, and both must read as "keep".
function readLadderMap(raw: string | null): LadderMap | null {
  if (!raw) return null;
  try {
    return coerceLadderMap(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Drop rows from the Filtered / Discarded archive piles whose location is outside the target. We
// ignore non-local roles entirely (the scan never files them — see classifyJob's "location" gate),
// so they shouldn't linger in the archive either; this also sweeps stale rows no longer in the feed.
// Only these two archive states are touched — an active/manual decision (queued/applied/…) is never
// deleted. Returns how many rows were removed.
export function purgeNonLocal(companyId: number, f: LocationFilter): number {
  const rows = db
    .select()
    .from(postings)
    .where(and(eq(postings.companyId, companyId), inArray(postings.state, ["filtered", "dismissed"])))
    .all();
  const stale = rows.filter((r) => !matchesLocation(r.location, f)).map((r) => r.id);
  if (stale.length) db.delete(postings).where(inArray(postings.id, stale)).run();
  return stale.length;
}

// Sweep every company's archive piles for non-local roles in one pass (the one-shot backfill behind
// `npm run purge:nonlocal`; ongoing scans purge their own company incrementally). Returns the total.
export function purgeAllNonLocal(): number {
  const cos = db.select().from(companies).all();
  const f = locFilter();
  let total = 0;
  for (const co of cos) {
    total += purgeNonLocal(co.id, f);
  }
  return total;
}

// --- per-ATS list fetchers -----------------------------------------------------------------
async function listGreenhouse(slug: string, company: string): Promise<ScannedJob[]> {
  // /jobs is the canonical lightweight list; /departments gives each job's department (the
  // /jobs list omits it). Build a jobId→department map to drive the discipline filter.
  const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`;
  const [data, deptData] = await Promise.all([
    getJSON(`${base}/jobs`),
    getJSON(`${base}/departments`).catch(() => ({ departments: [] as unknown[] })),
  ]);
  const deptOf = new Map<string, string>();
  for (const d of (deptData.departments as { name?: string; jobs?: { id?: unknown }[] }[]) ?? [])
    for (const j of d.jobs ?? []) if (j.id != null && d.name) deptOf.set(String(j.id), d.name);

  const jobs = (data.jobs as Record<string, unknown>[]) ?? [];
  return jobs.map((j) => {
    const dept = j.id != null ? deptOf.get(String(j.id)) ?? null : null;
    return {
      company,
      title: String(j.title ?? ""),
      location: (j.location as { name?: string } | null)?.name ?? null,
      url: (j.absolute_url as string) ?? null,
      atsId: j.id != null ? String(j.id) : null,
      updatedAt: (j.updated_at as string) ?? null,
      team: dept,
      department: dept,
    };
  });
}
async function greenhouseJD(slug: string, id: string): Promise<string | null> {
  try {
    const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${id}`);
    return stripHtml(d.content as string);
  } catch {
    return null;
  }
}
async function listAshby(slug: string, company: string): Promise<ScannedJob[]> {
  const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
  const jobs = (data.jobs as Record<string, unknown>[]) ?? [];
  return jobs.map((j) => {
    const department = (j.department as string) ?? (j.departmentName as string) ?? null;
    return {
      company,
      title: String(j.title ?? ""),
      location: (j.location as string) ?? null,
      url: (j.jobUrl as string) ?? (j.applyUrl as string) ?? null,
      atsId: j.id != null ? String(j.id) : null,
      updatedAt: (j.publishedAt as string) ?? null,
      team: (j.team as string) ?? (j.teamName as string) ?? department,
      department,
      jd: stripHtml(j.descriptionHtml as string) ?? (j.descriptionPlain ? String(j.descriptionPlain).slice(0, 12000) : null),
    };
  });
}

// Per-job verdict for the scan store: the FIRST gate it fails, else "kept".
//
// Stage 1 of the cascade, and ONLY the decisions a regex over a title can actually make with
// confidence. Two former gates were removed here rather than tuned:
//
//   `level`     — a substring match against the company's `targetTitles`, a list written once at
//                 add-time and never revisited, so its strictness was arbitrary. Airbnb's
//                 ["Senior"] dropped every Staff role; Anthropic's dropped every unlevelled title;
//                 Jane Street's empty list filtered nothing at all. 150 postings died there in four
//                 weeks. Seniority is now judged at 2b, which has the company's rung mapping
//                 (ladder_map) instead of a word list.
//   `unmatched` — "no positive SWE signal" is the ABSENCE of evidence, not evidence of a bad role.
//                 It caught "AI Research Engineer" and "Performance Engineer" as readily as junk.
//                 Those now reach 2c and get ranked low, which is observable; a drop isn't.
//
// What stayed is what a title can settle: a clear non-engineering term, a location outside the target,
// and a posting already tracked as an application. The title terms alone carry 1207 of the drops —
// moving them to the agent would have flooded it with non-engineering roles for no recall gain. Both
// term lists are the profile's (excludeTitleTerms, the location fields); this function holds none.
type ScanReason = "kept" | "excluded" | "location" | "dedup";
function classifyJob(
  j: ScannedJob,
  o: { locGate: LocationFilter; excludeTitle: (s: string) => boolean; roleSet: Set<string>; urlSet: Set<string> }
): ScanReason {
  const hay = `${j.title} ${j.department ?? ""}`;
  if (o.excludeTitle(hay)) return "excluded"; // a profile title term → confident drop
  if (!matchesLocation(j.location, o.locGate)) return "location";
  if (o.roleSet.has(norm(j.title)) || (j.url && o.urlSet.has(j.url))) return "dedup"; // already a tracked application
  return "kept";
}

// Persist every fetched job to scanned_postings (the triage store), upserting by (company,
// atsId). Refresh the verdict/fields each scan but PRESERVE the triage state: a manual
// decision (matched/queued/dismissed) sticks; a `dedup` (now an application) becomes `queued`.
function persistScan(companyId: number, verdicts: { j: ScannedJob; reason: ScanReason }[], prior: Map<string, string>, seenRoles: Set<string>, seenUrls: Set<string>): void {
  const at = new Date().toISOString();
  db.transaction((tx) => {
    for (const { j, reason } of verdicts) {
      if (!j.atsId) continue; // need the dedup key
      // Non-local role → ignore entirely: never file it in the triage store (not even as Filtered).
      // Existing rows for it are swept by purgeNonLocal after this. (A prior manual decision in an
      // active pile is left alone — purgeNonLocal only touches Filtered / Discarded.)
      if (reason === "location") continue;
      // Preserve a manual/glance/fit decision across rescans; legacy tracked/queued → fit_queue.
      // A fresh row writes its step directly: dedup → applied · kept → matched (awaiting glance) ·
      // dropped → filtered (rigid pre-filter drop).
      const PRESERVE = new Set(["matched", "review", "dismissed", "fit_queue", "assessed", "apply_later", "tailoring", "tailored", "applied"]);
      const raw = prior.get(j.atsId);
      const prev = raw === "tracked" || raw === "queued" ? "fit_queue" : raw;
      // A FRESH listing (new ATS id, no prior row) whose role/url already sits in a triaged /
      // in-pipeline / discarded pile is a re-post of something you've already handled — don't file
      // it as a new scan result. (Same-id rows are preserved via `prev`; applied-role matches are
      // handled earlier by classifyJob's `dedup`.)
      if (!prev && reason === "kept" && (seenRoles.has(norm(j.title)) || (j.url != null && seenUrls.has(j.url)))) continue;
      const state = (prev && PRESERVE.has(prev)
        ? prev
        : reason === "dedup" ? "applied" : reason === "kept" ? "matched" : "filtered") as "filtered" | "matched" | "review" | "dismissed" | "fit_queue" | "assessed" | "apply_later" | "tailoring" | "tailored" | "applied";
      const verdict = (reason === "kept" ? "kept" : "dropped") as "kept" | "dropped";
      const reasonVal = reason === "kept" ? null : reason;
      // `discoveredAt` is in `values` but deliberately NOT in the conflict `set`: it is the
      // FIRST-seen stamp, so only an insert may write it. `scannedAt` is the opposite — refreshed
      // every pass, which is why it records the last scan and can't order a board by age. The eval
      // needs first-seen to reconstruct what was on a company's board when.
      tx.insert(postings)
        .values({ companyId, atsId: j.atsId, title: j.title, location: j.location, url: j.url, department: j.department, verdict, reason: reasonVal, state, scannedAt: at, discoveredAt: at, postedAt: j.updatedAt })
        .onConflictDoUpdate({
          target: [postings.companyId, postings.atsId],
          set: { title: j.title, location: j.location, url: j.url, department: j.department, verdict, reason: reasonVal, state, scannedAt: at, postedAt: j.updatedAt },
        })
        .run();
    }
  });
}

// --- scan one company ----------------------------------------------------------------------
export async function scanCompany(name: string, withJd = true): Promise<ScanResult> {
  const c = canonical(name);
  const co = c ? db.select().from(companies).all().find((x) => canonical(x.name)?.key === c.key) : null;
  if (!co)
    return { company: name, ats: null, status: "error", fetched: 0, matched: [], duplicates: 0, error: "company not found" };

  const ats = (co.ats ?? "").toLowerCase();
  const isGh = ats === "greenhouse";
  const hasAtsApi = (isGh || ats === "ashby") && !!co.slug;
  // fetchMethod is the switch. Default to "api" when it's unset but a greenhouse/ashby slug
  // exists (unresearched ATS companies still get app-scanned); otherwise it's unresolved.
  const method = (co.fetchMethod ?? "").toLowerCase() || (hasAtsApi ? "api" : "");

  // careers-get / browser → the agent fetches it itself; the app returns the recipe, not a scan.
  if (method === "careers-get" || method === "browser") {
    return {
      company: co.name, ats: co.ats ?? null, status: "manual", fetched: 0, matched: [], duplicates: 0,
      fetchMethod: method, careersUrl: co.careersUrl ?? null, fetchRecipe: co.fetchRecipe ?? null,
    };
  }
  // Anything that isn't a real api lane → needs research (no method + no slug, or api w/o slug).
  if (method !== "api" || !hasAtsApi)
    return {
      company: co.name, ats: co.ats ?? null, status: "unsupported", fetched: 0, matched: [], duplicates: 0,
      error: method === "api" ? `fetchMethod=api but missing ${ats || "ats"} slug` : "no fetchMethod and no greenhouse/ashby slug — needs research",
    };

  try {
    const jobs = isGh ? await listGreenhouse(co.slug!, co.name) : await listAshby(co.slug!, co.name);
    const fetched = jobs.length;

    // Both stage-1 gates compiled once per scan from the profile, not per posting.
    const locGate = locFilter();
    const excludeTitle = termMatcher(getProfile().excludeTitleTerms);
    const ladderMap = readLadderMap(co.ladderMap);

    // This company's existing postings — one fetch drives prior-state preservation, application
    // dedup, and re-post dedup.
    const existing = db.select().from(postings).where(eq(postings.companyId, co.id)).all();
    const prior = new Map(existing.map((r) => [r.atsId ?? "", r.state]));

    // Application dedup: a fetched job matching a TRACKED application (applied+) by role/url →
    // classifyJob marks it `dedup` (filed as applied, not a new result).
    const apps = existing.filter((r) => (TRACKER_STAGES as readonly string[]).includes(r.state));
    const roleSet = new Set(apps.map((a) => norm(a.title ?? "")));
    const urlSet = new Set(apps.map((a) => a.url).filter(Boolean) as string[]);

    // Re-post dedup: everything already TRIAGED / in-pipeline / discarded (the candidate states). A
    // fresh listing (new ATS id) matching one of these by role/url is dropped in persistScan, so a
    // role you've already handled doesn't resurface as a new scan result.
    const SEEN_STATES = ["matched", "review", "dismissed", "fit_queue", "assessed", "apply_later", "tailoring", "tailored"];
    const seen = existing.filter((r) => SEEN_STATES.includes(r.state));
    const seenRoles = new Set(seen.map((r) => norm(r.title ?? "")));
    const seenUrls = new Set(seen.map((r) => r.url).filter(Boolean) as string[]);

    const verdicts = jobs.map((j) => ({ j, reason: classifyJob(j, { locGate, excludeTitle, roleSet, urlSet }) }));
    persistScan(co.id, verdicts, prior, seenRoles, seenUrls);
    // Non-local roles are never filed (persistScan skips the "location" reason); also clear any that
    // lingered in this company's Filtered / Discarded piles from before this rule (or now off the feed).
    purgeNonLocal(co.id, locGate);

    // the live shortlist = kept jobs not already dismissed in the triage store
    const matched = verdicts.filter((v) => v.reason === "kept" && prior.get(v.j.atsId ?? "") !== "dismissed").map((v) => v.j);
    const duplicates = verdicts.filter((v) => v.reason === "dedup").length;

    // JD for the matched shortlist (greenhouse needs a per-job fetch; ashby already has it)
    if (withJd && isGh) {
      for (const batch of chunk(matched, 5)) {
        await Promise.all(batch.map(async (j) => { if (j.atsId) j.jd = await greenhouseJD(co.slug!, j.atsId); }));
      }
    }
    if (!withJd) for (const j of matched) delete j.jd;

    // Persist the JD on the kept postings so fit + tailoring reuse it (no re-fetch downstream).
    for (const j of matched) {
      if (j.atsId && j.jd) db.update(postings).set({ jd: j.jd }).where(and(eq(postings.companyId, co.id), eq(postings.atsId, j.atsId))).run();
    }

    db.update(companies).set({ lastScrapedAt: new Date().toISOString() }).where(eq(companies.id, co.id)).run();
    return { company: co.name, ats: co.ats ?? null, status: "ok", fetched, matched, duplicates, ladderMap };
  } catch (e) {
    return { company: co.name, ats: co.ats ?? null, status: "error", fetched: 0, matched: [], duplicates: 0, error: String((e as Error)?.message ?? e) };
  }
}

// --- scan the whole watchlist (overview: no JDs — drill into a company with scanCompany) ----
// `staleDays` limits the scan to companies last scraped more than N days ago (or never) — used by
// the app's "Scrape watchlist" button so a refresh skips companies already scraped recently.
export async function scanWatchlist(opts: { staleDays?: number } = {}): Promise<ScanResult[]> {
  let wl = db.select().from(companies).where(eq(companies.watchlist, true)).all()
    .filter((co) => !isCompanyCooling(co)); // cooling off after a rejection → not scanned at all
  if (opts.staleDays != null) {
    const cutoff = Date.now() - opts.staleDays * 86_400_000;
    wl = wl.filter((co) => !co.lastScrapedAt || new Date(co.lastScrapedAt).getTime() < cutoff);
  }
  const out: ScanResult[] = [];
  for (const batch of chunk(wl, 4)) out.push(...(await Promise.all(batch.map((co) => scanCompany(co.name, false)))));
  return out;
}
