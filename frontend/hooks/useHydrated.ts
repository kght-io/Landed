"use client";

import { useSyncExternalStore } from "react";

// False on the server AND on the hydration render, true from the first client commit on.
//
// For state that is SEEDED FROM localStorage: the server has no way to know what's in the browser's
// storage, so rendering it during hydration is a mismatch by construction (React re-renders the tree
// and logs an error). Gate that content on this hook and the hydration render matches the HTML, then
// the stored value appears a commit later.
//
// Read as an external store rather than a mounted flag set in an effect: same result, no
// setState-in-effect for the lint to flag. Same technique as ./usePersistentState.ts, which solves
// the read-only half of this problem — reach for that one when the value is a view preference; reach
// for this when the component owns mutable state that merely STARTS from storage.
const subscribe = () => () => {}; // never changes after mount — nothing to subscribe to

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
