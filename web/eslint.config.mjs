import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Lite landing boundary: the public route and its components render
    // marketing only. Simulation, match, tote, and console modules must
    // never be imported here (scripts/landing-check.mjs guards the full
    // transitive graph; this rule gives editor-speed feedback).
    files: [
      "app/page.tsx",
      "app/how-slideshow.tsx",
      "app/planet-panel.tsx",
      "app/site-header.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "**/api/**",
            "**/console/**",
            "**/arena-shell*",
            "**/city-3d*",
            "**/tote-*",
            "**/turn-*",
            "**/use-match*",
            "**/use-tote*",
            "**/use-sim-route*",
            "**/lib/sim*",
            "**/lib/direct-sim*",
          ],
        },
      ],
    },
  },
  {
    // The flat config itself is plain JS outside the TS project; leave it unlinted.
    ignores: [
      ".next/",
      "node_modules/",
      "coverage/",
      ".npm-cache/",
      "eslint.config.mjs",
      // Plain Node tooling (screenshot capture) outside the TS project.
      "scripts/",
    ],
  },
);
