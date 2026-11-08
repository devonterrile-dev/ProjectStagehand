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

## Getting started

```sh
pnpm install
pnpm check        # format check, lint, typecheck, tests (same as CI)
```

## Layout

```
apps/
  web/        React + Vite client                  (@stagehand/web)
  server/     Fastify API                          (@stagehand/server)
packages/
  shared/     Zod schemas, types, shared logic     (@stagehand/shared)
infra/        Docker Compose, tunnel, backups      (from F0.2)
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

Per app:

```sh
pnpm --filter @stagehand/server dev   # http://localhost:3000/health
pnpm --filter @stagehand/web dev      # Vite dev server
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

- **Workspace packages are consumed as TypeScript source.** `@stagehand/shared` exports `./src/index.ts` directly, with no build step. Vite and Vitest compile it; the server runs through `tsx`. The server's production build (bundling) is decided in F0.2 with the Dockerfile.
- **TypeScript is pinned to 6.0.x**, not 7.x, because typescript-eslint supports TypeScript below 6.1 only. Revisit when typescript-eslint supports 7.
- **pnpm build scripts are opt-in.** Dependencies that need install scripts are listed under `allowBuilds` in `pnpm-workspace.yaml` (currently only `esbuild`).
