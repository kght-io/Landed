// Shared exclude filter — the title/department patterns that disqualify a posting regardless of
// who fetched it. Applied by the app's api scan (lib/jobs/scan.ts) AND enforced server-side on
// every glance submission (applyGlance), so careers-get/browser fetches get the exact same
// exclusion as api without the agent re-implementing it per method.
//
// Order: GTM/field, people-management + program/TPM (IC only), security, non-eng job families,
// hardware/IT (we want SOFTWARE IC), and a junior floor. NOT bare "operations" (would kill
// AIOps/SecOps/User-Operations SWE). "business engineer" as a phrase so "Business Platform" SWE survives.
export const NON_ENG =
  /\b(solutions?|sales|field|forward[- ]deployed|customer success|support|professional services|delivery|implementation|technical account|partner|manager|director|program manager|tpm|gtm|go[- ]to[- ]market|recruit\w*|account executive|marketing|finance|legal|people|talent|designer|associate|strategy|business engineer|specialist|analyst|data scien\w*|security|writer|educator|counsel|accountant|asic|fpga|hardware|firmware|electrical|sysadmin|systems administrator|desktop|help ?desk|it support|it operations|network engineer\w*|windows|unified comm\w*|junior|intern|apprentice|new grad|early career)\b|\bdata ?cent(?:er|re)\b/i;

// True if the title (+ optional department) matches an excluded family.
export function isExcludedTitle(title: string, department?: string | null): boolean {
  return NON_ENG.test(`${title} ${department ?? ""}`);
}
