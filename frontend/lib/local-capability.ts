// THE LOCAL SEAM — the one place that knows some capabilities need a machine, not a server.
//
// Most of this app is origin-agnostic: a page calls /api/whatever, a route handler reads the DB,
// and it does not matter whether that handler runs on this laptop or in a container. Eight
// affordances are different. Revealing a folder in Finder, diffing two .docx files through
// `textutil`, linking to an attachment on disk — these touch the filesystem the user's résumés
// actually live on, and they only work today because the Next server happens to share a machine
// with those files.
//
// That coincidence ends when the backend moves to Fly. The routes will not fail; they will answer
// cheerfully about /app/asset-root inside a container in Virginia (fly.toml declares that path
// ephemeral by design). Silently wrong beats broken only in the sense that it is harder to notice.
//
// So every such call goes through here. In a plain browser this is exactly the code that ran
// before — same URLs, same methods. Inside the desktop app, a preload script exposes `window.landed`
// and the same call runs where the files are. Components never branch; they import a function.
//
// Adding a capability means adding it to LocalBridge AND to the fetch fallback — the fallback is
// what a phone browser gets, and "unavailable there" is a product decision, not a default.

import type { DiffOp } from "@landed/shared/util/linediff";
import { deepLink } from "@landed/shared/desktop/deeplink";

// The resolved on-disk roots, for display on the settings page.
export type Paths = { assetRoot: string; instructionsRoot: string };

// A tailored résumé diffed against the base. Mirrors GET /api/resume/diff.
export type ResumeDiffResult =
  | { ok: true; slug: string; base: string; added: number; removed: number; ops: DiffOp[] }
  | { error: string };

// The captured-vs-missing status behind the drawer's prep-materials panel. Mirrors
// GET /api/applications/:id/prep-assets — declared here so the two components that render it stop
// re-deriving the endpoint's shape.
export type PrepAssets = {
  slug: string;
  emails: { at: string | null; attachments: { name: string; bytes: number }[] };
  transcripts: { name: string; bytes: number; at: string }[];
  context: { at: string | null };
};

// What the desktop app injects. Absent in a browser — that absence IS the feature detection.
//
// PARTIAL on purpose. Not every capability here is purely local: getPrepAssets and getResumeDiff
// read the DB as well as the disk, so until the DB moves they are better answered by the server
// even when a desktop bridge exists. A bridge therefore implements what it can and omits the rest,
// and the fallback is chosen per capability rather than all-or-nothing.
export type LocalBridge = {
  revealAssetFolder(): Promise<void>;
  revealResumeFolder(slug: string): Promise<void>;
  revealPrepFolder(postingId: string): Promise<void>;
  getPaths(): Promise<Paths>;
  getResumeDiff(slug: string): Promise<ResumeDiffResult>;
  getPrepAssets(postingId: string): Promise<PrepAssets>;
  // URL-valued, because these are <a href> targets rather than calls. Under Electron they are not
  // http URLs at all, which is exactly why the component must not build them itself.
  attachmentUrl(postingId: string, name: string): string;
  baseResumeUrl(): string;
};

export type LocalCapability = LocalBridge;

// Reveals are decoration, not workflow: a click that opens Finder must never surface an error, and
// a desktop bridge whose IPC channel has closed must degrade to "nothing happened" — same contract
// the old inline `.catch(() => {})` call sites had.
const quietly = async (run: () => Promise<unknown>): Promise<void> => {
  try {
    await run();
  } catch {
    /* best-effort by design */
  }
};

const json = async <T,>(res: Promise<Response>): Promise<T> => (await res).json() as Promise<T>;

/**
 * Bind the capabilities to a bridge (desktop) or to fetch (browser). Exported separately from the
 * default binding below so it can be tested without a DOM: pass a fake bridge, or none plus a fake
 * fetch, and assert which side answered.
 */
/**
 * How a REVEAL reaches the machine when the page is not inside the desktop app.
 *
 * "server" is what runs today: the Next server shares a machine with the files, so a POST to it can
 * open Finder. That stops being true the moment the backend moves to the cloud — the route would
 * cheerfully reveal a folder inside a container.
 *
 * "deep-link" is the replacement: navigating to `landed://…` hands the intent to the OS, which
 * routes it to the installed app. No port, no CORS, no mixed content. It is a one-way send — the
 * page cannot tell whether an app was there to receive it, which is why this is a deliberate switch
 * rather than a runtime guess.
 */
export type RevealTransport = "server" | "deep-link";

export function makeLocalCapability(
  bridge: Partial<LocalBridge> | undefined,
  fetchImpl: typeof fetch,
  reveal: RevealTransport = "server",
  navigate: (url: string) => void = (url) => {
    if (typeof window !== "undefined") window.location.href = url;
  },
): LocalCapability {
  const post = (url: string, body?: unknown) =>
    fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const b = bridge ?? {};
  const viaLink = reveal === "deep-link";
  const send = (url: string) => Promise.resolve(navigate(url));

  return {
    revealAssetFolder: () =>
      quietly(() => b.revealAssetFolder?.() ?? (viaLink ? send(deepLink.revealAssets()) : post("/api/config/paths"))),
    revealResumeFolder: (slug) =>
      quietly(
        () =>
          b.revealResumeFolder?.(slug) ??
          (viaLink ? send(deepLink.revealResume(slug)) : post("/api/resume/open", { slug })),
      ),
    // NOTE: takes a posting id, not a slug — resolving one to the other is a DB lookup, so the
    // deep-link form waits until the caller can supply a slug. Until then this stays on the server.
    revealPrepFolder: (postingId) =>
      quietly(
        () =>
          b.revealPrepFolder?.(postingId) ??
          post(`/api/applications/${encodeURIComponent(postingId)}/prep-assets`, { action: "open" }),
      ),
    getPaths: () => b.getPaths?.() ?? json<Paths>(fetchImpl("/api/config/paths")),
    getResumeDiff: (slug) =>
      b.getResumeDiff?.(slug) ?? json<ResumeDiffResult>(fetchImpl(`/api/resume/diff?slug=${encodeURIComponent(slug)}`)),
    getPrepAssets: (postingId) =>
      b.getPrepAssets?.(postingId) ??
      json<PrepAssets>(fetchImpl(`/api/applications/${encodeURIComponent(postingId)}/prep-assets`)),
    attachmentUrl: (postingId, name) =>
      b.attachmentUrl?.(postingId, name) ??
      `/api/applications/${encodeURIComponent(postingId)}/attachments/${encodeURIComponent(name)}`,
    baseResumeUrl: () => b.baseResumeUrl?.() ?? "/api/resume/base",
  };
}

// Read the bridge lazily rather than at module load: the binding is a live lookup so a preload that
// lands late (or a test that installs one) is still seen, and importing this module on the server
// during SSR touches no globals that do not exist there.
const bridge = (): Partial<LocalBridge> | undefined =>
  typeof window === "undefined" ? undefined : (window as { landed?: Partial<LocalBridge> }).landed;

/** True inside the desktop app. Use it to hide affordances the browser genuinely cannot offer. */
export const hasLocalBridge = (): boolean => bridge() !== undefined;

// Flip to "1" once the desktop app is the thing that owns the filesystem — i.e. when the backend
// stops sharing a machine with the user's folder. Build-time so the choice is visible in the
// bundle rather than sniffed at runtime.
const transport: RevealTransport =
  process.env.NEXT_PUBLIC_DESKTOP_REVEAL === "1" ? "deep-link" : "server";

const cap = () => makeLocalCapability(bridge(), fetch, transport);

export const revealAssetFolder = (): Promise<void> => cap().revealAssetFolder();
export const revealResumeFolder = (slug: string): Promise<void> =>
  cap().revealResumeFolder(slug);
export const revealPrepFolder = (postingId: string): Promise<void> =>
  cap().revealPrepFolder(postingId);
export const getPaths = (): Promise<Paths> => cap().getPaths();
export const getResumeDiff = (slug: string): Promise<ResumeDiffResult> =>
  cap().getResumeDiff(slug);
export const getPrepAssets = (postingId: string): Promise<PrepAssets> =>
  cap().getPrepAssets(postingId);
export const attachmentUrl = (postingId: string, name: string): string =>
  cap().attachmentUrl(postingId, name);
export const baseResumeUrl = (): string => cap().baseResumeUrl();
