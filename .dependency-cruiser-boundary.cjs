/**
 * The ENFORCED workspace boundary — what keeps the frontend/backend split real instead of
 * decorative. Runs as `npm run boundary`, and as part of `npm run check`.
 *
 * Deliberately separate from .dependency-cruiser.cjs (the diagram config): that one collapses
 * modules into folder boxes and filters the graph down to our own source, both of which make
 * these rules unable to fire. Rules need the full, uncollapsed graph — node builtins included.
 *
 * The invariants:
 *   backend -/-> frontend   the backend never reaches into the frontend
 *   shared -/-> backend     (at runtime — type-only imports are erased, so they're allowed)
 *   shared -/-> node        shared ships to the browser
 *   frontend -/-> desktop   the web app never depends on the Electron app
 *   desktop -/-> backend    the desktop app talks HTTP, never opens the DB
 *   no import cycles        every module can be read, tested, and moved on its own
 *
 * Note what is NOT forbidden: desktop -> frontend. The desktop renderer deliberately imports the
 * web app's agent components so the two cannot drift, and that is the ONE direction allowed across
 * that pair — which is exactly why the reverse is a rule.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "An import cycle means there is no bottom: to understand any module in the ring you have " +
        "to understand all of them, and none can be tested or moved alone. In ESM they also fail " +
        "at RUNTIME — a module half-way through evaluation hands out undefined exports — but only " +
        "once something crossing the ring is read at import time rather than called later. Cycles " +
        "of plain function references therefore work by accident and accumulate silently until one " +
        "top-level `const` detonates at startup. backend/src/{db,jobs,agents} were a ring of exactly " +
        "that shape; see backend/src/db/stage-change.ts for how the last edge was inverted.",
      from: {},
      to: { circular: true },
    },
    {
      name: "backend-not-to-frontend",
      severity: "error",
      comment:
        "The backend must not depend on the frontend. backend is imported BY frontend's route " +
        "handlers, never the other way round — an edge here means server logic reached into a page " +
        "or component, and the split is no longer real.",
      from: { path: "^backend" },
      to: { path: "^(frontend|mcp)/" },
    },
    {
      name: "shared-not-to-backend-at-runtime",
      severity: "error",
      comment:
        "shared ships to the browser, so it must never pull in the DB driver or anything " +
        "else from backend AT RUNTIME. Type-only imports are exempt (TypeScript erases them): " +
        "a couple of shared modules are typed against drizzle-inferred row types (PostingRow) that " +
        "can only be declared next to the schema.",
      from: { path: "^shared" },
      to: { path: "^backend", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "frontend-not-to-desktop",
      severity: "error",
      comment:
        "The desktop app imports the web app's agent components on purpose — that reuse is what " +
        "keeps one agents UI instead of two. The reverse would make the web app unbuildable " +
        "without Electron, and that is not a trade anyone would make deliberately.",
      from: { path: "^frontend" },
      to: { path: "^desktop/" },
    },
    {
      name: "desktop-not-to-backend",
      severity: "error",
      comment:
        "The desktop app runs on the user's machine and the database does not — it lives wherever " +
        "the app is deployed. Reaching into backend/ would pull in better-sqlite3 and imply a " +
        "local DB that is not there. Everything data-shaped goes over HTTP, through main's fetch " +
        "proxy or an MCP tool. Type-only imports are exempt, as with shared.",
      from: { path: "^desktop" },
      to: { path: "^backend", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "shared-stays-browser-safe",
      severity: "error",
      comment:
        "shared is imported by client components. A node builtin here breaks the browser " +
        "bundle — the module belongs in backend instead.",
      from: { path: "^shared" },
      to: { dependencyTypes: ["core"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["node_modules", "\\.next", "\\.test\\.(ts|tsx)$"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
