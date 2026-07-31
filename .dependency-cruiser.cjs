/**
 * dependency-cruiser config for the auto-generated architecture diagram.
 * Tuned for a HIGH-LEVEL view: modules are collapsed to one box per workspace sub-folder
 * (e.g. backend/src/jobs, frontend/components) so the diagram shows architecture,
 * not 400 individual files.
 *
 * This file draws PICTURES — it deliberately carries no rules, because `collapse` and
 * `includeOnly` below would neuter them (collapsed boxes and a graph with node builtins
 * filtered out can't express "shared must not import fs"). The enforced workspace boundary
 * lives in .dependency-cruiser-boundary.cjs and runs as `npm run boundary`.
 *
 * Regenerated in CI on every push — see .github/workflows/architecture-diagram.yml
 * Run locally with: npm run diagram:arch
 */
module.exports = {
  forbidden: [],
  options: {
    // Only chart the source we author; skip framework/build noise.
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "node_modules",
        "\\.next",
        "(^|/)tests/",
        "\\.test\\.(ts|tsx)$",
        "scripts/",
        "drizzle\\.config\\.ts",
        "next\\.config\\.ts",
        "postcss\\.config\\.mjs",
        "eslint\\.config\\.mjs",
      ],
    },
    // Chart only our own source — drops node builtins (fs, path) and deps.
    includeOnly: "^(frontend|backend|shared|mcp)",
    // Collapse every module to a high-level box: one per workspace sub-folder.
    collapse: "^(frontend/[^/]+|(backend|shared)/src/[^/]+|mcp)",
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
