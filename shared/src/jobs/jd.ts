// Job descriptions: turning an ATS's escaped HTML into text, and that text into blocks a page can
// render legibly.
//
// It lives in `shared` because both ends need it — the scan writes JDs with `stripHtml`, and the
// triage panel repairs and lays out what's already stored. Pure, so both are testable.

// Named entities worth handling: the ones these boards actually emit. A full table would be dead
// weight; anything unrecognized is left as written rather than mangled.
const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·",
};

function decodeOnce(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const n = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole; // unknown entity → leave it visible, don't guess
  });
}

// Decode entities, twice.
//
// Greenhouse `content` is DOUBLE-encoded — the markup is escaped (`&lt;p&gt;`) and the entities
// inside it are escaped again (`&amp;nbsp;`). A single pass turns `&amp;nbsp;` into `&nbsp;`, which
// is then too late for the rule that would have handled it, so the literal text `&nbsp;` leaked into
// every stored JD. A second pass finishes the job.
//
// Running twice is safe for ordinary text: after the first pass a genuine `&` is a bare ampersand,
// and a bare ampersand is not an entity, so the second pass leaves it alone ("Trust & Safety" stays).
export function decodeEntities(s: string): string {
  return decodeOnce(decodeOnce(s));
}

// Escaped HTML → plain text that keeps its shape. Block tags and <br> become newlines, <li> becomes
// a bullet, and the rest of the tags go. Returns null when nothing readable survives, so a caller
// can tell "no description" from an empty one.
export function stripHtml(html?: string | null): string | null {
  if (!html) return null;
  // (1) reveal the structure hiding behind the escaping,
  let s = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  // (2) turn the structural tags into text shape BEFORE stripping,
  s = s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*(?:p|div|ul|ol|h[1-6]|tr|section|header|footer|blockquote)\s*>/gi, "\n")
    .replace(/<\s*(?:p|div|h[1-6]|tr|section|ul|ol)[^>]*>/gi, "\n");
  // (3) strip what's left, quote-aware so a `>` inside an attribute (class="[&>p]:mb-2") doesn't
  //     end a tag early,
  s = s.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " ");
  // (4) decode text-level entities, then (5) tidy whitespace while KEEPING newlines.
  s = decodeEntities(s)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s ? s.slice(0, 12000) : null;
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────
// A JD as typed blocks. Rendering one pre-wrapped string makes every line look the same, which is
// why these read as a wall — headings, prose and bullets all get the same weight.
export type JdBlock =
  | { type: "h"; text: string; items?: undefined }
  | { type: "p"; text: string; items?: undefined }
  | { type: "ul"; items: string[]; text?: undefined };

// Above this, a line is prose no matter how it's punctuated. These JDs write their section headings
// as short unpunctuated lines ("Our Mission", "Your Impact") — by this point there are no <h*> tags
// left to go on, so length and punctuation are the only signal available.
const HEADING_MAX = 60;

const isBullet = (l: string) => /^\s*[•\-–]\s+/.test(l);
const stripBullet = (l: string) => l.replace(/^\s*[•\-–]\s+/, "").trim();

export function jdBlocks(text: string): JdBlock[] {
  // Repair on the way out: JDs stored before the double-decode fix still carry a literal `&nbsp;`,
  // and re-scanning every board just to read them would be absurd.
  const lines = decodeEntities(text ?? "").split("\n");
  const out: JdBlock[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length) out.push({ type: "ul", items: bullets });
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (isBullet(line)) { bullets.push(stripBullet(line)); continue; }
    flush();
    // A heading is short, and doesn't end like a sentence.
    const heading = line.length <= HEADING_MAX && !/[.:;,!?]$/.test(line);
    out.push({ type: heading ? "h" : "p", text: line });
  }
  flush();
  return out;
}
