import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveResume } from "@landed/core/config";

export const dynamic = "force-dynamic";

// POST /api/resume/open  body: { slug } — reveal a tailored-resume folder in the OS file browser.
// Local-only convenience (the server runs on the same machine), best-effort.
export async function POST(request: Request) {
  let body: { slug?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const slug = body.slug?.trim();
  if (!slug) return Response.json({ error: "missing slug" }, { status: 400 });
  const dir = resolveResume(slug);
  if (!dir) return Response.json({ error: "bad slug" }, { status: 400 });
  if (!existsSync(dir)) return Response.json({ error: "folder not found" }, { status: 404 });

  if (process.platform === "darwin") {
    // `open <dir>` spawns a fresh Finder window on every click. Instead, retarget the front window
    // if one is already open (so repeat clicks reuse it), else open a new one. Best-effort.
    const script = `tell application "Finder"
  activate
  set p to (POSIX file ${JSON.stringify(dir)} as alias)
  if (count of windows) > 0 then
    set target of front window to p
  else
    open p
  end if
end tell`;
    execFile("osascript", ["-e", script], () => {}); // fire-and-forget
  } else {
    const cmd = process.platform === "win32" ? "explorer" : "xdg-open";
    execFile(cmd, [dir], () => {}); // fire-and-forget — reveal is best-effort
  }
  return Response.json({ ok: true });
}
