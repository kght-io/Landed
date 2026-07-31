// Company-name canonicalization shared by all ingest sources.
// Merges known variants, drops junk. Returns null to drop a row entirely.
import { isTarget } from "../targets.mjs";

export const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const QUOTES = /^["']|["']$/g; // surrounding quotes
const PARENS = /\s*\([^)]*\)\s*/g; // "DeepMind (Google)" → "DeepMind"
const LEGAL_SUFFIX = /[,\s]+(inc|llc|corp|co|ltd|gmbh|plc)\.?$/i;
const WHITESPACE = /\s+/g;

// Defensive cleanup for whatever the agent emits. The playbooks ask Claude to write
// canonical brand names; this strips the formatting noise we can fix without knowing
// the brand (parenthetical qualifiers, legal suffixes, stray quotes/whitespace).
// Casing is left to Claude — we can't reliably re-case "openai" vs "OpenAI" in code.
function cleanName(raw: string): string {
  return (raw || "")
    .replace(QUOTES, "")
    .replace(PARENS, " ")
    .replace(LEGAL_SUFFIX, "")
    .replace(WHITESPACE, " ")
    .trim();
}

// Known variants → one canonical { key, name }. Keyed by norm() of the variant.
const VARIANTS: Record<string, { key: string; name: string }> = {
  peregrine: { key: "peregrine", name: "Peregrine Technologies" },
  peregrinetechnologies: { key: "peregrine", name: "Peregrine Technologies" },
  langchain: { key: "langchain", name: "LangChain" },
  langchainsenior: { key: "langchain", name: "LangChain" },
  scaleai: { key: "scaleai", name: "Scale AI" },
  normai: { key: "normai", name: "Norm AI" },
  // DeepMind is a team within Google, not a separate company — roll it up to Google.
  deepmind: { key: "google", name: "Google" },
  googledeepmind: { key: "google", name: "Google" },
  deepmindgoogle: { key: "google", name: "Google" },
};

export function canonical(rawName: string): { key: string; name: string } | null {
  const name = cleanName(rawName);
  const k = norm(name);
  if (k === "seniorsoftwareengineer" || k === "") return null; // junk, no company
  return VARIANTS[k] ?? { key: k, name };
}

// Default tier for a brand-new company (the user re-tiers via drag-drop): known targets land
// in tier2, everything else in tier3. tier1 (top target) is only ever set by hand.
// The target list lives in lib/targets.mjs — customize it there.
export const defaultTier = (key: string): "tier2" | "tier3" =>
  isTarget(key) ? "tier2" : "tier3";
