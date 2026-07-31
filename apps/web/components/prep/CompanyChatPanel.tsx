"use client";

import { useState, useSyncExternalStore } from "react";
import { MessageSquare } from "lucide-react";
import PrepChat from "./PrepChat";
import { usePersistentState } from "@/hooks/usePersistentState";

const MIN_W = 320;
const MAX_W = 820;

const WIDE = "(min-width: 1024px)";
// Read the viewport-is-wide state without setState-in-effect (the lint-clean way to read an external
// store). SSR snapshot is `false` → the panel renders collapsed on the server, then resolves on the
// client; useSyncExternalStore handles the handoff without a hydration mismatch.
function useIsWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

// The per-company chat, docked to the right of the prep content and collapsible. On wide screens it
// sits inline beside the prep; collapsed, it shrinks to a thin rail you click to reopen. On narrow
// screens it starts collapsed and opens as an overlay (with a backdrop) so it never crushes the
// content. One chat per company (keyed by slug), seeded with the whole-company `context`.
export default function CompanyChatPanel({
  slug,
  context,
  companyName,
}: {
  slug: string;
  context: string;
  companyName: string;
}) {
  // Default open on wide screens, collapsed on narrow; a manual toggle (override) wins once set.
  const isWide = useIsWide();
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? isWide;
  const setOpen = (v: boolean) => setOverride(v);

  // Docked width (wide screens only) — drag the left edge to resize; persisted across reloads.
  const [width, setWidth] = usePersistentState("landed.prepchat.width", 420);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => setWidth(Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - ev.clientX)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Open chat"
        className="flex w-11 shrink-0 flex-col items-center gap-2 border-l border-zinc-800/80 bg-zinc-950 py-3 text-zinc-400 transition hover:bg-zinc-900 hover:text-sky-300"
      >
        <MessageSquare size={16} />
        <span className="text-[11px] font-medium" style={{ writingMode: "vertical-rl" }}>Chat</span>
      </button>
    );
  }

  return (
    <>
      {/* Backdrop — only on narrow screens, where the panel overlays the content. */}
      <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
      <aside
        className="fixed inset-y-0 right-0 z-30 flex shrink-0 flex-col border-l border-zinc-800/80 bg-zinc-950 shadow-2xl max-lg:w-full max-lg:max-w-[85vw] lg:relative lg:inset-y-auto lg:z-auto lg:shadow-none"
        style={isWide ? { width } : undefined}
      >
        {/* Drag handle — resize the docked panel (wide screens only). */}
        {isWide && (
          <div
            onPointerDown={startResize}
            title="Drag to resize"
            className="absolute inset-y-0 left-0 z-40 -ml-1 w-2 cursor-col-resize transition-colors hover:bg-sky-500/40"
          />
        )}
        <PrepChat
          storageId={slug}
          slug={slug}
          context={context}
          onCollapse={() => setOpen(false)}
          intro={`Your interview-prep coach for ${companyName}. It reads this company's research files (below) — ask it to quiz you, pressure-test an answer, or dig into a weak spot.`}
          placeholder={`Prep for ${companyName}…`}
        />
      </aside>
    </>
  );
}
