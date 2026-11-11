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
cp apps/server/.env.example apps/server/.env   # once; fill in the auth settings (see Authentication)
pnpm db:up                              # dev Postgres on 127.0.0.1:5432 (separate from production)
pnpm db:migrate                         # apply migrations to the dev database
pnpm --filter @stagehand/server dev     # API on http://localhost:3000
pnpm --filter @stagehand/web dev        # open http://localhost:5173 (proxies /api and /health)
pnpm db:down
```

The server reads its settings from environment variables (see [apps/server/.env.example](apps/server/.env.example)) and refuses to start if any are invalid. In dev, `apps/server/.env` is loaded automatically; production never reads `.env` files.

Open the app at **http://localhost:5173**, not :3000. Sign-in cookies and the Discord redirect are tied to that origin.

## Authentication

Sign in with Discord only, via [Better Auth](https://www.better-auth.com) (governance D-05, D-18). Sessions are rows in the `sessions` table, referenced by an HTTP-only, SameSite=Lax cookie. Sessions last 30 days and roll forward daily.

### Discord application (once)

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** ("Stagehand").
2. **OAuth2** → copy the **Client ID**; **Reset Secret** and copy the **Client Secret**.
3. **OAuth2 → Redirects**, add one per place the app runs:
   - `http://localhost:5173/api/auth/callback/discord` (dev)
   - `http://localhost:8080/api/auth/callback/discord` (local production stack)
   - `https://<domain>/api/auth/callback/discord` (F0.5)
4. Put the values in `apps/server/.env` (dev) and `infra/.env` (stack), with `PUBLIC_URL` set to the matching origin and a generated `BETTER_AUTH_SECRET`.

### Rules for new API routes

- Routes that need a signed-in user use the `requireSession(auth)` preHandler; the user is on `request.auth`.
- State-changing requests (POST/PUT/PATCH/DELETE) under `/api/` must come from `PUBLIC_URL`. A CSRF hook rejects any other `Origin` with 403. `fetch` from the web app sends the right header automatically.
- User-editable fields go through our own routes with shared Zod schemas, never through Better Auth's generic user endpoints. Those are disabled.
- Campaign data is only read or written through the data-access layer in `apps/server/src/campaigns/` (governance §7). Every function there takes a `CampaignScope` and filters by its campaign, so ids from another campaign are never found. The one unscoped lookup is joining by invite code (`campaigns/invites.ts`), where the code itself is the credential.
- Routes under `/api/campaigns/:campaignId` use the `memberOnly(auth, db)` preHandlers from `campaigns/guard.ts`, so non-members get 404. Before writing, they call `assertGm` and `assertWritable`, because archived campaigns are read-only apart from actions that only remove access (D-20, D-21). Other ids in the path go through `uuidParam`. Each such route must be added to the isolation table in `campaigns.int.test.ts`, and a guard test fails if one is missing.
- Record routes (`/api/campaigns/:campaignId/records`) are GM-only until the reveal flow (F3.5) adds the allow-listed player view. `PATCH` is partial: any subset of the top-level keys, and `fields` is a partial of that type's fields, validated with `updateRecordRequestSchemaFor(type)` and merged on the server, where `null` clears a field. Rich text is TipTap JSON validated by `richTextSchema` (D-22). Adding a record type is a shared-package change (`record-fields.ts`: shape and display spec, plus the fixture in `apps/server/test/record-fixtures.ts`), not a migration.
- Character sheet routes (`/api/campaigns/:campaignId/characters/:characterId`) are GM-only except `GET`, which also answers a player for their own PC, through the player allow-list. Anything a player may receive is built by an explicit serializer (`toPlayerCharacterSheet` in `campaigns/characters.ts`) and tested by key set. Stat block routes (`/api/campaigns/:campaignId/stat-blocks`) are GM-only.

## Database

PostgreSQL through [Drizzle ORM](https://orm.drizzle.team) with the `pg` driver. Migrations are SQL files generated by Drizzle Kit and committed in [apps/server/drizzle/](apps/server/drizzle/).

Changing the schema:

1. Edit tables under [apps/server/src/db/schema/](apps/server/src/db/schema/). Columns are camelCase in TypeScript and snake_case in SQL (`createdAt` → `created_at`).
2. `pnpm db:generate`: writes the next migration from the schema diff. Read the SQL it produced.
3. `pnpm db:migrate`: applies it to the dev database.
4. Commit the schema change and the generated migration together. CI fails if the schema has changes with no committed migration.

For SQL Drizzle can't express (extensions, data fixes), use `pnpm --filter @stagehand/server exec drizzle-kit generate --custom --name=<what>` and write the SQL by hand.

**Migrations are forward-only.** There are no down migrations: fix a bad migration with a new one. Restore from backup (F0.6) only if data was lost.

In production, the one-shot `migrate` service applies pending migrations on every `pnpm stack:up` before `app` starts. If a migration fails, `app` stays down and the error is in `docker compose logs migrate`.

### Integration tests

`pnpm test:integration` runs `*.int.test.ts` files against a real Postgres (`pnpm db:up` first). Each run creates a throwaway `stagehand_test_*` database, applies every migration with the same runner production uses, and drops the database at the end. Set `TEST_DATABASE_ADMIN_URL` to use a different server. `pnpm test` and `pnpm check` never need a database.

## Production stack (Docker Compose)

The home-PC deployment is defined in [infra/docker-compose.yml](infra/docker-compose.yml): `postgres`, a one-shot `migrate`, `app` (Fastify API plus the built web client), and `cloudflared`.

```sh
cp infra/.env.example infra/.env        # fill in passwords, secrets, Discord, tunnel and backup values
pnpm stack:up                           # build, migrate, start app + tunnel; wait until healthy
curl http://127.0.0.1:8080/health       # app is also published on localhost, for checks
pnpm stack:logs
pnpm stack:shutdown                     # back up, verify, then stop (the normal way to stop)
```

The server is only up while it's in use, so **always stop it with `pnpm stack:shutdown`**. `pnpm stack:down` stops it without a backup.

`cloudflared` belongs to the `tunnel` Compose profile, which `infra/.env` enables with `COMPOSE_PROFILES=tunnel`. Remove that line to run the stack without going live. CI never sets it.

Moving to a VPS means copying `infra/docker-compose.yml`, `infra/.env` and the `pgdata` volume.

## Going live (Cloudflare Tunnel)

Stagehand is served at **https://projectstagehand.com** from the home PC through a Cloudflare Tunnel. `cloudflared` dials out to Cloudflare, so no router ports are open and the home IP stays hidden (§14). TLS ends at Cloudflare's edge, the tunnel to the PC is encrypted, and `cloudflared` reaches the app over the internal Docker network.

One-time setup (domain DNS already on Cloudflare):

1. **Tunnel**: Cloudflare dashboard → **Networking → Tunnels → Create a tunnel**, named `stagehand-home`. Choose the **Docker** connector, copy only the token after `--token`, and put it in `infra/.env` as `CLOUDFLARE_TUNNEL_TOKEN`. Don't run Cloudflare's command; Compose runs `cloudflared`.
2. **Route**: the tunnel's **Routes** tab → **Add route → Published application**. Leave the subdomain empty, choose `projectstagehand.com`, and set the service URL to `http://app:3000`.
3. **www → bare domain**: DNS record `CNAME www → projectstagehand.com` (Proxied), plus **Rules → Redirect Rules →** the "Redirect from WWW to root" template (301, keeps path and query).
4. **SSL/TLS → Edge Certificates → Always Use HTTPS**: on.
5. **Discord app → OAuth2 → Redirects**: add `https://projectstagehand.com/api/auth/callback/discord`. `infra/.env` has `PUBLIC_URL=https://projectstagehand.com`.
6. **The PC**: Docker Desktop → Settings → General → **Start Docker Desktop when you sign in**; Windows power settings → **never sleep** while plugged in.

Checking it:

- The tunnel shows **Healthy** under Networking → Tunnels; `pnpm stack:logs` shows `cloudflared` registering connections.
- `curl https://projectstagehand.com/health` returns `{"status":"ok"}`.
- Nothing is exposed: `docker ps` publishes only `127.0.0.1:8080`, and an external port scan of the home IP (e.g. GRC ShieldsUP, "All Service Ports") finds nothing open.

If the tunnel token leaks, rotate it in the dashboard (tunnel → Configure → Refresh token) and update `infra/.env`.

## Backups

Backups are taken when the stack shuts down (D-19), not nightly, because the server is only running while someone is using it.

```sh
pnpm stack:up                           # start a session
pnpm stack:shutdown                     # end it: back up, verify, stop
pnpm stack:shutdown --quit-docker       # ...and also quit Docker Desktop / WSL to free memory
docker desktop start                    # after --quit-docker: start Docker before `pnpm stack:up`
pnpm stack:backup                       # extra backup while running (the site stays up)
pnpm stack:restore-drill                # re-check the newest backup (or pass a file)
pnpm stack:restore <file> --yes         # disaster recovery: REPLACES the live database
```

`stack:shutdown` works in this order:

1. Takes the site offline.
2. Records every table's row count.
3. Dumps the database (`pg_dump -Fc`).
4. **Proves the dump restores** into a throwaway Postgres container with identical row counts.
5. Packs the dump, a manifest and `infra/.env` into one encrypted `stagehand-<UTC time>.stbak` in `BACKUP_DIR` (`D:\StagehandBackups`, a different physical disk from Docker's data on C:).
6. Decrypts that file once more to check it.
7. Keeps the newest `BACKUP_KEEP` (30).
8. Stops the stack. The data volumes are kept.

If any backup step fails, **nothing is stopped**: the database keeps running and the error says what to do. `--skip-backup` stops without a backup and says so loudly.

Every verification is appended to `D:\StagehandBackups\restore-drill.log`, so every shutdown doubles as the §14 restore drill.

**Keep `BACKUP_PASSPHRASE` in your password manager.** It's the only way to open a backup, and it is deliberately not stored inside one. Everything else needed to restore is inside: the database plus the env file, including the secrets that decrypt stored tokens.

To restore onto a fresh machine:

1. Clone the repo.
2. Create `infra/.env` with `BACKUP_PASSPHRASE` and `BACKUP_DIR`.
3. `pnpm stack:restore <file> --yes`.
4. Copy settings from the generated `infra/.env.restored` into `infra/.env`.

Assets (Phase 2) are included automatically once a `stagehand_assets` volume exists.

**File format** (v1), so a backup can be opened without this code if ever needed:

```
"STGHBAK1" (8 bytes) | scrypt salt (16) | AES-256-GCM IV (12) | ciphertext | GCM tag (16)
key = scrypt(passphrase, salt, N=2^17, r=8, p=1, 32 bytes)
plaintext = tar of manifest.json, database.dump (pg_restore custom format), infra.env [, assets.tar]
```

## Layout

```
apps/
  web/        React + Vite client                  (@stagehand/web)
  server/     Fastify API                          (@stagehand/server)
packages/
  shared/     Zod schemas, types, shared logic     (@stagehand/shared)
infra/        Docker Compose (production + dev DB), env templates
  scripts/    Backup, shutdown and restore commands (@stagehand/infra)
Dockerfile    App image (server + web client)
docs/decisions/  Optional detail for Decision log entries
```

## Scripts

Run from the repo root:

| Script                  | What it does                                            |
| ----------------------- | ------------------------------------------------------- |
| `pnpm check`            | Everything CI runs, in order                            |
| `pnpm lint`             | ESLint (type-aware) over the whole repo                 |
| `pnpm lint:fix`         | ESLint with autofix                                     |
| `pnpm format`           | Prettier, write                                         |
| `pnpm format:check`     | Prettier, check only                                    |
| `pnpm typecheck`        | `tsc --noEmit` in every workspace + root configs        |
| `pnpm test`             | Vitest across all workspaces                            |
| `pnpm test:watch`       | Vitest in watch mode                                    |
| `pnpm test:integration` | Integration tests against Postgres (needs `pnpm db:up`) |

| Script             | What it does                                        |
| ------------------ | --------------------------------------------------- |
| `pnpm db:up`       | Start the dev Postgres and wait until it is healthy |
| `pnpm db:down`     | Stop the dev Postgres (data kept)                   |
| `pnpm db:generate` | Generate a migration from schema changes            |
| `pnpm db:migrate`  | Apply pending migrations to the dev database        |
| `pnpm db:check`    | Check the migration history is consistent           |
| `pnpm db:studio`   | Browse the dev database in Drizzle Studio           |
| `pnpm stack:up`    | Build and start the production stack                |
| `pnpm stack:down`  | Stop the production stack (data kept)               |
| `pnpm stack:logs`  | Follow production stack logs                        |

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
- **TypeScript is pinned to 6.0.x**, not 7.x, because typescript-eslint supports TypeScript below 6.1 only. Revisit when typescript-eslint supports 7.
- **pnpm build scripts are opt-in.** Dependencies that need install scripts are listed under `allowBuilds` in `pnpm-workspace.yaml` (currently only `esbuild`).

## Working assumptions (F0.2)

- **The server's production build is an esbuild bundle** ([apps/server/scripts/build.ts](apps/server/scripts/build.ts)). `@stagehand/*` packages are inlined; every other runtime dependency stays external and is installed into the image by `pnpm deploy --prod`. This keeps native and worker-based packages (pino transports, and later sharp and pg-boss) working.
- **One origin.** The app container serves the built web client next to the API. API routes live under `/api`; any other GET that asks for HTML falls back to `index.html` for client-side routing. In dev, Vite proxies `/api` and `/health` to the server.
- **Cloudflare Tunnel is token-based** (configured in the Cloudflare dashboard, with the token in `infra/.env`). F0.5 may switch to a locally managed config file if version-controlled ingress rules become useful.
- **Logs are pino JSON on stdout,** kept by Docker's `json-file` driver with rotation (5 × 10 MB per container). This is how §6's "structured logs to file" is met.
- **Dev and production databases are separate Compose projects** (`stagehand-dev` / `stagehand`) with separate volumes, so both can run on the same PC.
- **Images are pinned by exact tag:** `node:24.22.1-trixie-slim`, `postgres:18.6-trixie`, `cloudflare/cloudflared:2026.10.7`.

## Working assumptions (F0.3)

- **Drizzle is on the stable 0.x line** (drizzle-orm 0.45, drizzle-kit 0.31). Drizzle 1.0 was at release candidate when F0.3 was built; moving to it is a major upgrade and needs a Decision log entry (§6).
- **One Postgres driver: `pg`** (node-postgres), shared by Drizzle, pg-boss (Phase 2) and Better Auth (F0.4).
- **The first migration only enables `pg_trgm`**, for search (F1.6) and duplicate-name flagging (F1.8). Better Auth's tables come with F0.4.
- **`DATABASE_URL` is required outside unit tests** (`NODE_ENV=test`), so a misconfigured dev or production server fails at startup rather than on its first query.
- **The server never migrates itself.** Migrations run as a separate step (`pnpm db:migrate`, or the `migrate` Compose service) so a failed migration can't leave a half-started app.

## Working assumptions (F0.4)

- **Discord scopes are `identify email`** (D-18). Phone-only Discord accounts have no email, but Better Auth requires one, so they get a non-deliverable placeholder `<discordId>@discord.invalid`. Nothing in Stagehand sends email.
- **Better Auth's tables are generated, then adjusted.** [apps/server/src/db/schema/auth.ts](apps/server/src/db/schema/auth.ts) comes from `pnpm --filter @stagehand/server auth:generate`; every timestamp was then changed to `timestamptz`. Re-apply that if you regenerate.
- **`discordId` and `discordUsername` are `input: true`** in Better Auth's config, because `mapProfileToUser` output counts as input. They stay safe only while every endpoint that accepts user input from a client stays disabled (`/update-user`, `/sign-up/email`). An integration test checks a client can't smuggle them in.
- **Discord OAuth tokens are encrypted at rest** (`encryptOAuthTokens`). Stagehand doesn't use them after sign-in.
- **Rate limiting keys on `cf-connecting-ip`**, which Cloudflare Tunnel sets (confirm in F0.5). It's on in production only, with in-memory storage, fine for one server process.
- **Display names**: `name` and `image` refresh from Discord on every sign-in; a custom `displayName` set in Stagehand overrides the name and survives sign-ins.
- **Not yet built: account deletion.** §14's privacy notes promise it ("notes become Former player"). It needs player notes to exist first (F3.5).
- **The web client uses React Router (declarative mode), TanStack Query, Tailwind v4 and shadcn/ui** (radix base). Components live in `apps/web/src/components/ui/` and are added with `pnpm dlx shadcn@4.23.0 add <name>` from `apps/web`.

## Working assumptions (F0.5)

- **The tunnel is managed from the Cloudflare dashboard** (token in `infra/.env`). The route `projectstagehand.com → http://app:3000` and the www redirect live in Cloudflare, not in this repo.
- **`TRUST_PROXY=true` in production trusts proxies by address, not the whole chain.** Fastify trusts `X-Forwarded-*` only from loopback and private addresses (`cloudflared` on the Docker network). `cloudflared` appends the real visitor IP to any `X-Forwarded-For` the visitor sent, so the first public address from the right is the client, and spoofed entries are ignored (tested, and checked live). Hop counts don't work: Fastify treats them as "trust nothing". Better Auth separately keys sessions and rate limiting on `cf-connecting-ip`, which Cloudflare always overwrites. It stores IPv6 addresses as their /64 prefix.
- **Security headers are a baseline, not a full CSP:** `nosniff`, `Referrer-Policy`, `frame-ancestors 'self'` (F3.9 must allow Discord's Activity frame), and HSTS for one year, without `includeSubDomains`, when `PUBLIC_URL` is https.
- **Uptime depends on the PC staying signed in.** On Windows Home, Docker Desktop runs only in a signed-in session, so a reboot leaves Stagehand down until someone signs in. Containers then restart on their own (`restart: unless-stopped`). Acceptable for one group (§17); the VPS move (F4.5) removes it.
- **After going live, the local stack signs in only through the domain.** `PUBLIC_URL` is the domain, so http://localhost:8080 still serves pages, but Discord sign-in there fails the origin check. Use the dev servers (:5173) for local work.

## Working assumptions (F0.6)

- **Backups on shutdown, not nightly** (D-19). Data written since the last shutdown or `stack:backup` exists only in the Docker volume. A crash mid-session can lose it, but not anything older.
- **No off-site copy yet.** Backups sit on D:, a different physical disk from Docker's data, which protects against a disk failure but not against losing the whole PC. This is an accepted risk until hosting moves (F4.5); copying `D:\StagehandBackups` anywhere else (USB drive, cloud folder) is safe, because the files are encrypted.
- **Encryption uses Node's built-in crypto** (AES-256-GCM, scrypt key), with no extra tools. Backups are decrypted completely to a temporary file before anything is unpacked, because GCM only authenticates at the very end.
- **The restore check compares exact row counts of every table** in `public` and `drizzle`, not just that `pg_restore` succeeded.

## Working assumptions (F1.3a)

- **Rich text is TipTap/ProseMirror document JSON** (D-22) with a closed set of nodes and marks, checked by `richTextSchema` in the shared package. Limits: `RICH_TEXT_MAX_JSON_CHARS` (50,000) per field and `RICH_TEXT_MAX_DEPTH` (32). The `mention` node arrives with links (F1.5).
- **Stored `fields` are re-validated on every read** (`recordSchema.parse`), so renaming or retyping a field needs a jsonb data migration in the same commit, or reads of old rows fail.
- **Link fields live in `record_links` (F1.5), not in `fields`.** `RECORD_FIELD_SPECS` lists them as `kind: 'links'` so the display order from governance §8 is kept.
- **`visual_asset_id` is deferred** to the feature that creates its table (F2.x). `stat_block_id` arrived with stat blocks (F1.4a).
- **Records are hard-deleted.** An Area that still has Spots can't be deleted (409); a record's `type` never changes. The Spot → Area foreign key is `NO ACTION`, not `RESTRICT`, so a future cascading campaign delete can remove both in one statement.
- **Last write wins** on concurrent edits (one GM per campaign, D-14). The UI autosaves field by field (F1.3b).
- **Record names allow 120 characters**; campaign and PC names stay at 80.

## Working assumptions (F1.3b)

- **The editor is TipTap 3** (`@tiptap/react`, `@tiptap/starter-kit`, pinned at 3.33.1) with code blocks and underline turned off and headings limited to 1–3, so it can only produce what `richTextSchema` accepts; every document is still checked with `safeParse` before it is sent. `apps/web/src/lib/rich-text-compat.test.ts` runs real editor output through the schema, so a TipTap upgrade that adds an attribute fails there first.
- **Autosave, field by field.** Edits merge into one pending patch, sent after an 800 ms pause, on blur, when the page is left and on `beforeunload` (with `keepalive`). One request is in flight per record at a time, in order; a failed patch is kept under newer edits for Retry. Empty values clear a field with `null`; an unchanged value sends nothing.
- **The form owns its text after the first render.** A save's response updates the query cache but never overwrites what the GM is typing. Last write wins (one GM per campaign).
- **The records page fetches every summary once** and filters by type in the browser; the API's `?type=` filter is there for later.
- **Link fields are hidden** until F1.5; the form skips `kind: 'links'` entries of `RECORD_FIELD_SPECS`.
- **Editor styles are hand-written** in `apps/web/src/index.css` (no typography plugin); the jsdom polyfills TipTap needs live in `apps/web/src/test/setup.ts`.

## Working assumptions (F1.4a)

- **Hybrid storage for sheets and stat blocks** (D-23). Numbers that change in play (HP, Stress, Hope, armor slots, thresholds, evasion…) are integer columns with database checks: never negative, and current ≤ max for HP, Stress and armor slots. Traits and the repeating lists and sections (experiences, weapons, armor, inventory, gold, class feature, combat options; a stat block's attack, experiences, motives and features) are jsonb, checked by the shared schemas in `character-sheets.ts`, `stat-blocks.ts` and `sheet-parts.ts`.
- **Ruleset values live in `packages/shared/src/ruleset.ts`**, picked by `campaigns.ruleset_version` (1 for now). Published versions are immutable: stored sheets are re-checked on every read, so the trait list or limits of a version must never change. Rules that depend on the ruleset (trait ids and range, Hope max) are checked only in Zod; the database checks only rules that hold for any ruleset.
- **PATCH replaces each key it sends whole**, including lists and sections (send the whole `weapons` object, all six traits). Null is allowed only where it removes something: a PC's `armor` and `classFeature`, a stat block's `standardAttack`. The sheet is validated inside the row lock against the stored values, so lowering a max below its current value is refused (lower the current value first) rather than clamped.
- **Damage thresholds have no ordering rule**, so a GM can fill them in any order. Damage dice must look like `1d8` or `2d6+3`, because rolling (F3.6, F4.2) will parse them. Ranges and damage types are free text until the ruleset defines them.
- **Players read their own PC's sheet only**, at `GET …/characters/:characterId`, built from the allow-list in `playerCharacterSheetSchema` (no GM notes, no player id). Every other PC is 404, not 403. Players edit nothing in Phase 1 (D-23, 19.7).
- **Deleting a PC leaves its player in the campaign without one; deleting a stat block unlinks its NPCs** and keeps them. Both foreign keys stay `NO ACTION` as a backstop; Postgres can't `SET NULL` one column of a composite key from Drizzle.
- **Stat blocks are templates**: HP and Stress maximums only. Each copy's current values arrive with battle scenes (F4.2, 19.9). Stat block names allow 120 characters, like records.
- **New sheet columns all have defaults**, so PCs created before F1.4 became blank sheets (level 1, proficiency 1, zeros, empty lists) with no data migration.

## Working assumptions (F1.4b)

- **Autosave is generic.** `useAutosave<P>` takes the patch type and a `merge`. Records keep their key-by-key `fields` merge (`mergeRecordPatch`); sheets and stat blocks use the default shallow merge, because each key replaces its whole value (D-23).
- **The sheet editor checks each edit against the last valid values** (saved or queued) with the shared `characterSheetPatchSchemaFor`, so the browser shows the same messages as the server. A current value and its max re-check each other: lowering current HP clears the error on a lowered HP max, and both save together.
- **Rows and sections save once they have a name.** A new experience, weapon, armor or feature stays on screen with "Give it a name to save it" until it has one. Lists and sections are always sent whole. New weapons and attacks start with `1d6` damage so they're valid as soon as they're named.
- **Players see their sheet as plain text** (`CharacterSheetView`, no form controls), and rich text through `RichTextView`, which renders the stored TipTap JSON without an editor or `innerHTML`. Empty groups are hidden; GM notes never arrive.
- **Traits and ability kinds use native selects** (`components/ui/native-select.tsx`, now shared by every select in the app); numbers are plain whole-number inputs. One-click counters for HP, Stress and Hope wait for live play.
- **The name dialog is shared** by New campaign, Rename, New PC and New stat block (`CampaignNameDialog` with its own `label`, `schema` and `maxLength`).
- **The web bundle grows** with the new pages; Vite's chunk-size warning is still only a warning. Lazy-loading the editor pages remains a possible tidy-up.
