// Stage 1's matching grammar — how a term typed on the Profile page becomes a match.
//
// There are no terms in this file. The non-engineering title terms, the locales that don't count as
// in range, and the signals that re-admit a dual-country listing are all profile data
// (backend/src/db/profile.ts); they used to be regexes here and in scan.ts, which made a preference
// something only a code change could see or edit. What stays in code is the grammar, because it is
// the contract between what you type and what gets dropped:
//
//   whole words, case-insensitive     `sales` drops "Sales Engineer", not "Salesforce Platform"
//   a phrase matches as a phrase      `head of` drops "Head of Music", not "Headless Commerce"
//   hyphen ≡ space                    `go to market` also drops "Go-to-Market Engineer"
//   a trailing `*` is a word stem     `recruit*` drops "Recruiter" and "Recruiting"
//   everything else is literal        `remote (us)` is text, never regex syntax
//
// Applied by the api scan (backend/src/jobs/scan.ts) AND re-enforced on every glance submission
// (applyGlance), so every fetch method is filtered by the same list.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One term → one regex source, or null for a blank one.
//
// Word boundaries only work where a term's edge is a word character, so a term with a symbol at
// either end (`u.s.`, `c++`) gets a not-a-word-character guard instead. The leading guard consumes a
// character rather than looking behind — this is only ever `.test()`, so that costs nothing.
function termSource(raw: string): string | null {
  let t = raw.trim().toLowerCase();
  const stem = t.endsWith("*");
  if (stem) t = t.slice(0, -1).trimEnd();
  if (!t) return null;
  const body = t.split(/[\s-]+/).map(escape).join("[\\s-]+");
  const head = /^\w/.test(t) ? "\\b" : "(?:^|[^\\w])";
  const tail = stem ? "\\w*" : /\w$/.test(t) ? "\\b" : "(?!\\w)";
  return `${head}${body}${tail}`;
}

/** Compile a term list once into a predicate. An empty list matches nothing — there is no floor. */
export function termMatcher(terms: readonly string[]): (text: string) => boolean {
  const sources = terms.map(termSource).filter((s): s is string => s !== null);
  if (!sources.length) return () => false;
  const re = new RegExp(sources.map((s) => `(?:${s})`).join("|"), "i");
  return (text) => re.test(text);
}

/** True if the title (+ optional department) carries one of the profile's excluded title terms. */
export function isExcludedTitle(title: string, department: string | null | undefined, terms: readonly string[]): boolean {
  return termMatcher(terms)(`${title} ${department ?? ""}`);
}
