import { readFileSync } from "node:fs";

import { defineConfig } from "vite-plus";
import type { OxfmtConfig } from "vite-plus/fmt";
import type { OxlintConfig } from "vite-plus/lint";

// Lint and format rules live in .oxlintrc.json and .oxfmtrc.json so editors and
// the standalone oxlint and oxfmt binaries apply the same rules as `vp check`.
const readJson = (fileName: string): unknown =>
  JSON.parse(readFileSync(new URL(fileName, import.meta.url), "utf8"));

// SAFETY: oxfmt validates the file against its schema when it loads it.
const fmt = readJson("./.oxfmtrc.json") as OxfmtConfig;
// SAFETY: oxlint validates the file against its schema when it loads it.
const lint = readJson("./.oxlintrc.json") as OxlintConfig;

const config = defineConfig({
  fmt,
  lint,
  staged: {
    "*": "vp check --fix",
  },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "apps/**/*.test.ts",
            "packages/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "postgres",
          include: ["apps/**/*.postgres.ts", "packages/**/*.postgres.ts"],
          setupFiles: ["packages/database/src/test/postgres.setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});

export { config as default };
