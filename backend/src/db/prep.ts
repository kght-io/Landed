import { canonical } from "@landed/shared/agents/canonical";

// What is left of the retired question-research feature: the canonical company key that the
// interview-prep/<slug>/ folder, the asset jobs, the prep chat and the dumps all agree on.
//
// The prep_* tables it used to read are still in the schema, holding the rows they held when the
// feature was retired — nothing reads them now (the last reader, the "researched prep profile"
// section of context.md, went with it) and nothing writes them. See backend/src/db/schema.ts.

// Falls back to a plain slug when the name doesn't canonicalize, so an oddly-named company stays
// addressable rather than losing its folder.
const plainSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const companySlug = (name: string): string => canonical(name)?.key ?? plainSlug(name);
