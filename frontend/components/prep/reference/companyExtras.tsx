import type { ReactNode } from "react";

// Hand-curated reference extras for a company's prep view, keyed by slug. Most companies are
// fully data-driven from their the agent research profile; this is the escape hatch for the rare
// company that warrants bespoke, hand-built reference material richer than the generic profile
// overview. Rendered as an extra tab by CompanyPrep. Empty for any company without an entry.
export const COMPANY_EXTRAS: Record<string, { label: string; node: ReactNode }> = {};
