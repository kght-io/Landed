/**
 * The ENFORCED workspace boundary — what keeps the frontend/backend split real instead of
 * decorative. Runs as `npm run boundary`, and as part of `npm run check`.
 *
 * Deliberately separate from .dependency-cruiser.cjs (the diagram config): that one collapses
 * modules into folder boxes and filters the graph down to our own source, both of which make
 * these rules unable to fire. Rules need the full, uncollapsed graph — node builtins included.
 *
 * The three invariants:
 *   core  -/->  apps        the backend never reaches into the frontend
 *   shared -/-> core        (at runtime — type-only imports are erased, so they're allowed)
 *   shared -/-> node        shared ships to the browser
 */
module.exports = {
  forbidden: [
    {
      name: "core-not-to-web",
      severity: "error",
      comment:
        "The backend must not depend on the frontend. packages/core is imported BY apps/web's route " +
        "handlers, never the other way round — an edge here means server logic reached into a page " +
        "or component, and the split is no longer real.",
      from: { path: "^packages/core" },
      to: { path: "^apps/" },
    },
    {
      name: "shared-not-to-core-at-runtime",
      severity: "error",
      comment:
        "packages/shared ships to the browser, so it must never pull in the DB driver or anything " +
        "else from packages/core AT RUNTIME. Type-only imports are exempt (TypeScript erases them): " +
        "a couple of shared modules are typed against drizzle-inferred row types (PostingRow) that " +
        "can only be declared next to the schema.",
      from: { path: "^packages/shared" },
      to: { path: "^packages/core", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "shared-stays-browser-safe",
      severity: "error",
      comment:
        "packages/shared is imported by client components. A node builtin here breaks the browser " +
        "bundle — the module belongs in packages/core instead.",
      from: { path: "^packages/shared" },
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
