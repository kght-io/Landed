"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LEVELING_REF, type LevelingRef } from "@landed/shared/config/leveling";
import LevelingRefPanel from "@/components/LevelingRefPanel";

// Self-contained wrapper around LevelingRefPanel for the settings page (the Pipeline page owns its
// own copy of the ref state for the level popover; this fetches + persists independently).
export default function LevelingRefEditor() {
  const [ref, setRef] = useState<LevelingRef | null>(null);

  useEffect(() => {
    fetch("/api/leveling-ref").then((r) => r.json()).then((d) => setRef(d.ref ?? DEFAULT_LEVELING_REF)).catch(() => setRef(DEFAULT_LEVELING_REF));
  }, []);

  const save = (patch: Partial<LevelingRef>) => {
    setRef((cur) => ({ ...(cur ?? DEFAULT_LEVELING_REF), ...patch }));
    fetch("/api/leveling-ref", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
  };

  return <LevelingRefPanel value={ref} onSave={save} />;
}
