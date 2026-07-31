import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Next app is one workspace among several — point the plugin at it, or its page/route
  // detection runs against the repo root and reports phantom "no pages directory" problems.
  { settings: { next: { rootDir: "frontend" } } },
  // A leading underscore marks an intentionally-unused binding (a discarded destructure key like
  // `const { targetTitles: _t, ...rest } = c`, an unused arg). Standard convention — opt it out of
  // the unused-vars rule so the discard reads as deliberate instead of firing a warning.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "**/out/**",
    "build/**",
    "**/next-env.d.ts",
    // `data/` holds the SQLite DB and generated assets — no lintable source, and eslint
    // shouldn't walk it.
    "data/**",
  ]),
]);

export default eslintConfig;
