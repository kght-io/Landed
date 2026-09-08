"use client";

// THE WEB PROVIDER'S CONTRACT, BACKED BY IPC INSTEAD OF SSE.
//
// frontend/components/AgentsLive.tsx is reused here verbatim — that is the point of this file. It
// imports `useAgentChats`, and the build aliases that import to this module, so the same component
// renders against a transcript that came over IPC from the process that spawned the agent, rather
// than over an SSE tail of a log file.
//
// Everything the web version does that has no meaning here is dropped, and dropped VISIBLY:
// localStorage rehydration (main owns the transcript and outlives the window), reconnect/backoff
// (there is no connection to drop), and stall detection (the child's exit is observed directly).
// What remains is the same shape, so the component cannot tell the difference.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Entry, Transcript } from "@landed/shared/agents/stream";

export type { Entry };

export type ChatState = {
  entries: Entry[];
  sessionId: string | null;
  running: boolean;
  contextTokens?: number;
  model?: string;
  costUsd?: number;
  autoDrain?: boolean;
  // Always empty here: queuing a follow-up needs a way to SEND one, and main's `agent:start` takes
  // no message (see below). The composer reads this to render the pending chips, so leaving it empty
  // is what keeps that UI from appearing on a surface that couldn't honour it.
  queued?: string[];
};

const EMPTY: ChatState = { entries: [], sessionId: null, running: false };

type Ctx = {
  get: (type: string) => ChatState;
  lastEventAt: (type: string) => number | undefined;
  open: string | null;
  setOpen: (t: string | null) => void;
  start: (type: string, message?: string) => void;
  stop: (type: string) => void;
  clear: (type: string) => void;
  setAutoDrain: (type: string, on: boolean) => void;
  send: (type: string, message: string) => void;
  interruptWith: (type: string, message: string) => void;
  cancelQueued: (type: string, index: number) => void;
};

const AgentChatsContext = createContext<Ctx | null>(null);

export function useAgentChats(): Ctx {
  const c = useContext(AgentChatsContext);
  if (!c) throw new Error("useAgentChats must be used within AgentChatsProvider");
  return c;
}

const toChatState = (t: Transcript, running: boolean): ChatState => ({
  entries: t.entries,
  sessionId: t.sessionId,
  running,
  contextTokens: t.contextTokens,
  model: t.model,
  costUsd: t.costUsd,
});

export default function AgentChatsProvider({ children }: { children: React.ReactNode }) {
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({});
  const [running, setRunning] = useState<string[]>([]);
  const [lastAt, setLastAt] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    // Seed from main, which has been folding frames whether or not a window was open.
    void (async () => {
      const types = await window.landed.agentTypes();
      const seeded: Record<string, Transcript> = {};
      for (const { type } of types) seeded[type] = await window.landed.agentTranscript(type);
      if (alive) setTranscripts(seeded);
    })();

    const off = window.landed.onAgentFrame(({ type, transcript }) => {
      setTranscripts((prev) => ({ ...prev, [type]: transcript }));
      setLastAt((prev) => ({ ...prev, [type]: Date.now() }));
    });

    // Running state is the supervisor's, not ours — it knows which child processes are alive.
    const tick = setInterval(async () => {
      const s = await window.landed.agentStatus();
      if (alive) setRunning(s.running ?? []);
    }, 1000);

    return () => {
      alive = false;
      off();
      clearInterval(tick);
    };
  }, []);

  const get = useCallback(
    (type: string): ChatState => {
      const t = transcripts[type];
      return t ? toChatState(t, running.includes(type)) : { ...EMPTY, running: running.includes(type) };
    },
    [transcripts, running],
  );

  const lastEventAt = useCallback((type: string) => lastAt[type], [lastAt]);

  // start/stop/clear exist because the web component offers those controls. Here the supervisor owns
  // the lifecycle: it drains whatever is queued, so "start" is a nudge at most and "stop" would fight
  // the loop. They are wired to main so the buttons are honest rather than inert.
  const start = useCallback((type: string) => void window.landed.agentStart(type), []);
  const stop = useCallback((type: string) => void window.landed.agentStop(type), []);
  const clear = useCallback((type: string) => {
    void window.landed.agentClear(type);
    setTranscripts((prev) => ({ ...prev, [type]: { entries: [], sessionId: null } }));
  }, []);
  const setAutoDrain = useCallback(() => {
    /* no manual mode here — the supervisor always drains; see main.ts */
  }, []);
  // Steering isn't wired on this surface at all: `agent:start` takes only a type, so there is nowhere
  // for a message to go. `send` therefore does what start has always done here — nudge the supervisor
  // — rather than pretending to deliver text it would drop. Queuing follows from that: with no way to
  // send, there is nothing to hold, so `queued` stays empty and its UI never renders.
  const send = useCallback((type: string) => void window.landed.agentStart(type), []);
  const interruptWith = useCallback((type: string) => void window.landed.agentStop(type), []);
  const cancelQueued = useCallback(() => {}, []);

  return (
    <AgentChatsContext.Provider value={{ get, lastEventAt, open, setOpen, start, stop, clear, setAutoDrain, send, interruptWith, cancelQueued }}>
      {children}
    </AgentChatsContext.Provider>
  );
}
