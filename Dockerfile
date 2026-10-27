# syntax=docker/dockerfile:1.27.1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# One image runs the API (default command), the worker, the one-shot worker and
# migrations, and carries deploy/vps for the server's bin/release. Building it
# runs `pnpm check`, so the image cannot be built from code that fails
# formatting, lint, type checking or unit tests.
#
# node:26.12.1-trixie-slim. Keep the version equal to devEngines.runtime in
# package.json; the `workspace` stage fails the build when they differ.
ARG NODE_IMAGE=node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec

FROM ${NODE_IMAGE} AS workspace
# Node 26 ships without Corepack. Install the pinned pnpm before entering /app:
# npm refuses to run inside a project whose devEngines names pnpm.
RUN npm install --global pnpm@12.15.0 && npm cache clean --force
# The `prepare` script installs Git hooks, which a build has no use for.
ENV VP_GIT_HOOKS=0
WORKDIR /app
# Manifests first, so dependency layers are reused until one of them changes.
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml apps/*/package.json packages/*/package.json ./
RUN test "$(node --version)" = "v$(node -p 'require("./package.json").devEngines.runtime.version')"

# Every dependency, then the full repository check. The lockfile pins Node as a
# devDependency (devEngines.runtime), so this install also downloads and
# verifies that same Node version, which pnpm's scripts then run on.
FROM workspace AS check
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
# deploy/ holds no code; leaving it out keeps a deployment-only change from
# rerunning the checks. CI's `check` job still checks its formatting.
COPY --exclude=deploy . .
RUN pnpm check && touch /checks-passed

# Production dependencies only, from a fresh install: pruning the full install
# would leave the dev toolchain behind. Without devDependencies there is no
# Node download, and --ignore-scripts skips `prepare`, whose `vp` is a
# devDependency. Workspace packages stay pnpm symlinks, which Node resolves to
# their real paths, so their TypeScript is not treated as node_modules code.
FROM workspace AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod --ignore-scripts --store-dir /pnpm/store

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Depending on the check stage keeps failing code out of the image.
COPY --from=check /checks-passed /checks-passed
COPY --from=deps /app ./
COPY apps ./apps
COPY packages ./packages
COPY drizzle ./drizzle
COPY scripts/smoke-api.ts ./scripts/smoke-api.ts
# bin/release on the server copies compose.yml and bin/ out of the image it
# releases; see deploy/vps/README.md.
COPY --exclude=bin deploy/vps ./deploy/vps
COPY --chmod=755 deploy/vps/bin ./deploy/vps/bin
# Files stay owned by root; the application runs as the image's `node` user.
USER node
EXPOSE 8000
# Node is PID 1 so it receives stop signals directly; never start through pnpm.
CMD ["node", "apps/api/src/main.ts"]
