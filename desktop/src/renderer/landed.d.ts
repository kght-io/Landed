// The preload bridge, as the renderer sees it. Kept beside the renderer rather than in preload.ts
// because this is the CONSUMER's view — the shape the reused web components and this app's own
// views compile against.
import type { Transcript } from "@landed/shared/agents/stream";
import type { Summary } from "../preflight";

declare global {
  interface Window {
    landed: {
      root(): Promise<string>;
      list(rel: string): Promise<{ name: string; dir: boolean; bytes: number | null }[]>;
      open(rel: string): Promise<void>;
      reveal(rel: string): Promise<void>;
      origin(): Promise<string>;
      openInBrowser(): Promise<void>;
      chooseRoot(): Promise<string | null>;

      agentTypes(): Promise<{ type: string; persona: string }[]>;
      agentTranscript(type: string): Promise<Transcript>;
      agentStatus(): Promise<{ running: string[]; stopped: boolean; origin: string; lastError: string | null }>;
      onAgentFrame(cb: (e: { type: string; transcript: Transcript }) => void): () => void;
      queueCounts(): Promise<Record<string, number>>;
      agentStart(type: string): Promise<void>;
      agentStop(type: string): Promise<void>;
      agentClear(type: string): Promise<void>;
      preflight(): Promise<Summary>;
      drainEnabled(): Promise<boolean>;
      setDrainEnabled(on: boolean): Promise<void>;

      apiFetch(
        path: string,
        init?: { method?: string; body?: string },
      ): Promise<{ ok: boolean; status: number; body: string }>;
    };
  }
}
export {};
