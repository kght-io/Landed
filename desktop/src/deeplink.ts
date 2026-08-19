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
// Exactly the shape backend/src/db/prep.ts:311 generates. Narrow by design: the smaller the set,
// the less there is to reason about when the input is hostile.
const SLUG = /^[a-z0-9-]+$/;
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
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null; // malformed percent-encoding
  }

  if (action === "agent") return { action: "agent", type: parts.length === 0 ? null : (isSlug(parts[0]) ? parts[0] : null) };

  if (action === "reveal") {
    const [kind, slug, ...rest] = parts;
    if (rest.length > 0) return null;
    if (kind === "assets" && slug === undefined) return { action: "reveal", target: { kind: "assets" } };
    if ((kind === "resume" || kind === "prep") && slug !== undefined && isSlug(slug)) {
      return { action: "reveal", target: { kind, slug } };
    }
    return null;
  }

  return null;
}
