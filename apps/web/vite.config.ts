import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite-plus";

// The repository root, whose .env `pnpm dev:api` reads as well.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

// Where the API listens: API_HOST and API_PORT from .env, or the defaults the
// API falls back to without them (packages/config/src/app-config.ts).
const apiOrigin = (mode: string) => {
  const env = loadEnv(mode, repositoryRoot, "API_");
  const host = env["API_HOST"] ?? "127.0.0.1";
  const port = env["API_PORT"] ?? "8000";

  return `http://${host}:${port}`;
};

// The page calls the API under /api on its own origin. The dev server and
// `vp preview` forward those requests to the API without the prefix.
const apiPathPrefix = /^\/api/;

const config = defineConfig(({ mode }) => {
  const proxy = {
    "/api": {
      target: apiOrigin(mode),
      rewrite: (path: string) => path.replace(apiPathPrefix, ""),
    },
  };

  return { server: { proxy }, preview: { proxy } };
});

export { config as default };
