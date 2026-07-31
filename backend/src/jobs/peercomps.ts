import type { PeerComp } from "@landed/shared/types";
import { getConfig, setConfig } from "../db/config-store";

// The peer-comp comparison is a single GLOBAL artifact (spans every active interviewing role), so it
// isn't tied to a posting — it lives as the latest generated markdown in app_config under
// PEER_COMP_KEY. Generation runs through the agent job queue (type "peer-comp", see registry.ts):
// the ingest writes the submitted markdown here. Each run overwrites the latest (no version history).

export const PEER_COMP_KEY = "peer_comp";

export function getPeerComp(): PeerComp | null {
  const raw = getConfig(PEER_COMP_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o.markdown === "string" ? (o as PeerComp) : null;
  } catch {
    return null;
  }
}

export function setPeerComp(markdown: string, generatedAt: string): PeerComp {
  const rec: PeerComp = { markdown, generatedAt };
  setConfig(PEER_COMP_KEY, JSON.stringify(rec));
  return rec;
}
