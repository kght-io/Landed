// Default "target" companies — the seed for tiering a company the first time it's seen:
// a brand-new company whose normalized key is in this list lands in tier2 ("target"),
// everything else starts in tier3 (the broad "practice" pool). The tier is only a *default* —
// you can always re-tier any company in the UI (drag-drop) regardless of this list.
//
// Keys are normalized: lowercase, alphanumeric only (see norm() in lib/agents/canonical.ts),
// so "Hugging Face" and "huggingface" both match the key "huggingface".
//
// This is a STARTER list of well-known engineering orgs — CUSTOMIZE it for your own search.
// Shared by the app (lib/agents/canonical.ts) and the import/reconcile scripts so there's
// one source of truth.
export const TARGET_KEYS = [
  "google", "meta", "netflix", "apple", "microsoft", "anthropic",
  "openai", "airbnb", "figma", "github", "spotify", "confluent", "perplexity",
  "notion", "glean", "huggingface", "scaleai", "cursor", "datadog",
];

const TARGET_SET = new Set(TARGET_KEYS);

// True when a normalized company key is one of the default targets.
export const isTarget = (key) => TARGET_SET.has(key);
