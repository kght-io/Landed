"use client";

import { useCallback, useSyncExternalStore } from "react";

// localStorage-backed state: a view value (active tab, panel width, …) that survives reloads AND
// navigating away and back. Same API shape as useState (value setter, not a functional updater).
//
// Read as an external store so it's hydration-safe AND lint-clean (no setState-in-effect): the server
// AND the hydration render both use `initial` (getServerSnapshot), so the HTML always matches; the
// stored value is applied on the first post-hydration commit (getSnapshot). It also reacts to writes
// from other tabs (native "storage" event) and other instances in this tab (a custom event).

const CHANNEL = "landed:persistent-state";

// Cache the parsed value per key so getSnapshot returns a referentially-stable result between reads
// (useSyncExternalStore loops forever otherwise) — re-parsing only when the raw string changes.
const cache = new Map<string, { raw: string | null; parsed: unknown }>();

function read<T>(key: string, initial: T): T {
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { /* unavailable */ }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.parsed as T;
  let parsed: T = initial;
  if (raw != null) { try { parsed = JSON.parse(raw) as T; } catch { parsed = initial; } }
  cache.set(key, { raw, parsed });
  return parsed;
}

export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const subscribe = useCallback((cb: () => void) => {
    const onChange = (e: Event) => {
      if (e instanceof StorageEvent) { if (e.key === key) cb(); return; }
      if ((e as CustomEvent).detail === key) cb();
    };
    window.addEventListener("storage", onChange);
    window.addEventListener(CHANNEL, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(CHANNEL, onChange);
    };
  }, [key]);

  const value = useSyncExternalStore(
    subscribe,
    () => read(key, initial), // client: the stored value (applied after hydration)
    () => initial,            // server + hydration render: initial, so the HTML matches
  );

  const setValue = useCallback((v: T) => {
    const raw = JSON.stringify(v);
    try { localStorage.setItem(key, raw); } catch { /* quota — skip */ }
    cache.set(key, { raw, parsed: v });
    window.dispatchEvent(new CustomEvent(CHANNEL, { detail: key }));
  }, [key]);

  return [value, setValue];
}
