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
COPY packages/shared/package.json packages/shared/
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
    WEB_DIST_DIR=/app/web
WORKDIR /app

COPY --from=build --chown=node:node /out/server ./
COPY --from=build --chown=node:node /repo/apps/web/dist ./web

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "--enable-source-maps", "dist/index.js"]
