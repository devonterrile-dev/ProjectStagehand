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

### Master key for stored AI keys (once per environment)

GMs' Anthropic keys (F1.7) are stored encrypted with `CREDENTIALS_ENCRYPTION_KEY`: exactly 32 random bytes, base64url. The server refuses to start without it. Generate one per environment (dev and the stack get different keys):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Put it in `apps/server/.env` (dev) and `infra/.env` (stack), and keep the stack's copy with the backup passphrase. Backups contain only the encrypted keys, so a restore needs this value too. If it's lost or changed, stored keys can't be decrypted and GMs enter them again; nothing else is affected.

### Rules for new API routes

- Routes that need a signed-in user use the `requireSession(auth)` preHandler; the user is on `request.auth`.
- State-changing requests (POST/PUT/PATCH/DELETE) under `/api/` must come from `PUBLIC_URL`. A CSRF hook rejects any other `Origin` with 403. `fetch` from the web app sends the right header automatically.
- User-editable fields go through our own routes with shared Zod schemas, never through Better Auth's generic user endpoints. Those are disabled.
- Campaign data is only read or written through the data-access layer in `apps/server/src/campaigns/` (governance §7). Every function there takes a `CampaignScope` and filters by its campaign, so ids from another campaign are never found. The one unscoped lookup is joining by invite code (`campaigns/invites.ts`), where the code itself is the credential.
- Routes under `/api/campaigns/:campaignId` use the `memberOnly(auth, db)` preHandlers from `campaigns/guard.ts`, so non-members get 404. Before writing, they call `assertGm` and `assertWritable`, because archived campaigns are read-only apart from actions that only remove access (D-20, D-21). Other ids in the path go through `uuidParam`. Each such route must be added to the isolation table in `campaigns.int.test.ts`, and a guard test fails if one is missing.
- Record routes (`/api/campaigns/:campaignId/records`) are GM-only until the reveal flow (F3.5) adds the allow-listed player view. `PATCH` is partial: any subset of the top-level keys, and `fields` is a partial of that type's fields, validated with `updateRecordRequestSchemaFor(type)` and merged on the server, where `null` clears a field. Rich text is TipTap JSON validated by `recordRichTextSchema` (D-22; records allow @-mentions, D-24). A record comes with its outgoing `links` (every link field of its type) and `otherLinks`; PATCH sends `links` as whole id lists per field and `otherLinks` as the whole list. `GET …/records/:recordId/backlinks` lists everything pointing at a record. Adding a record type is a shared-package change (`record-fields.ts`: shape and display spec, plus the fixture in `apps/server/test/record-fixtures.ts`), not a migration.
- Errors: throw `httpError(status, message)` for anything the caller should read; its words are sent and logged as they are. Every other error goes through the same handler (`registerErrorHandler` in `http/errors.ts`, D-28), which logs its type and codes but never its message, and answers a server fault with a fixed message. So never put campaign text or a secret into an `httpError` message, and never log an error object yourself.
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
  prompts/    Versioned AI prompts, read from disk (@stagehand/prompts)
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

- **Rich text is TipTap/ProseMirror document JSON** (D-22) with a closed set of nodes and marks, checked by `richTextSchema` in the shared package. Limits: `RICH_TEXT_MAX_JSON_CHARS` (50,000) per field and `RICH_TEXT_MAX_DEPTH` (32). The `mention` node arrived with links (F1.5a), for record text only.
- **Stored `fields` are re-validated on every read** (`recordSchema.parse`), so renaming or retyping a field needs a jsonb data migration in the same commit, or reads of old rows fail.
- **Link fields live in `record_links` (F1.5a), not in `fields`.** `RECORD_FIELD_SPECS` lists them as `kind: 'links'` so the display order from governance §8 is kept.
- **`visual_asset_id` is deferred** to the feature that creates its table (F2.x). `stat_block_id` arrived with stat blocks (F1.4a).
- **Records are hard-deleted.** An Area that still has Spots can't be deleted (409); a record's `type` never changes. The Spot → Area foreign key is `NO ACTION`, not `RESTRICT`, so a future cascading campaign delete can remove both in one statement.
- **Last write wins** on concurrent edits (one GM per campaign, D-14). The UI autosaves field by field (F1.3b).
- **Record names allow 120 characters**; campaign and PC names stay at 80.

## Working assumptions (F1.3b)

- **The editor is TipTap 3** (`@tiptap/react`, `@tiptap/starter-kit`, pinned at 3.33.1) with code blocks and underline turned off and headings limited to 1–3, so it can only produce what `richTextSchema` accepts; every document is still checked with `safeParse` before it is sent. `apps/web/src/lib/rich-text-compat.test.ts` runs real editor output through the schema, so a TipTap upgrade that adds an attribute fails there first.
- **Autosave, field by field.** Edits merge into one pending patch, sent after an 800 ms pause, on blur, when the page is left and on `beforeunload` (with `keepalive`). One request is in flight per record at a time, in order; a failed patch is kept under newer edits for Retry. Empty values clear a field with `null`; an unchanged value sends nothing.
- **The form owns its text after the first render.** A save's response updates the query cache but never overwrites what the GM is typing. Last write wins (one GM per campaign).
- **The records page fetches every summary once** and filters by type in the browser; the API's `?type=` filter is there for later.
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

## Working assumptions (F1.5a)

- **One table, three kinds of link** (D-24). `record_links` holds `field` rows (the §8 link fields), `other` rows (extra links with an optional relationship label, up to 60 characters, one per pair of records) and `mention` rows (mirroring @-mentions). Backlinks are the same rows read by `to_record_id`.
- **Link fields are strict.** Each `kind: 'links'` entry of `RECORD_FIELD_SPECS` lists the record types it accepts and whether it holds `one` or `many`. The request schema caps the count; the data layer checks the types (400) and that every id is a record of this campaign (404, nothing written). Self links are refused. These rules depend on shared config, so the database only checks what never changes: both ends in the link's campaign (composite FKs), no self links, which columns each kind uses, and uniqueness.
- **Mentions are re-synced on every save that touches the text** (public description, GM notes or `fields`), from the merged record. Ids that aren't records of this campaign (deleted, from another campaign, made up) and the record's own id are dropped silently, so a deleted record never makes notes unsaveable and nothing is revealed about other campaigns. Mentions are allowed only in record text: `richTextSchema` (sheets, stat blocks) still refuses them, so a player's sheet can never carry a record id.
- **Deleting a record deletes its links both ways** (`ON DELETE CASCADE` on both composite FKs; the whole row goes, so cascading is safe). Mentions of it stay in other records' text and show as plain text. Deleting an Item also clears it from PC inventories, keeping the rows.
- **Inventory rows can link an Item** with an optional `recordId` (no migration: it's jsonb and optional). The GM's sheet keeps it; the player's own sheet gets name and detail only, and the player schema strips it as a backstop.
- **`updateRecord` locks FOR NO KEY UPDATE.** Inserting a link takes a KEY SHARE lock on its target, which FOR UPDATE would conflict with, so two records linking each other at once could deadlock. `deleteRecord` keeps FOR UPDATE.
- **When players can see records (F3.5)**, the player view must turn mentions of records they haven't been shown into plain text without the id (§7 rule 4). `RichTextView` already renders every mention as plain text.

## Working assumptions (F1.5b)

- **Link fields sit in their §8 place** on the record form: chips for what's linked (× unlinks) and a type-to-search box offering only the field's record types, never the record itself or what's already linked. A `one` field shows its box only while empty. Each change saves at once, sending the field's whole list.
- **Other links come after GM notes**: any record, with an optional relationship. Adds and removes save at once; typing a relationship is debounced like other text, and a blank one is sent as null.
- **The pickers are our own** (`RecordPicker`, `RecordOptionList`), a combobox with a listbox below it: arrow keys, Enter, Esc. No popover or command-menu dependency. The @ menu uses the same list.
- **@-mentions only exist inside a record form.** `RichTextEditor` adds the mention extension (`@tiptap/extension-mention` and `@tiptap/suggestion`, pinned at 3.33.1 and listed in `minimumReleaseAgeExclude`) when `RecordMentionsContext` is present, and then checks with `recordRichTextSchema`. Sheets and stat blocks keep plain rich text. Typing `@` lists up to 8 matching records; Enter or Tab inserts one, Esc closes the list. Backspace removes a mention whole.
- **Clicking a linked or mentioned record opens a small menu**: Open, or Open in new tab. Open waits for the record's autosave (`useAutosave().settle()`) and stays put if a save failed, so nothing typed is lost or saved out of order. Clicking away or Esc opens nothing. Backlinks are plain links that wait the same way on a normal click.
- **A mention of a deleted record** shows the name it was saved with, as plain text. A live mention shows the record's current name.
- **Backlinks sit in a side column** on wide screens (stacked below on narrow ones). The app shell widens only the record page (`max-w-6xl` through `useMatch`); every other page keeps `max-w-3xl`.
- **Backlinks are marked stale, not refetched**, after any record or sheet save, and refetch when their page opens. The open record's own backlinks never change from its own edits. Deleting a record refetches cached records, backlinks and sheets.
- **Inventory rows on the GM's sheet can link an Item** through the same picker; picking one fills a blank name. A link to an Item that no longer exists shows "Item record missing" with Unlink.

## Working assumptions (F1.6a)

- **Search looks at name, tags, public description and GM notes** (D-25), not the type-specific fields. Postgres keeps `records.search_vector` up to date itself: a generated column built by `stagehand_record_search_vector` (migration 0007), so no write path has to remember it and existing records were indexed by the migration. Its plain-text function mirrors `richTextToPlainText` (a paragraph's inline nodes joined directly, mentions as their label).
- **The `simple` text-search config**, so words are lower-cased but never stemmed: homebrew names stay as written, and "guard" finds "guards" by prefix, but "guards" doesn't find "guard".
- **Every word must match, by prefix, somewhere in the record** (`'mir':* & 'guild':*`), or the whole text must appear in the name (`ILIKE`, escaped). The terms are runs of letters and digits (`searchTerms`), so no tsquery syntax reaches Postgres. Order: exact name, name prefix, name substring, then `ts_rank_cd` (name and tags weigh most, then public description, then GM notes), then name.
- **A hit explained only by the text gets an excerpt** (`match`: field and about 140 characters around the first matching word), so the GM can see why it was found; the public description wins over GM notes. Name and tag hits have `match: null`.
- **Tag filters are "has all" and case-sensitive** (tags are stored as typed). `areaId` keeps the Spots of that Area. Every filter is still scoped to the campaign, and the route stays GM only.
- **The vector holds private text (GM notes).** When players can search (F3.5), they need a public-only vector or query, never this one.
- **Backups still restore**: both functions name their own calls with `public.` because pg_restore runs with an empty search_path. A dump and restore of the dev database gave identical vectors.

## Working assumptions (F1.6b)

- **The Records page keeps its filters in the URL** (`?type=&q=&tag=&tag=&area=`), so a reload, the back button and a shared link all show the same list. The search box writes `q` after a 250 ms pause, replacing the history entry rather than adding one per keystroke; Esc clears it.
- **Two lists**: the unfiltered one (tag chips, the Area options, "no records yet") and, while a search, tag or Area is set, the server's search (`useRecordSearch`), which keeps showing the previous results while the next ones load. The type chips still filter in the browser and count the current matches.
- **Tags are a row of toggle chips**, every tag in the campaign; a record must have all the selected ones. A selected tag no record has any more stays visible so it can be turned off.
- **The Area filter shows only while Spots are shown**, and picking another type drops it.
- **A hit found in the text shows an excerpt** naming the field ("GM notes: …"), with the matching words in bold. The bolding is React text, never HTML.
- **Quick jump** (header button, Ctrl+K or Cmd+K, also from inside the editor) is GM only and only inside a campaign. It finds records through the same search (8 at most) and stat blocks and PCs by name in the browser (5 each). With nothing typed it lists the 5 items opened most recently in that campaign, kept in this browser's localStorage as kinds and ids only; items since deleted are skipped, and blocked storage just means no recents.
- **Quick jump waits for saves before leaving.** Every autosave registers with `lib/pending-saves.ts`; if a save fails, the GM stays on the page, where the save status offers Retry. Ctrl/Cmd+Enter (or Ctrl/Cmd+click) opens the item in a new tab instead.

## Working assumptions (F1.7)

- **One key per user per provider, not per campaign** (`provider_credentials`, primary key user + provider). A GM's key serves every campaign they run. Anyone signed in can open Settings, because anyone can create a campaign; the key is only ever used for that user's own AI imports (F1.8).
- **AES-256-GCM with a server-only master key** (`credentials/crypto.ts`, D-26). Stored as `v1.<iv>.<ciphertext>.<tag>` (base64url, fresh 12-byte IV each time). The associated data names the user and provider, so a value copied onto another row doesn't decrypt. There is no key rotation yet; the `v1` prefix leaves room for it.
- **A key is decrypted in one place**, `getProviderKey` in `credentials/store.ts`, for the outgoing call only. No route decrypts: `GET /api/me/credentials` returns provider, last four characters and date, through a shared schema with no key field. A value that can't be decrypted throws `CredentialUnreadableError`, and F1.8 will ask the GM to enter the key again.
- **Saving checks the key with Anthropic first** (`providers/anthropic.ts`): `GET /v1/models` through the official `@anthropic-ai/sdk`, which costs no tokens, with no retries and a 10-second timeout. 401 or 403 → 400 with the reason, 429 → 503, anything else (network, timeout, 5xx) → 502. A refused key is never stored, and a failed replacement keeps the old key.
- **The key leaves the browser once.** The settings form reads it from the field on submit, clears the field afterwards and resets the mutation, so it isn't kept in React state or the query cache. The page shows only "Key ending in …abcd".
- **Logs never carry a key.** The request serializer logs no headers or bodies, pino `redact` (`LOG_REDACT_PATHS` in `app.ts`) censors `apiKey`, `encryptedKey`, `authorization` and `cookie` fields if anything ever logs them, the Anthropic SDK runs with `logLevel: 'off'`, and refusals are answered directly rather than thrown. The integration test runs the routes with a trace-level logger and scans every line and every response for the keys and ciphertexts.
- **No rate limit on saving a key yet.** Each save makes one free Anthropic call; per-user rate limits arrive with the AI import route (F1.8, §14).
- **OpenRouter has no routes yet** (F2.2). The table already allows `openrouter`, and its paths answer 404.

## Working assumptions (F1.9a)

The prompt, the proposal schemas and the Markdown conversion for the AI import (governance §10). Nothing here calls Anthropic; F1.8a adds the call and the Decision log entry (D-27).

- **The model writes a flat, type-agnostic answer** (`importWireSchema` in `packages/shared/src/ai-import.ts`): `creates`, `updates`, `links`, `questions`. Anthropic's structured output refuses recursive schemas and allows at most 24 optional and 16 union-typed properties, so every property is required (an empty string or list means "nothing"), a record's fields travel as `{ key, value }` pairs, and rich text travels as Markdown. A test checks the schema has no optional property, union or reference.
- **The real rules are enforced on the server** (`apps/server/src/ai-import/validate.ts`) against the same schemas the record API uses: field keys and values per type, link targets and cardinality, a Spot's Area, ids that exist or are created in the same answer. What the model couldn't have known better is fixed quietly (the letter case of a choice, blank values, over-long tags); everything else becomes an issue written for the model, to be sent back once.
- **Records are named to the model by short refs**, `E1…` for existing ones and `N1…` for new ones, never by UUID. Each proposed record gets its real id when it is validated, so proposals of one import can link to and mention each other before anything is saved.
- **Only records shown in full can be updated.** An update replaces a field's whole value, so the model must have read what it replaces; any record can still be linked. A value that says what the record already says is dropped, and so is an update left with no changes. In `fill` mode a field that already has content is never touched.
- **Links have one home.** A link from a proposed record is folded into its create proposal; a link from an existing record is a proposal of its own. A link field belongs to the from-record's type, exactly as in the record API.
- **Markdown ↔ rich text** (`ai-import/markdown.ts`) uses the `marked` lexer and only ever produces the closed node set of `recordRichTextSchema`. Tables, code blocks, images and HTML are kept as plain text. A single newline is a line break. A mention is `[[E3]]`; an unknown ref stays as text and is reported.
- **Prompts are files**, `packages/prompts/<task>/v<N>.md`, read from disk at startup: from the package in dev, from `PROMPTS_DIR` (`/app/prompts`) in the image. A missing file stops the server with a clear message. The leading `<!-- … -->` note is not sent to the model, and Prettier leaves these files alone. A released version is never edited: copy it to the next number and bump `IMPORT_PROMPT_VERSION`.
- **The prompt's field lists are generated** from `RECORD_FIELD_SPECS` into `{{fields_<type>}}` slots, so the prompt can't name a field the schemas lack. A slot without a value, or a value without a slot, is an error. A changed field label therefore changes the prompt text without a version bump; the eval suite (F1.9b) is the check for that.
- **Limits and prices are config** (`AI_IMPORT_LIMITS`, `AI_MODEL_PRICES` in the shared package): 40,000 characters of notes, 80 new records per import, 20 imports per GM per hour, and Sonnet 5.5 at $2 / $10 per million tokens. The limits are first guesses until real imports and the eval say otherwise.

## Working assumptions (F1.8a)

The AI import pipeline on the server (governance §10, D-27). The pages arrive with F1.8b; until then the routes can be driven by hand.

- **Routes** (`routes/ai-imports.ts`), GM only, writes refused while archived: `POST …/imports/estimate`, `POST …/imports` (202), `GET …/imports`, `GET …/imports/:importId`, `PATCH …/imports/:importId/proposals/:proposalId`, `POST …/imports/:importId/accept-all`, `…/commit`, `…/discard`, and `GET /api/me/usage`.
- **An import runs in the background of the API process** (`ai-import/runner.ts`). `POST …/imports` stores a `running` row and answers 202; the browser polls `GET …/imports/:importId` until it is `ready` or `failed`. There is no queue: an import that was running when the server stopped is marked failed (`interrupted`) at the next start, and on shutdown the calls in flight are cancelled. In dev, `tsx watch` restarting the server interrupts a running import the same way.
- **One pipeline for the app and the eval** (`ai-import/generate.ts`): build the message, call the model, check the answer, send it back once with its problems, give up with those problems. It has no database in it; F1.9b's `pnpm eval` calls the same function.
- **The call** (`providers/anthropic.ts`): `claude-sonnet-5-5`, streamed, `output_config.effort` `medium`, structured output from `importWireSchema`, the prompt file marked cacheable, up to 32,000 output tokens, a 10-minute timeout and two SDK retries for calls that fail before any answer. No sampling parameters and no `thinking` switch: this model thinks adaptively and refuses both. We parse the answer ourselves, so a refusal or a cut-off answer is a status, not an SDK parse error. The model's own turn (thinking blocks included) is sent back unchanged on the retry. The schema as sent is the SDK's conversion of `importWireSchema`; a provider test checks that every object in it is closed and every property required.
- **What the model is told** (`ai-import/context-pack.ts`): every record by ref, type and name; a one-line summary for every Faction and Area and for the neighbours of full records; full content for the records the notes name and the record being filled in. A name matches as a whole, or by a word of four or more letters that no other record's name has. The budget is 80,000 characters; a record that doesn't fit in full drops to a summary, then to the index. Refs are assigned by type, then name.
- **Proposals are rows** (`ai_proposals`), each with the payload as it stands and the payload the model made. An accepted proposal whose payload differs from the model's is `edited`. Editing can't change what a proposal is about, can remove links but not add them, and can drop an update's changes but not add new ones. A Spot's Area can be changed to any Area of the campaign or one the same import proposes.
- **The review reads the campaign fresh.** Each time the import is loaded, an update's `before` is the record as it is now, possible duplicates are looked up by name (equal, similar, or one name inside the other, by `pg_trgm`), and a link to a field that holds one record says what it would replace. A record deleted since shows as `before: null`.
- **Commit is one transaction** (`commitImport` in `campaigns/ai-imports.ts`): new records under the ids their proposals carry (Areas, then the rest, then Spots), then their links, then updates, then links from existing records. Pending counts as not accepted. A Spot whose proposed Area was left out refuses the commit and names both. Links to left-out or deleted records are dropped silently; an update or link whose own record is gone is skipped and listed in `skipped`. A link to a field that holds one record replaces what it held; a field that holds many gains the link. Updated records keep their `source`; only new records get `source = ai_import` and `ai_import_id`.
- **Guardrails**: notes up to 40,000 characters; 20 imports per GM per hour, counted from `ai_imports`; one running import per GM, enforced by a unique index; an import still `running` after 45 minutes is treated as dead when its GM starts another. No stored key answers 409 pointing at Settings.
- **The estimate is a real token count** (`messages.countTokens`, free) of the exact request, plus a guess at the answer: about twice the notes plus 1,500 tokens for `likely`, and two full-length answers for `max`. The guess is uncalibrated until the eval has run.
- **Failures are stored with a code**, not a sentence (`IMPORT_ERROR_CODES`); the message shown comes from `IMPORT_ERROR_MESSAGES` in the shared package. For `invalid_output` the details are the validator's problems; for `bad_request` they are Anthropic's own message, which describes the request (too large, out of credit), not its content.
- **Nothing private is logged.** The notes and proposals are in `LOG_REDACT_PATHS`, a failed import logs only the error's type, and the import tests scan a trace-level log for the notes, the answer, record names and the key. That scan found that a failed database write logged its parameters; D-28 fixed it for every route.
- **Not built yet**: adding links in review, turning a flagged duplicate into an update, choosing the model or effort in the UI, and the refusal fallback (a beta at Anthropic).

## Working assumptions (F1.8b)

The AI import pages (governance §10, D-27, D-29). The server side is described under F1.8a.

- **Routes**: `/campaigns/:campaignId/import` (a new import, with the campaign's past imports and their cost below) and `/campaigns/:campaignId/imports/:importId` (waiting, then review). Both are GM only; players see the players' note. The entry points are an "AI import" card on the campaign page, an "AI import" button on the Records page and "Fill in with AI" on a record's page (it opens the form in fill mode for that record). None is shown while the campaign is archived.
- **The form**: notes (up to 40,000 characters, counted as you type), a mode, and an optional "only create" type filter. "Start a campaign" is offered only while the campaign has no records, and "Fill in a record" only once it has some. Without a stored Anthropic key the form is replaced by a link to Settings; a 409 about the key also links there. `?from=<importId>` refills the form from an earlier import, which is how "Try again" keeps the notes.
- **The cost is checked on request** (D-29): "Check cost" calls the free estimate and shows the likely and the most an import could cost. Nothing is checked automatically before sending. The estimate disappears as soon as the form changes.
- **Waiting**: sending answers at once and moves to the import's page, which polls every 2 seconds while the import is `running` (`importPolling` in `lib/queries.ts`). The page is addressed by the import's id, so a reload or a later visit picks the import up where it is.
- **Review**: the model's questions on top, then three sections: new records (Areas, then Spots, then the other types, each in the model's order), changes to existing records, and links. A bar above them counts accepted, rejected and pending proposals and holds Accept all, Save accepted and Discard.
- **Cards**: Accept, Reject, Edit, Undo (back to pending) and Restore original (once edited). Saving an edit accepts the proposal; the server stores it as `edited` when it differs from the model's. A new record's editor has the record page's inputs, and its links can only be removed. A change can be reworded or have parts dropped, never gain new ones, and an emptied value drops that part. A free-form link's relationship can be edited; a link that fills a link field can only be accepted or rejected. Proposed records show as "new" chips without a page; existing ones open in a new tab.
- **Saving**: pending proposals are not saved. Save accepted asks first when any are still pending, then lists what was created and changed, how many links were added, and what was skipped and why. The server's refusals (nothing accepted, a Spot whose Area was left out) are shown as the server words them. Saving refreshes every cached record, record list and backlinks list.
- **Failed imports** show the GM-facing message, the raw problems under "What went wrong", Try again and Discard.
- **Settings** has an "AI import usage" card under the key: totals (imports, tokens in and out, estimated cost) and the newest imports, from `GET /api/me/usage`.
- **Tests**: `src/AiImport.test.tsx` against the harness's imports world (`src/test/imports-world.ts`), which follows the server's rules and messages: an import answers on its second read, notes containing `gibberish` fail, notes containing `busy` are refused as a second running import.
