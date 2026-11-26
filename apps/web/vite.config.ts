import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite-plus";

// The repository root, whose .env `pnpm dev:api` reads as well.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

// API_HOST is an address to listen on. One that means every interface is
// reached on the loopback interface instead.
const loopbackFor = new Map([
  ["0.0.0.0", "127.0.0.1"],
  ["::", "::1"],
]);

// The host part of a URL to the API: an IPv6 address goes in brackets.
const urlHost = (listenHost: string) => {
  const host = loopbackFor.get(listenHost) ?? listenHost;

  if (host.includes(":")) return `[${host}]`;

  return host;
};

// Where the API listens: API_HOST and API_PORT from .env, or the defaults the
// API falls back to without them (packages/config/src/app-config.ts).
const apiOrigin = (mode: string) => {
  const env = loadEnv(mode, repositoryRoot, "API_");
  const host = urlHost(env["API_HOST"] ?? "127.0.0.1");
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
