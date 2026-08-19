import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";
import { APP_ORIGIN, ensureAssetRoot, getAssetRoot } from "./config";
import { listDir, resolveWithin } from "./browse";
import { parseDeepLink } from "./deeplink";
import { revealAssetFolder, revealPrepFolder, revealResumeFolder } from "./local-ops";
import { runDrain } from "./agent";
import { createDrainLoop, type WaitResult } from "./supervisor";

// THE DESKTOP APP.
//
// It is NOT the app's UI — the browser owns that, and always will. This process owns the two things
// a browser cannot do: run Claude Code on the user's own subscription, and touch the folder the
// user's résumés live in. Its window shows exactly those: agent runs, and a browser for that folder.
//
// Because the window renders our own local files rather than a remote origin, the threat model is
// the ordinary one for a desktop app — the renderer is still isolated and sandboxed, but the
// hostile-page concerns that shaped an earlier draft do not apply here. What DOES arrive from
// outside is `landed://` deep links, and those are gated in deeplink.ts.

// Deep links are how the browser reaches this app: the OS routes the URL, so the web page needs no
// port, no CORS grant, and no mixed-content exception.
app.setAsDefaultProtocolClient("landed");

// One instance owns the scheme. Without the lock, a second launch — which is how Windows and Linux
// deliver a deep link — would start a rival process holding a rival asset root.
if (!app.requestSingleInstanceLock()) app.quit();

let rootReady = false;
let pendingLink: string | null = null;
let tray: Tray | null = null;
let loop: ReturnType<typeof createDrainLoop> | null = null;

// The queue types this app drains. Each gets its own loop, matching the queue's own model of one
// process per type; two types can run at once, the same type never does.
const DRAIN_TYPES = ["fit", "tailoring", "prep-research", "interview-brief", "inbox-sync"];

// Long-poll the app for claimable work. The 25s hold is the queue's, not ours — there is no
// interval here to tune, and an empty result simply means "ask again".
async function pollForWork(type: string, signal: AbortSignal): Promise<WaitResult> {
  const access =
    process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
      ? {
          "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
          "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
        }
      : undefined;
  const res = await fetch(`${APP_ORIGIN}/api/jobs/wait?type=${encodeURIComponent(type)}`, {
    signal,
    headers: access,
  });
  if (!res.ok) throw new Error(`wait ${type}: ${res.status}`);
  return (await res.json()) as WaitResult;
}

// The tray is the only place a background process can tell the truth about itself. A supervisor
// that has quietly stopped draining looks identical to an idle one from inside the browser.
function refreshTray(): void {
  if (!tray) return;
  const status = loop?.status();
  const running = status?.running ?? [];
  const label = status?.stopped
    ? "Not draining"
    : running.length > 0
      ? `Running: ${running.join(", ")}`
      : "Idle — watching for work";
  tray.setToolTip(`Landed — ${label}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: "separator" },
      { label: "Open Landed", click: () => void shell.openExternal(APP_ORIGIN) },
      { label: "Show folder", click: () => revealAssetFolder() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

function focusWindow(): void {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

function runDeepLink(raw: string): void {
  const link = parseDeepLink(raw);
  if (!link) return; // unparseable or not ours — silence beats an error dialog for a stray click
  if (link.action === "reveal") {
    const t = link.target;
    if (t.kind === "assets") revealAssetFolder();
    else if (t.kind === "resume") revealResumeFolder(t.slug);
    else revealPrepFolder(t.slug);
    return;
  }
  focusWindow(); // "agent" — the runs view lives in this window
}

/** Queue a link until there is a root to resolve it against, so a cold-start click is not dropped. */
function handleDeepLink(raw: string): void {
  if (rootReady) runDeepLink(raw);
  else pendingLink = raw;
}

const linkInArgv = (argv: string[]): string | undefined => argv.find((a) => a.startsWith("landed://"));

// Deep links arrive three ways and all three funnel through handleDeepLink: macOS `open-url` while
// running, a second launch carrying the URL in argv on Windows/Linux, and a COLD start where the
// URL is in this process's own argv. Missing the cold-start case is the classic bug — the app
// opens and nothing happens, once, on the very first click after install.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});
app.on("second-instance", (_event, argv) => {
  const url = linkInArgv(argv);
  if (url) handleDeepLink(url);
  else focusWindow();
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: "#09090b",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Nothing in this window should navigate anywhere. External links open in the real browser, where
  // the user has their session, their tabs, and an address bar.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

app.whenReady().then(async () => {
  // The folder question comes before the window: every capability here is defined relative to the
  // answer, and a window that opened first could ask for files with no root to resolve them against.
  const root = await ensureAssetRoot();
  if (!root) {
    app.quit();
    return;
  }

  ipcMain.handle("browse:root", () => getAssetRoot());
  ipcMain.handle("browse:list", (_e, rel: string) => listDir(getAssetRoot(), typeof rel === "string" ? rel : ""));
  ipcMain.handle("browse:open", (_e, rel: string) => {
    const target = resolveWithin(getAssetRoot(), typeof rel === "string" ? rel : "");
    if (target) void shell.openPath(target);
  });
  ipcMain.handle("browse:reveal", (_e, rel: string) => {
    const target = resolveWithin(getAssetRoot(), typeof rel === "string" ? rel : "");
    if (target) shell.showItemInFolder(target);
  });
  ipcMain.handle("app:openInBrowser", () => shell.openExternal(APP_ORIGIN));
  ipcMain.handle("app:origin", () => APP_ORIGIN);
  ipcMain.handle("app:chooseRoot", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Choose your Landed folder",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Use this folder",
    });
    return canceled ? null : filePaths[0];
  });

  rootReady = true;

  tray = new Tray(nativeImage.createEmpty());
  loop = createDrainLoop({
    types: DRAIN_TYPES,
    poll: pollForWork,
    run: (type) => runDrain(type, APP_ORIGIN),
    onError: (e, type) => console.error(`[drain:${type}]`, e),
  });
  refreshTray();
  setInterval(refreshTray, 2000);
  // Not awaited: the loop runs for the life of the app.
  void loop.start();

  createWindow();

  // Drain anything that arrived before there was a root — including the link that launched us.
  const cold = pendingLink ?? linkInArgv(process.argv);
  pendingLink = null;
  if (cold) runDeepLink(cold);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Closing the window does NOT stop draining — that is the whole point of a background supervisor.
// The tray stays, and quitting is an explicit choice from its menu.
app.on("window-all-closed", () => {
  // deliberately empty
});

app.on("before-quit", () => loop?.stop());
