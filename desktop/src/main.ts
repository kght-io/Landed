import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_ORIGIN, drainEnabled, ensureAssetRoot, getAssetRoot, setDrainEnabled } from "./config";
import { listDir, resolveWithin } from "./browse";
import { parseDeepLink } from "./deeplink";
import { revealAssetFolder, revealPrepFolder, revealResumeFolder } from "./local-ops";
import { CLAUDE_BIN, runDrain } from "./agent";
import { createDrainLoop, type WaitResult } from "./supervisor";
import { preflight, summarize } from "./preflight";
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

// Live agent children, so a Stop button can actually stop one.
const children = new Map<string, { kill: () => void }>();

function killRun(type: string): void {
  children.get(type)?.kill();
}

function pushFrame(type: string, frame: Frame): void {
  const before = transcripts.get(type) ?? emptyTranscript();
  const after = reduceFrame(before, frame, nextEntryId);
  if (after.entries.length > ENTRY_LIMIT) after.entries = after.entries.slice(-ENTRY_LIMIT);
  transcripts.set(type, after);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("agent:frame", { type, transcript: after });
}

// The queue types this app drains. Each gets its own loop, matching the queue's own model of one
// process per type; two types can run at once, the same type never does.
const DRAIN_TYPES = ["fit", "tailoring", "interview-brief", "inbox-sync"];

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
  const label = !drainEnabled()
    ? "Paused"
    : status?.stopped || !loop
    ? "Not draining"
    : running.length > 0
      ? `Running: ${running.join(", ")}`
      : "Idle — watching for work";
  tray.setToolTip(`Landed — ${label}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: "separator" },
      {
        label: drainEnabled() ? "Pause draining" : "Resume draining",
        click: () => {
          const next = !drainEnabled();
          setDrainEnabled(next);
          if (next) startLoop();
          else {
            loop?.stop();
            for (const type of children.keys()) killRun(type);
          }
          refreshTray();
        },
      },
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
    // Painted before any CSS loads, so it has to match what the stylesheet lands on — see the
    // reversed zinc ramp in renderer/app.css.
    backgroundColor: "#ffffff",
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
  // Always dist/: the renderer is a bundle now (React + the web app's own components), so there is
  // no source file a browser could load directly. `npm run desktop:dev` keeps esbuild watching, and
  // the watcher below reloads the window when it rewrites the bundle.
  const rendererDir = path.join(__dirname, "renderer");
  void win.loadFile(path.join(rendererDir, "index.html"));

  if (!app.isPackaged) {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const watcher = fs.watch(rendererDir, () => {
      // A rebuild writes several files; one reload per burst rather than per write.
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => win.webContents.reloadIgnoringCache(), 120);
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
  // A fetch proxy for the renderer.
  //
  // The window is a file:// origin, so every relative "/api/..." call the reused web components make
  // would be cross-origin — blocked before it left the page. Proxying through main sidesteps that
  // entirely (Node has no CORS), and it is where the Cloudflare Access token already lives, so the
  // components need no knowledge of either. That is what lets AgentQueueProvider, AgentQueue and
  // Playbook run here unmodified instead of being forked.
  ipcMain.handle("net:fetch", async (_e, path: string, init?: { method?: string; body?: string }) => {
    if (typeof path !== "string" || !path.startsWith("/api/")) {
      return { ok: false, status: 400, body: '{"error":"only /api paths"}' };
    }
    try {
      const res = await fetch(`${APP_ORIGIN}${path}`, {
        method: init?.method ?? "GET",
        headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...accessHeaders() },
        body: init?.body,
      });
      return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (e) {
      return { ok: false, status: 0, body: JSON.stringify({ error: String(e) }) };
    }
  });

  // The supervisor owns the run lifecycle, so these are nudges rather than commands: `start` sets the
  // app's drain trigger (the same one the web "Work queue" button uses) so the waiting long-poll
  // returns immediately; `stop` kills the child; `clear` forgets a transcript.
  ipcMain.handle("agent:start", async (_e, type: string) => {
    await fetch(`${APP_ORIGIN}/api/jobs/wait`, {
      method: "POST",
      headers: { "content-type": "application/json", ...accessHeaders() },
      body: JSON.stringify({ type }),
    }).catch(() => undefined);
  });
  ipcMain.handle("agent:stop", (_e, type: string) => killRun(type));

  // THE PAUSE. The web app's Auto-work toggle means "let the browser start agents on its own"; here
  // it means "let this machine run them at all", which is the stronger promise — this process is the
  // one that works while nobody is watching. Off stops the loop AND kills anything mid-flight, since
  // a pause that lets the current job finish is not what someone reaching for it wants.
  // Setup state, on demand. Checked when the window asks rather than cached at boot: someone fixing
  // a missing CLI does it in another window and comes back, and a cached answer would still be wrong.
  ipcMain.handle("preflight:check", async () => {
    let assetRoot: string | null = null;
    try {
      assetRoot = getAssetRoot();
    } catch {
      /* not chosen yet */
    }
    return summarize(await preflight({ assetRoot, appOrigin: APP_ORIGIN, claudeBin: CLAUDE_BIN }));
  });

  ipcMain.handle("supervisor:enabled", () => drainEnabled());
  ipcMain.handle("supervisor:setEnabled", (_e, on: boolean) => {
    setDrainEnabled(on);
    if (on) {
      if (!loop || loop.status().stopped) startLoop();
    } else {
      loop?.stop();
      for (const type of children.keys()) killRun(type);
    }
    refreshTray();
  });
  ipcMain.handle("agent:clear", (_e, type: string) => {
    transcripts.delete(type);
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
  if (drainEnabled()) startLoop();
  refreshTray();
  setInterval(refreshTray, 2000);

  const cold = pendingLink ?? linkInArgv(process.argv);
  pendingLink = null;
  if (cold) runDeepLink(cold);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Stopping a loop is terminal (its long-polls are aborted), so resuming means building a new one.
// Kept in a function for that reason rather than inlined at startup.
function startLoop(): void {
  loop = createDrainLoop({
    types: DRAIN_TYPES,
    poll: pollForWork,
    run: (type) =>
      runDrain(
        type,
        APP_ORIGIN,
        (frame) => pushFrame(type, frame),
        (handle) => children.set(type, handle),
      ).finally(() => children.delete(type)),
    onError: (e, type) => {
      pushFrame(type, { kind: "note", text: String(e), error: true });
      lastError = String(e);
    },
  });
  void loop.start(); // not awaited: it runs for the life of the app, or until paused
}

// Closing the window does NOT stop draining — that is the whole point of a background supervisor.
// The tray stays, and quitting is an explicit choice from its menu.
app.on("window-all-closed", () => {
  // deliberately empty
});

app.on("before-quit", () => loop?.stop());
