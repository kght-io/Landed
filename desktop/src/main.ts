import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_ORIGIN, ensureAssetRoot, getAssetRoot } from "./config";
import { listDir, resolveWithin } from "./browse";
import { parseDeepLink } from "./deeplink";
import { revealAssetFolder, revealPrepFolder, revealResumeFolder } from "./local-ops";
import { runDrain } from "./agent";
import { createDrainLoop, type WaitResult } from "./supervisor";
import { emptyTranscript, reduceFrame, type Frame, type Transcript } from "@landed/shared/agents/stream";
import { personaFor } from "@landed/shared/agents/personas";

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
let lastError: string | null = null;

// One transcript per job type, folded here rather than in the renderer so a closed window loses
// nothing — the agent keeps running either way, and reopening should show what happened.
//
// Bounded because a long drain produces hundreds of entries and this process is meant to run for
// days; an unbounded array is a leak with extra steps. Entries are trimmed from the front, so what
// survives is the recent end, which is the part anyone reads.
const ENTRY_LIMIT = 400;
const transcripts = new Map<string, Transcript>();
let entryId = 0;
const nextEntryId = () => ++entryId;

function pushFrame(type: string, frame: Frame): void {
  const before = transcripts.get(type) ?? emptyTranscript();
  const after = reduceFrame(before, frame, nextEntryId);
  if (after.entries.length > ENTRY_LIMIT) after.entries = after.entries.slice(-ENTRY_LIMIT);
  transcripts.set(type, after);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("agent:frame", { type, transcript: after });
}

// The queue types this app drains. Each gets its own loop, matching the queue's own model of one
// process per type; two types can run at once, the same type never does.
const DRAIN_TYPES = ["fit", "tailoring", "prep-research", "interview-brief", "inbox-sync"];

// Long-poll the app for claimable work. The 25s hold is the queue's, not ours — there is no
// interval here to tune, and an empty result simply means "ask again".
const accessHeaders = (): Record<string, string> | undefined =>
  process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
    ? {
        "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
      }
    : undefined;

async function pollForWork(type: string, signal: AbortSignal): Promise<WaitResult> {
  const res = await fetch(`${APP_ORIGIN}/api/jobs/wait?type=${encodeURIComponent(type)}`, {
    signal,
    headers: accessHeaders(),
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
    // Matches the renderer's --bg on first paint, before any CSS loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#09090b" : "#ffffff",
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
  // In development, load the renderer from SOURCE rather than the copy in dist/. A reload then
  // picks up an edit immediately, instead of needing a rebuild and a relaunch for a CSS tweak.
  // Packaged builds always use dist/, which is the only thing shipped.
  const devRenderer = path.join(__dirname, "..", "src", "renderer", "index.html");
  const renderer =
    !app.isPackaged && fs.existsSync(devRenderer) ? devRenderer : path.join(__dirname, "renderer", "index.html");
  void win.loadFile(renderer);

  // Watch the renderer and reload on change. Only the renderer: main-process code cannot be
  // hot-swapped — this file builds the window that would do the swapping — so a change here still
  // needs a relaunch, and pretending otherwise would be worse than the honest restart.
  if (!app.isPackaged && renderer === devRenderer) {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const watcher = fs.watch(path.dirname(devRenderer), () => {
      // Editors write a file in several operations; one reload per burst rather than per event.
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => win.webContents.reloadIgnoringCache(), 80);
    });
    win.on("closed", () => watcher.close());
  }

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
  // Persona names come from shared/, the same map the web agents page reads, so an agent is called
  // the same thing in both places. The renderer is plain JS and cannot import across the workspace,
  // so main resolves them here.
  ipcMain.handle("agent:types", () => DRAIN_TYPES.map((type) => ({ type, persona: personaFor(type) })));

  // Per-type queued counts, for the backlog badge. Proxied through main rather than fetched by the
  // renderer: the window is a file:// origin, so a direct call would be cross-origin.
  ipcMain.handle("queue:counts", async () => {
    try {
      const res = await fetch(`${APP_ORIGIN}/api/jobs`, { headers: accessHeaders() });
      if (!res.ok) return {};
      const body = (await res.json()) as unknown;
      const rows = (Array.isArray(body) ? body : ((body as { jobs?: unknown[] }).jobs ?? [])) as {
        type?: string;
        status?: string;
      }[];
      const counts: Record<string, number> = {};
      for (const j of rows) {
        if (j.status === "queued" && typeof j.type === "string") counts[j.type] = (counts[j.type] ?? 0) + 1;
      }
      return counts;
    } catch {
      return {}; // the status line already reports an unreachable backend; a badge need not shout too
    }
  });
  ipcMain.handle("agent:transcript", (_e, type: string) => transcripts.get(type) ?? emptyTranscript());
  ipcMain.handle("agent:status", () => ({
    running: loop?.status().running ?? [],
    stopped: loop?.status().stopped ?? true,
    origin: APP_ORIGIN,
    lastError,
  }));
  ipcMain.handle("app:chooseRoot", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Choose your Landed folder",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Use this folder",
    });
    return canceled ? null : filePaths[0];
  });

  rootReady = true;

  // A template image: macOS tints it for light/dark menu bars. An empty image is a tray icon you
  // cannot see, which is the same as not having one.
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.on("click", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusWindow();
  });
  loop = createDrainLoop({
    types: DRAIN_TYPES,
    poll: pollForWork,
    run: (type) =>
      runDrain(type, APP_ORIGIN, (frame) => {
        pushFrame(type, frame);
      }),
    onError: (e, type) => {
      pushFrame(type, { kind: "note", text: String(e), error: true });
      lastError = String(e);
    },
  });
  refreshTray();
  setInterval(refreshTray, 2000);

  // light-dark() re-resolves on its own inside the page; the window's own backgroundColor does not,
  // so it has to be told when the user flips appearance.
  nativeTheme.on("updated", () => {
    const bg = nativeTheme.shouldUseDarkColors ? "#09090b" : "#ffffff";
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(bg);
  });
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
