import { contextBridge, ipcRenderer } from "electron";

// THE ONLY THING THE WEB PAGE CAN SEE.
//
// The window loads a remote origin, so the renderer is untrusted by construction: treat everything
// here as reachable by any script the page runs. That is why this file exposes named functions
// rather than a channel — `invoke(channel, ...args)` would hand the page the whole IPC surface and
// make the allowlist a suggestion.
//
// The shape mirrors LocalBridge in frontend/lib/local-capability.ts, and mirrors it PARTIALLY on
// purpose: capabilities that need a database row are absent, and the seam falls back to the server
// for those. Adding one here without adding a handler in main.ts yields undefined, which the seam
// reads as "not available" and routes to fetch — a safe failure, but a silent one, so keep the two
// files in step.
//
// revealPrepFolder is deliberately ABSENT. The seam's version takes a posting id, and turning that
// into a company slug is a database lookup this process does not do. The deep-link route handles
// the slug form (landed://reveal/prep/<slug>) for callers that already have one; exposing an
// id-shaped function backed by a slug-shaped handler would reveal nothing, quietly.
contextBridge.exposeInMainWorld("landed", {
  revealAssetFolder: () => ipcRenderer.invoke("landed:revealAssetFolder"),
  revealResumeFolder: (slug: string) => ipcRenderer.invoke("landed:revealResumeFolder", slug),
  getPaths: () => ipcRenderer.invoke("landed:getPaths"),
  baseResumeUrl: () => "landed-file://resume/resume-ref.pdf",
});
