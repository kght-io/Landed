import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";

// WHERE THE APP LIVES and WHERE THE USER'S FILES LIVE — the two facts this shell has to know, and
// the only state it stores. Everything else is in the database, which is not ours.

// The origin the window loads. Localhost today; the deployed app once the backend moves. Kept as a
// variable rather than a constant because that migration should be a config change, not a rebuild.
export const APP_ORIGIN = process.env.LANDED_URL ?? "http://localhost:3000";

type Stored = { assetRoot?: string };

// userData depends on the app's identity, and desktop/package.json sets productName: "Landed" for
// that reason. Electron otherwise falls back to `name` — and this workspace is scoped, so
// "@landed/desktop" was taken literally and settings nested under an "@landed" directory.
const configFile = () => path.join(app.getPath("userData"), "config.json");

const read = (): Stored => {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8")) as Stored;
  } catch {
    return {};
  }
};

const write = (next: Stored) => {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2));
};

let assetRoot: string | null = null;

/** The folder the user chose. Throws if called before ensureAssetRoot() has resolved one. */
export function getAssetRoot(): string {
  if (!assetRoot) throw new Error("asset root not chosen yet");
  return assetRoot;
}

/**
 * Resolve the one folder this app is allowed to touch, asking on first run.
 *
 * The promise the picker makes to the user is "this folder and nothing else", so the answer is
 * stored and reused rather than re-derived: a second prompt would imply the boundary moved. A
 * folder that has since been deleted or unmounted re-prompts rather than silently falling back,
 * because a wrong root here means the agent writes somewhere the user never agreed to.
 */
export async function ensureAssetRoot(): Promise<string | null> {
  const stored = read().assetRoot;
  if (stored && fs.existsSync(stored)) {
    assetRoot = stored;
    return assetRoot;
  }

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose your Landed folder",
    message: "Landed keeps your résumés and interview prep here. It will not touch anything outside this folder.",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Use this folder",
  });
  if (canceled || filePaths.length === 0) return null;

  assetRoot = filePaths[0];
  write({ ...read(), assetRoot });
  return assetRoot;
}
