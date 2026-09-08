// Shared exclude filter — the title/department patterns that disqualify a posting regardless of
// who fetched it. Applied by the app's api scan (backend/src/jobs/scan.ts) AND enforced server-side on
// every glance submission (applyGlance), so careers-get/browser fetches get the exact same
// exclusion as api without the agent re-implementing it per method.
//
// "head of" is a PHRASE, not the bare word: `\bhead\b` would take real IC titles with it
// (Headless Commerce, Headcount Platform, Overhead Reduction). It was added after a scan surfaced
// "Head of Music" for triage — same leadership family as manager/director, different noun.
//
// Order: GTM/field, people-management + program/TPM (IC only), security, non-eng job families,
// hardware/IT (we want SOFTWARE IC), and a junior floor. NOT bare "operations" (would kill
// AIOps/SecOps/User-Operations SWE). "business engineer" as a phrase so "Business Platform" SWE survives.
export const NON_ENG =
  /\b(solutions?|sales|field|forward[- ]deployed|customer success|support|professional services|delivery|implementation|technical account|partner|manager|director|head of|program manager|tpm|gtm|go[- ]to[- ]market|recruit\w*|account executive|marketing|finance|legal|people|talent|designer|associate|strategy|business engineer|specialist|analyst|data scien\w*|security|writer|educator|counsel|accountant|asic|fpga|hardware|firmware|electrical|sysadmin|systems administrator|desktop|help ?desk|it support|it operations|network engineer\w*|windows|unified comm\w*|junior|intern|apprentice|new grad|early career)\b|\bdata ?cent(?:er|re)\b/i;

// True if the title (+ optional department) matches an excluded family.
export function isExcludedTitle(title: string, department?: string | null): boolean {
  return NON_ENG.test(`${title} ${department ?? ""}`);
}
