import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { APP_ORIGIN, ensureAssetRoot } from "./config";
import { baseResumePath, getPaths, revealAssetFolder, revealPrepFolder, revealResumeFolder, within } from "./local-ops";
import { parseDeepLink } from "./deeplink";

// THE SHELL. A window onto the app — which runs on localhost today and in the cloud later — plus
// the handful of capabilities a browser cannot offer on files that live on this machine.
//
// The security posture follows from one fact: the renderer loads a REMOTE origin. Anything the page
// can reach, an attacker who can influence that page can reach. Hence no node integration, context
// isolation on, a sandboxed renderer, a preload that exposes named functions rather than a channel,
// and an origin check on every handler below.

// Must be declared before `ready`, or the scheme is registered too late to be treated as secure.
protocol.registerSchemesAsPrivileged([
  { scheme: "landed-file", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// `landed://` is how the browser reaches this app: the OS routes the URL, so the web page needs no
// port, no CORS grant, and no exception to mixed-content rules. Registered here rather than at
// install time so a dev run claims the scheme too.
app.setAsDefaultProtocolClient("landed");

// One instance owns the scheme. Without the lock, a second launch (which is what Windows and Linux
// do to deliver a deep link) would start a rival process holding a rival asset root.
if (!app.requestSingleInstanceLock()) app.quit();

// Deep links arrive three ways, and all three funnel here: macOS `open-url` while running, a
// second launch carrying the URL in argv on Windows/Linux, and a COLD start where the URL is in
// this process's own argv. Missing the cold-start case is the classic bug — the app opens and
// nothing happens, once, only on the first click.
let pendingLink: string | null = null;

function runDeepLink(raw: string): void {
  const link = parseDeepLink(raw);
  if (!link) return; // unparseable or not ours — silence, not an error dialog
  if (link.action === "reveal") {
    const t = link.target;
    if (t.kind === "assets") revealAssetFolder();
    else if (t.kind === "resume") revealResumeFolder(t.slug);
    else revealPrepFolder(t.slug);
    return;
  }
  focusWindow(); // "agent" — bring the app forward; the view itself is still to come
}

/** Queue a link if the asset root is not chosen yet, so a cold-start click is not dropped. */
function handleDeepLink(raw: string): void {
  if (!app.isReady() || !rootReady) pendingLink = raw;
  else runDeepLink(raw);
}

const linkInArgv = (argv: string[]): string | undefined => argv.find((a) => a.startsWith("landed://"));

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on("second-instance", (_event, argv) => {
  const url = linkInArgv(argv);
  if (url) handleDeepLink(url);
  else focusWindow();
});

let rootReady = false;

function focusWindow(): void {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

/**
 * Reject IPC from anywhere but the app we loaded.
 *
 * A window that has navigated elsewhere — a redirect, an OAuth hop, an injected iframe — is not the
 * app, and must not be able to ask this process to touch the user's disk. Checked per call rather
 * than once at startup, because navigation happens after startup.
 */
function fromApp(event: Electron.IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(APP_ORIGIN).origin;
  } catch {
    return false;
  }
}

const handle = (channel: string, run: (...args: never[]) => unknown) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) return undefined; // silence, not an error: the caller is not the app
    return run(...(args as never[]));
  });

// Shown when the app cannot be reached. The whole UI is remote, so without this the window is blank
// and the user has no way to tell "server down" from "app broken".
const offlinePage = (origin: string) => `data:text/html,${encodeURIComponent(`
<style>body{background:#09090b;color:#a1a1aa;font:14px/1.6 -apple-system,system-ui,sans-serif;
display:grid;place-content:center;height:100vh;margin:0;text-align:center;gap:12px}
code{color:#e4e4e7}button{background:#27272a;color:#e4e4e7;border:1px solid #3f3f46;border-radius:8px;
padding:6px 14px;font:inherit;cursor:pointer}</style>
<div><h2 style="color:#e4e4e7;font-weight:500;margin:0 0 4px">Can't reach Landed</h2>
<p style="margin:0 0 14px">Nothing is running at <code>${origin}</code>.</p>
<button onclick="location.reload()">Try again</button></div>`)}`;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#09090b", // matches the app's dark shell, so launch has no white flash
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-fail-load", (_e, _code, _desc, failedUrl, isMainFrame) => {
    if (isMainFrame && !failedUrl.startsWith("data:")) void win.loadURL(offlinePage(APP_ORIGIN));
  });

  // Links that leave the app open in the real browser rather than trapping the user in a window
  // with no address bar and no back button.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith("landed-file://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  void win.loadURL(APP_ORIGIN);
  return win;
}

app.whenReady().then(async () => {
  // The folder question comes before the window: every local capability is defined relative to the
  // answer, and a window that opened first would be able to ask for files with no root to resolve.
  const root = await ensureAssetRoot();
  if (!root) {
    app.quit();
    return;
  }

  // Serves files out of the chosen folder to the page. The path is rebuilt through within() rather
  // than trusted, so a URL is not a way to read the disk.
  protocol.handle("landed-file", (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const file = rel === "resume/resume-ref.pdf" ? baseResumePath() : within(rel);
    if (!file) return new Response("forbidden", { status: 403 });
    return net.fetch(`file://${file}`);
  });

  handle("landed:revealAssetFolder", () => revealAssetFolder());
  handle("landed:revealResumeFolder", (slug: string) => revealResumeFolder(slug));
  handle("landed:getPaths", () => getPaths());

  rootReady = true;
  createWindow();

  // Drain anything that arrived before there was a root to resolve it against — including the link
  // that launched this process in the first place.
  const cold = pendingLink ?? linkInArgv(process.argv);
  pendingLink = null;
  if (cold) runDeepLink(cold);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
