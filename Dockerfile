# syntax=docker/dockerfile:1

# Stagehand app image: Fastify server + the built React client, served from one origin.
# Build context is the repo root:  docker build -t stagehand-app .

ARG NODE_IMAGE=node:24.22.1-trixie-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /repo

# ---------------------------------------------------------------------------
FROM base AS build

# Manifests first, so the dependency layer is cached until a lockfile or package.json changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/prompts/package.json packages/prompts/
COPY packages/shared/package.json packages/shared/
COPY packages/style-bible/package.json packages/style-bible/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY . .
RUN pnpm --filter @stagehand/web build \
 && pnpm --filter @stagehand/server build
# Isolated production install for the server: dist/ plus runtime node_modules only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --filter @stagehand/server --prod --store-dir /pnpm/store /out/server

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    PROMPTS_DIR=/app/prompts \
    STYLE_BIBLE_DIR=/app/style-bible \
    ASSETS_DIR=/app/data/assets
WORKDIR /app

# Generated images (F2.3). Compose mounts the `assets` volume here; a new named volume copies
# this folder's owner, so the app (user node) can write to it.
RUN mkdir -p /app/data/assets && chown -R node:node /app/data

COPY --from=build --chown=node:node /out/server ./
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
# The versioned AI prompt files (F1.9). They are read from disk, not bundled; the server
# loads its prompt at startup and exits if it isn't here.
COPY --from=build --chown=node:node /repo/packages/prompts/import ./prompts/import
# The image style bible and its anchor images (F2.3), read at startup like the prompt.
COPY --from=build --chown=node:node /repo/packages/style-bible/v1 ./style-bible/v1

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "--enable-source-maps", "dist/index.js"]
