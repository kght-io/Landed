// Pure helpers for the Leetcode tracker's manual-add flow and topic grouping. Kept db-free so the
// URL parsing / grouping is directly unit-testable and safe to import from both server and client.

// Parse a LeetCode problem URL into its slug + a provisional (title-cased) name. Returns null when
// the URL isn't a LeetCode problem link. The real name/difficulty are filled later by the
// leetcode-add enrich job — this just gives the stub something to show immediately.
export function parseLeetcodeUrl(raw: string): { slug: string; name: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)leetcode\.(com|cn)$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/problems\/([a-z0-9-]+)/i);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  return { slug, name: titleCase(slug) };
}

// "two-sum" → "Two Sum"; "goldman-sachs" → "Goldman Sachs".
function titleCase(slugged: string): string {
  return slugged
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// Display name for a company slug tag on a question chip.
export const prettyCompany = (slug: string): string => titleCase(slug);

// The topic a coding question groups under in the unified tracker: its curriculum pattern if it has
// one, else its first tag (manual/company questions), else a catch-all bucket.
export function questionTopic(q: { plan?: { pattern?: string }; tags?: string[] }): string {
  return q.plan?.pattern?.trim() || q.tags?.find((t) => t.trim())?.trim() || "Uncategorized";
}
