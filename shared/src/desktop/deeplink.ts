// The `landed://` URLs the web app hands to the browser.
//
// Builders live in shared/ because BOTH sides need them and neither owns them: the web app emits
// these links, the desktop app parses them (desktop/src/deeplink.ts), and the two must agree about
// a string that crosses an OS boundary with no schema and no handshake. tests/deeplink.test.ts
// pins them together by round-tripping every builder through the parser.
//
// Strings only — no electron, no node. This ships to the browser.

export const deepLink = {
  /** Reveal the folder the user chose. */
  revealAssets: (): string => "landed://reveal/assets",
  /** Reveal a tailored résumé's folder, by company slug. */
  revealResume: (slug: string): string => `landed://reveal/resume/${encodeURIComponent(slug)}`,
  /** Reveal a company's interview-prep folder, by company slug. */
  revealPrep: (slug: string): string => `landed://reveal/prep/${encodeURIComponent(slug)}`,
  /** Open the desktop app's agent view, optionally scrolled to one run type. */
  agent: (type?: string): string => (type ? `landed://agent/${encodeURIComponent(type)}` : "landed://agent"),
};
