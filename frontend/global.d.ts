// Ambient type for the Novus by Pendo web SDK global (loaded via the snippet in app/layout.tsx).
interface Pendo {
  initialize: (options: { visitor?: { id?: string }; account?: Record<string, unknown> }) => void;
  track: (trackType: string, metadata?: object) => void;
}
declare const pendo: Pendo;
