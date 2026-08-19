// The desktop build.
//
// esbuild's CLI cannot express what this needs — path-PREFIX aliases (@/… → frontend/…) and one
// module SWAP (the chats provider) — so the build is a script. Those two aliases are the whole
// trick behind reusing the web app's agent UI here instead of maintaining a lookalike:
//
//   @/components/AgentChatsProvider → the IPC-backed one. The only piece that genuinely differs.
//   @/*                             → frontend/*.        Everything else, unchanged.
//
// Main and preload are bundled separately from the renderer: they run in Node with electron
// external, while the renderer is a browser bundle.

import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const watch = process.argv.includes("--watch");

/** Resolve the workspace's own path shapes, which no bundler knows about by default. */
const workspaceAliases = {
  name: "workspace-aliases",
  setup(build) {
    // The swap. Listed first because it must win over the generic @/ rule below.
    build.onResolve({ filter: /^@\/components\/AgentChatsProvider$/ }, () => ({
      path: path.join(here, "src", "renderer", "providers", "AgentChatsProvider.tsx"),
    }));
    build.onResolve({ filter: /^@\// }, (args) => ({
      path: resolveExt(path.join(repo, "frontend", args.path.slice(2))),
    }));
    build.onResolve({ filter: /^@landed\/shared\// }, (args) => ({
      path: resolveExt(path.join(repo, "shared", "src", args.path.replace("@landed/shared/", ""))),
    }));
  },
};

/** Add the extension the source omitted — imports are written without one. */
function resolveExt(p) {
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  for (const ext of [".tsx", ".ts", ".mjs", ".js"]) if (fs.existsSync(p + ext)) return p + ext;
  for (const ext of [".tsx", ".ts"]) if (fs.existsSync(path.join(p, "index" + ext))) return path.join(p, "index" + ext);
  return p;
}

const node = {
  entryPoints: ["src/main.ts", "src/preload.ts", "src/mcp-local.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outdir: "dist",
  external: ["electron"],
  sourcemap: true,
  plugins: [workspaceAliases],
};

const renderer = {
  entryPoints: ["src/renderer/main.tsx"],
  bundle: true,
  platform: "browser",
  target: "chrome120",
  format: "iife",
  outfile: "dist/renderer/main.js",
  sourcemap: true,
  jsx: "automatic",
  // The reused components are Next client components; the directive is meaningless in a plain
  // bundle and esbuild warns about it on every file otherwise.
  banner: {},
  logOverride: { "unsupported-jsx-comment": "silent", "different-path-case": "silent" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [workspaceAliases],
};

function tailwind() {
  execFileSync(
    path.join(repo, "node_modules", ".bin", "tailwindcss"),
    ["-i", "src/renderer/app.css", "-o", "dist/renderer/app.css", ...(watch ? [] : ["--minify"])],
    { cwd: here, stdio: "inherit" },
  );
}

fs.mkdirSync(path.join(here, "dist", "renderer"), { recursive: true });
fs.cpSync(path.join(here, "src", "assets"), path.join(here, "dist", "assets"), { recursive: true });
fs.copyFileSync(path.join(here, "src", "renderer", "index.html"), path.join(here, "dist", "renderer", "index.html"));

if (watch) {
  const [a, b] = await Promise.all([esbuild.context(node), esbuild.context(renderer)]);
  await Promise.all([a.watch(), b.watch()]);
  tailwind();
  console.log("watching…");
} else {
  await Promise.all([esbuild.build(node), esbuild.build(renderer)]);
  tailwind();
}
