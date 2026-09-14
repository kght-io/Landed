// The stage-1 scan filter's INSTALL DEFAULTS — the starting contents of the profile's
// `excludeTitleTerms`, `excludeLocationTerms` and `allowLocationTerms`. The filter itself reads the
// profile (backend/src/db/profile.ts), never these constants; they're only what a profile that has
// never set the lists starts from.
//
// Term for term, they're what the retired hardcoded regexes matched, so an existing install and a
// fresh one filter identically until someone edits a list. Grammar: whole words, hyphen ≡ space,
// trailing `*` = word stem (shared/src/jobs/exclude.ts).
//
// In `shared` rather than next to DEFAULT_PROFILE because importing the profile module opens the
// database — the demo seed has to build a Profile before it has pointed DB_PATH anywhere safe.

export const DEFAULT_EXCLUDE_TITLE_TERMS: readonly string[] = [
  // go-to-market / field
  "solution*", "sales", "field", "forward deployed", "customer success", "support", "professional services",
  "delivery", "implementation", "technical account", "partner", "gtm", "go to market", "account executive",
  // people management + program (IC search). `head of` is a phrase: bare `head` would take Headless/Overhead.
  "manager", "director", "head of", "program manager", "tpm",
  // non-engineering job families
  "recruit*", "marketing", "finance", "legal", "people", "talent", "designer", "associate", "strategy",
  "business engineer", "specialist", "analyst", "data scien*", "security", "writer", "educator", "counsel", "accountant",
  // hardware / IT — this is a SOFTWARE search
  "asic", "fpga", "hardware", "firmware", "electrical", "sysadmin", "systems administrator", "desktop",
  "help desk", "helpdesk", "it support", "it operations", "network engineer*", "windows", "unified comm*",
  "data center", "datacenter", "data centre", "datacentre",
  // junior floor
  "junior", "intern", "apprentice", "new grad", "early career",
];

// Locales out of range even when a posting says "remote".
export const DEFAULT_EXCLUDE_LOCATION_TERMS: readonly string[] = [
  "canada", "canadian", "can", "british columbia", "bc", "alberta", "calgary", "edmonton", "waterloo", "kitchener",
  "toronto", "vancouver", "montreal", "ottawa", "ontario", "quebec",
  "united kingdom", "uk", "london", "england", "scotland", "ireland", "dublin",
  "germany", "berlin", "munich", "france", "paris", "netherlands", "amsterdam", "spain", "barcelona", "madrid",
  "portugal", "lisbon", "poland", "warsaw", "switzerland", "zurich", "sweden", "stockholm",
  "singapore", "japan", "tokyo", "china", "shanghai", "hong kong", "india", "bangalore", "bengaluru", "hyderabad", "pune",
  "australia", "sydney", "melbourne", "new zealand", "israel", "tel aviv",
  "brazil", "mexico", "argentina", "colombia", "emea", "apac", "latam",
];

// What re-admits a posting that also names an excluded locale — a dual "Remote - US/Canada" listing.
export const DEFAULT_ALLOW_LOCATION_TERMS: readonly string[] = [
  "united states", "usa", "u.s.", "us", "new york", "nyc", "san francisco", "seattle", "austin", "boston",
  "chicago", "los angeles", "denver", "atlanta", "washington", "portland", "remote us", "us remote",
];
