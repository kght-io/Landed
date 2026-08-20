// THE FRONT DOOR — and the only one the browser has.
//
// Registering `landed://` lets a web page reach this app without a localhost server: the OS routes
// the URL. That removes CORS, mixed content, and Private Network Access from the design in one go.
// It also means the door is unauthenticated by construction — ANY page can navigate to a
// `landed://` URL, and the OS will hand it over. So every link is untrusted input arriving with the
// user's own privileges, and this file is the whole gate.
//
// Two rules follow, and both are load-bearing:
//   1. Parse to a CLOSED SET of intents, never to a path. A deep link can say "reveal the résumé
//      folder for slug X"; it can never say "reveal /Users/me/.ssh". The caller resolves the slug
//      against the chosen root, so the worst a hostile link can do is open a folder the user
//      already granted.
//   2. Refuse rather than sanitise. Stripping `..` out of a slug still yields a slug that resolves
//      to SOME folder, and silently revealing the wrong one is worse than doing nothing.
//
// Pure on purpose — no electron import — so the rules above are testable without a running app.

export type DeepLink =
  | { action: "reveal"; target: { kind: "assets" } | { kind: "resume"; slug: string } | { kind: "prep"; slug: string } }
  | { action: "agent"; type: string | null };

// A slug names one folder inside the chosen root. Anything that could mean "somewhere else" — a
// separator, a traversal, an encoded one, an empty string — is not a slug.
// The app's slug is a PATH, not a single name: tailoring writes versioned folders like
// "acme-senior-123/v2" (see backend/src/config.ts resolveResume, which allows any slug that stays
// inside the resume dir). So the rule is per SEGMENT — each one shaped like the slugs
// backend/src/db/prep.ts's companySlug generates — with no empty segments, no traversal, and no leading
// slash. Narrow enough that containment falls out of the charset instead of needing a realpath.
const SLUG = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const isSlug = (s: string): boolean => SLUG.test(s);

/**
 * Parse a `landed://` URL into an intent, or null if it is not one we honour.
 *
 * Never throws: this runs on input the user did not type, from a browser we do not control, and a
 * crash in the handler is a crash of the whole app.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "landed:") return null;

  // `landed://reveal/resume/acme` parses with host="reveal" and pathname="/resume/acme", so the
  // action is the host and the rest is the path. Decoding happens exactly once, here, and the
  // decoded parts are then validated — decoding after validation would let %2e%2e through.
  const action = url.hostname;
  let parts: string[];
  try {
    // Drop ONLY the empty produced by the leading slash. filter(Boolean) would also swallow "//",
    // quietly turning a malformed path into a valid one — the sanitising this parser refuses to do.
    const raw = url.pathname.split("/");
    if (raw[0] === "") raw.shift();
    if (raw.some((p) => p === "")) return null;
    parts = raw.map(decodeURIComponent);
  } catch {
    return null; // malformed percent-encoding
  }

  if (action === "agent") return { action: "agent", type: parts.length === 0 ? null : (isSlug(parts[0]) ? parts[0] : null) };

  if (action === "reveal") {
    const [kind, ...tail] = parts;
    if (kind === "assets" && tail.length === 0) return { action: "reveal", target: { kind: "assets" } };
    // Rejoined rather than refused: a tailored résumé lives at "<slug>/v2", so the slug legitimately
    // spans segments. isSlug is what keeps that from meaning "any path".
    const slug = tail.join("/");
    if ((kind === "resume" || kind === "prep") && slug !== "" && isSlug(slug)) {
      return { action: "reveal", target: { kind, slug } };
    }
    return null;
  }

  return null;
}
