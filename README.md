# Stagehand

A browser-based tool for running story-first tabletop RPGs online: a **campaign workshop** for the GM and a **stage** for play.

The single source of truth for scope, features and technology is [Project Stagehand — Technical Governance Document.md](./Project%20Stagehand%20—%20Technical%20Governance%20Document.md). Feature IDs (F0.1, F1.3, …) in commits and issues refer to it.

## Requirements

- **Node.js 24 LTS** (pinned in `.nvmrc`; `engines` rejects other majors)
- **pnpm**, provided by corepack from the `packageManager` field:

  ```sh
  corepack enable pnpm
  ```

  On Windows, if that fails with `EPERM` (the Node install folder needs admin), put the shim in a user folder on `PATH` instead:

  ```powershell
  corepack enable pnpm --install-directory "$env:APPDATA\npm"
  ```

- **Docker** with Compose v2. On Windows: Docker Desktop on WSL2.

## Getting started

```sh
pnpm install
pnpm check        # format check, lint, typecheck, tests (same as CI)
```

## Development

```sh
pnpm db:up                              # dev Postgres on 127.0.0.1:5432 (separate from production)
pnpm --filter @stagehand/server dev     # API on http://localhost:3000
pnpm --filter @stagehand/web dev        # Vite on http://localhost:5173, proxies /api and /health
pnpm db:down
```

The server reads its settings from environment variables (see [apps/server/.env.example](apps/server/.env.example)) and refuses to start if any are invalid.

## Production stack (Docker Compose)

The home-PC deployment is three containers defined in [infra/docker-compose.yml](infra/docker-compose.yml): `app` (Fastify API plus the built web client), `postgres`, and `cloudflared`.

```sh
cp infra/.env.example infra/.env        # fill in a real POSTGRES_PASSWORD
pnpm stack:up                           # build + start app and postgres, wait until healthy
curl http://127.0.0.1:8080/health       # app is published on localhost only
pnpm stack:logs
pnpm stack:down                         # data persists in the stagehand_pgdata volume
```

The tunnel container sits behind the `tunnel` Compose profile until F0.5 sets up the domain and token:

```sh
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tunnel up -d
```

Moving to a VPS means copying `infra/docker-compose.yml`, `infra/.env` and the `pgdata` volume.

## Layout

```
apps/
  web/        React + Vite client                  (@stagehand/web)
  server/     Fastify API                          (@stagehand/server)
packages/
  shared/     Zod schemas, types, shared logic     (@stagehand/shared)
infra/        Docker Compose (production + dev DB), env templates
Dockerfile    App image (server + web client)
docs/decisions/  Optional detail for Decision log entries
```

## Scripts

Run from the repo root:

| Script              | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `pnpm check`        | Everything CI runs, in order                     |
| `pnpm lint`         | ESLint (type-aware) over the whole repo          |
| `pnpm lint:fix`     | ESLint with autofix                              |
| `pnpm format`       | Prettier, write                                  |
| `pnpm format:check` | Prettier, check only                             |
| `pnpm typecheck`    | `tsc --noEmit` in every workspace + root configs |
| `pnpm test`         | Vitest across all workspaces                     |
| `pnpm test:watch`   | Vitest in watch mode                             |

| Script            | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `pnpm db:up`      | Start the dev Postgres and wait until it is healthy |
| `pnpm db:down`    | Stop the dev Postgres (data kept)                   |
| `pnpm stack:up`   | Build and start the production stack                |
| `pnpm stack:down` | Stop the production stack (data kept)               |
| `pnpm stack:logs` | Follow production stack logs                        |

Per app:

```sh
pnpm --filter @stagehand/server dev     # tsx watch
pnpm --filter @stagehand/server build   # esbuild bundle to apps/server/dist
pnpm --filter @stagehand/server start   # run the bundle with plain node
pnpm --filter @stagehand/web build
```

## Conventions

From governance §15:

- TypeScript strict (plus `noUncheckedIndexedAccess` and friends; see `tsconfig.base.json`).
- ESLint + Prettier. `any` is a lint error; any `eslint-disable` must give a reason: `// eslint-disable-next-line rule-name -- why`.
- Conventional commits with feature IDs, e.g. `feat(F1.8): proposal review screen`. A commitlint `commit-msg` hook enforces this.
- Trunk-based: short branches, merged when CI is green.

## Working assumptions (F0.1)

Per governance §1, assumptions the build relies on:

- **Workspace packages are consumed as TypeScript source.** `@stagehand/shared` exports `./src/index.ts` directly, with no build step. Vite and Vitest compile it; the server runs through `tsx` in dev.

## Working assumptions (F0.2)

- **The server's production build is an esbuild bundle** ([apps/server/scripts/build.ts](apps/server/scripts/build.ts)). `@stagehand/*` packages are inlined; every other runtime dependency stays external and is installed into the image by `pnpm deploy --prod`. This keeps native and worker-based packages (pino transports, and later sharp and pg-boss) working.
- **One origin.** The app container serves the built web client next to the API. API routes live under `/api`; any other GET that asks for HTML falls back to `index.html` for client-side routing. In dev, Vite proxies `/api` and `/health` to the server.
- **Cloudflare Tunnel is token-based** (configured in the Cloudflare dashboard, with the token in `infra/.env`). F0.5 may switch to a locally managed config file if version-controlled ingress rules become useful.
- **Logs are pino JSON on stdout,** kept by Docker's `json-file` driver with rotation (5 × 10 MB per container). This is how §6's "structured logs to file" is met.
- **Dev and production databases are separate Compose projects** (`stagehand-dev` / `stagehand`) with separate volumes, so both can run on the same PC.
- **Images are pinned by exact tag:** `node:24.22.1-trixie-slim`, `postgres:18.6-trixie`, `cloudflare/cloudflared:2026.10.7`.
- **TypeScript is pinned to 6.0.x**, not 7.x, because typescript-eslint supports TypeScript below 6.1 only. Revisit when typescript-eslint supports 7.
- **pnpm build scripts are opt-in.** Dependencies that need install scripts are listed under `allowBuilds` in `pnpm-workspace.yaml` (currently only `esbuild`).
