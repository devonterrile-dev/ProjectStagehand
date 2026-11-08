# Project Stagehand — Technical Governance Document

Nov 7, 2026 · @Devon T

## 1. Purpose and how to use this document

This document is the single source of truth for what Stagehand is, which features it has, and which technologies build them. When code and this document disagree, one of them is wrong and gets fixed the same day.

- **Scope:** features, data model, rules engine, AI and image pipelines, the stage, live sessions, security, infrastructure, budget and risks.
- **Status:** approved baseline, v1.0. All decisions below were agreed on 2026-11-07 unless marked otherwise.
- **Changing it:** any change to a decision adds a row to the Decision log (section 18) with the date, the change and why. Superseded decisions stay in the log, marked superseded.
- **Open items:** anything not yet decided lives in Open questions (section 19). Building on an open item is fine if the build notes the assumption it used.
- **Terminology:** *GM* = game master (campaign owner). *Player* = a person in the campaign. *PC* = player character. *Record* = any campaign entry (NPC, location, faction…). *Scene* = a saved stage arrangement. *Session* = one live play night.

## 2. Project overview

Stagehand is a browser-based tool for running story-first tabletop RPGs online. It has two halves: a **campaign workshop** where the GM turns ideas into structured notes fast, and a **stage** where those notes come to life for players during play.

It sits between two existing kinds of tool. 2D map tools (Roll20, Foundry) are quick for GMs but add little immersion. 3D tools (TaleSpire) are immersive but slow to build and let players wander. Both are built around grid combat, not roleplay.

### Objectives

1. **GM speed.** A GM can brain-dump ideas and get organized, linked, consistently formatted records back through AI, with review before anything is saved.
2. **A stage for the story.** Players see where they are and who they're talking to, on a cartoony paper-theater stage, with enough freedom to emote and explore without wandering off.

### Design principles

- **Story over grid.** No measurement, distance or tactical movement systems. Position on stage is about framing, not rules.
- **Same shape every time.** Every record of a type has the same fields in the same order, so the GM always knows where to look mid-session.
- **Private by default.** Nothing reaches a player until the GM reveals it.
- **Human sign-off.** No AI output, text or image, is saved without GM approval.
- **Players install nothing.** Players join from a browser or a Discord Activity. Only the GM hosts.
- **Swappable parts.** AI models, image models, storage and speaking detection each sit behind an interface so one can be replaced without a rewrite.
- **Cartoony with 90s charm.** Paper Mario cardboard cutouts with Dexter's Lab flat colors and bold dark outlines.

## 3. Constraints

These are fixed. A design that breaks one needs a Decision log entry first.

| Constraint | Value | What it means for the build |
| --- | --- | --- |
| Team | 1 developer | Favor boring, well-documented tools. One language end to end. |
| Primary language | TypeScript (JS background; C# and Python available) | Frontend, backend and shared code all in TypeScript. |
| Timeline | Under 12 months to a playable, shareable version | Phased roadmap with a playtestable MVP around month 8. |
| Budget | A few hundred USD per year, total | Free tiers and self-hosting. Each GM pays their own AI usage. |
| Hosting | Developer's personal PC at first | Containerized so it can move to a VPS without code changes. |
| Room size | 1 GM + up to 6 players per live session | Room locks at 6 players. Audience mode is deferred. |
| GMs per campaign | Exactly 1 | No co-GM permissions. |
| Players' setup | Browser only (or Discord Activity) | No downloads or plugins for players. |
| Multi-group use | Other groups will use it eventually | Multi-campaign, multi-user from day one, with strict campaign isolation. |
| Ruleset | Homebrew, 2d12 Hope/Fear core | Rules live in one shared engine with ruleset values in config. Official Daggerheart text and layouts are not copied. |

## 4. Scope and roadmap

The build runs in five phases. The first playtest with a real group is the exit of Phase 3, around month 8. The workshop comes first so the stage is built on real records. Month 12 is held as buffer.

&#91;embedded content: Roadmap · 5 phases and a buffer month, 4 exit gates\]

Each phase ends at its gate; the next phase starts only when the gate's exit criterion below is met.

Feature IDs (F1.3, etc.) are referenced from issues, commits and the rest of this document. Tick items off as they ship.

### Phase 0: Foundation (weeks 1–3)

- [x] F0.1 Monorepo, TypeScript strict mode, lint/format, CI (lint, typecheck, tests)
- [x] F0.2 Docker Compose: app server, PostgreSQL, Cloudflare Tunnel
- [x] F0.3 Database migrations pipeline (Drizzle Kit)
- [ ] F0.4 Sign in with Discord, session handling, user profile
- [ ] F0.5 Domain + tunnel live over HTTPS from the home PC
- [ ] F0.6 Nightly backup script (database dump + asset folder)

### Phase 1: Campaign workshop (months 1–3)

- [ ] F1.1 Campaigns: create, rename, archive. Each GM can own many campaigns.
- [ ] F1.2 Invites: GM shares an invite link, players join, GM assigns each player a PC
- [ ] F1.3 Records for every narrative type: NPC, Area, Spot, Faction, Lore, Story beat, Item, Session notes (section 8)
- [ ] F1.4 Character sheets for PCs, stat blocks for monsters and NPCs
- [ ] F1.5 Links between records, with a backlinks panel and @-mentions inside note fields
- [ ] F1.6 Search and filter across a campaign's records
- [ ] F1.7 Settings: GM stores an Anthropic API key (encrypted)
- [ ] F1.8 AI import: brain-dump to proposed records, with a review screen (section 10)
- [ ] F1.9 Prompt files, schemas and eval suite for AI import

**Exit:** your current campaign is entered, mostly through AI import, and every record is approved.

### Phase 2: Visual assets (months 3–5)

- [ ] F2.1 Style bible v1, asset templates per type, anchor reference images (section 11)
- [ ] F2.2 Settings: GM stores an OpenRouter API key (encrypted)
- [ ] F2.3 "Generate visual" button on records; background job queue
- [ ] F2.4 Post-processing: transparency, cardboard border, palette, sizing
- [ ] F2.5 Review: approve, regenerate with notes, reject
- [ ] F2.6 Manual upload as a fallback, through the same post-processing
- [ ] F2.7 Asset library per campaign

**Exit:** at least 20 assets across characters, props, monsters and backdrops look like one set when placed side by side.

### Phase 3: Stage MVP and first playtest (months 5–8)

- [ ] F3.1 3D theater stage with backdrop, ground, cutouts and clickable prompts (section 12)
- [ ] F3.2 Scene builder: drag records onto the stage, save and load scenes
- [ ] F3.3 Static location scene type
- [ ] F3.4 Live sessions: start, join (6-player cap), presence, reconnect (section 13)
- [ ] F3.5 Reveal flow, player journal, click-a-prop popups, shared player notes
- [ ] F3.6 Players view their own sheet; GM calls rolls; Hope and Fear tracking; roll log (section 9)
- [ ] F3.7 Cutout animations and a player emote menu
- [ ] F3.8 GM "take over" an NPC
- [ ] F3.9 Speaking detection: browser mic and Discord Activity

**Exit:** one full session played with your group on Stagehand.

### Phase 4: Richer scenes and polish (months 8–11)

- [ ] F4.1 Transition scenes: looping backdrop, walking wobble
- [ ] F4.2 Battle scenes: combat options picked from the sheet, HP and Stress tracking, GM stat block panel
- [ ] F4.3 Session recap tools (session notes plus the session's roll and reveal log)
- [ ] F4.4 Onboarding for other GMs: setup guide, key setup help, invite flow polish
- [ ] F4.5 Move to a VPS if other groups join

**Exit:** a second group runs a session without your help.

### Deferred (not in the 12-month plan)

- Rigged 3D characters replacing cutouts
- Expression variants per character
- Audience mode beyond 6 players
- Choosing among several text or image models in the UI
- A custom-trained style model
- Customizable sheets and rulesets per campaign
- Built-in voice chat, music and ambience, maps

## 5. System architecture

Stagehand is one Node server plus PostgreSQL, running in Docker on the home PC. Browsers reach it through Cloudflare Tunnel, and only the server talks to Anthropic and OpenRouter, using each GM's stored keys.

&#91;embedded content: System architecture · 3 clients, 1 home server, 3 external services\]

Players' browsers never hold a key or call an AI provider. The Job worker runs image generation in the background so the API stays responsive; AI note import runs inside the API request, since the GM is waiting on the review screen.

## 6. Technology stack

Everything is TypeScript, with React on the client, Fastify and Socket.IO on the server, and PostgreSQL for storage. Anything external (AI, images, storage, speaking) sits behind an interface in our code so it can be swapped.

| Layer | Choice | Why | Alternatives considered |
| --- | --- | --- | --- |
| Language | TypeScript, strict mode | One language for client, server and shared rules; matches your JS background | C#, Python for parts |
| Monorepo | pnpm workspaces | Shares types, schemas and the rules engine between client and server | Separate repos |
| Frontend | React + Vite (single-page app) | Largest ecosystem, and needed for React Three Fiber | Next.js, SvelteKit |
| UI kit | Tailwind CSS + shadcn/ui | Fast, consistent forms and panels for a solo dev | MUI, Chakra |
| Rich text fields | TipTap | Notes fields with formatting and @-mention links | Plain textareas, Lexical |
| Client data | TanStack Query + Zustand | Server cache and live-session state, kept separate | Redux |
| 2D drag and drop | dnd-kit | Scene builder tray and lists | react-dnd |
| 3D stage | Three.js via React Three Fiber + drei | Mature WebGL in the browser, React-friendly, cutouts are simple textured planes | Babylon.js, PlayCanvas, Godot web export |
| Backend | Node.js LTS + Fastify | Fast, typed, plugin-based; long-running process suits live rooms | Express, NestJS, Next.js API routes |
| Real-time | Socket.IO | Rooms, reconnects and acknowledgements built in; plenty for 7 people per room | Colyseus, raw WebSockets |
| Validation | Zod | One schema per record type, used by forms, API, database checks and AI output | Yup, io-ts |
| Database | PostgreSQL | Heavily linked records, JSON columns for flexible fields, full-text search | SQLite, MongoDB |
| ORM and migrations | Drizzle ORM + Drizzle Kit | Close to SQL, light, typed | Prisma |
| Background jobs | pg-boss (queue stored in Postgres) | Image generation jobs without adding Redis | BullMQ + Redis |
| Auth | Better Auth, Discord OAuth | Discord login also gives the Discord ID needed for speaking detection | Auth.js |
| Text AI | Claude Sonnet 5.5 (`claude-sonnet-5-5`) via Vercel AI SDK | Strong structured output; the SDK keeps the provider swappable | Direct Anthropic SDK, OpenAI, Gemini |
| Image AI | OpenRouter, model `openai/gpt-image-2` | One key reaches many image models; no OpenAI ID verification for GMs | OpenAI direct, Replicate, Google direct |
| Image processing | sharp | Resize, borders, palette mapping, format conversion | ImageMagick |
| File storage | Local disk behind a storage interface | Free now; switch to S3-compatible storage (e.g. Cloudflare R2) by config later | Cloud storage from day one |
| Speaking detection | Discord Embedded App SDK + Web Audio API | Official speaking events inside Discord; local mic detection elsewhere | Discord voice bot (rejected, section 13) |
| Hosting | Docker Compose on the home PC + Cloudflare Tunnel | No open router ports, free HTTPS, portable to a VPS | Port forwarding, cloud host now |
| Testing | Vitest (unit, integration) + Playwright (end-to-end) | Fast, TypeScript-native | Jest, Cypress |
| CI | GitHub Actions | Free for this size of project | — |
| Logging | pino (Fastify's logger) | Structured logs to file | Winston |

Versions are pinned in the lockfile. Upgrades to a major version of any row above get a Decision log entry.

## 7. Users, roles and visibility

Every person has one account and signs in with Discord. Their role is set per campaign: the campaign owner is its GM, and everyone they invite is a player. A user can be a GM in one campaign and a player in another.

### Roles

| Capability | GM | Player |
| --- | --- | --- |
| Create, edit, delete records, scenes, sheets, stat blocks | Yes | No |
| See private fields | Yes | Never |
| See revealed records (public layer) | Yes | Yes |
| Add notes to revealed records | Yes | Yes |
| Edit or delete a note | Any note | Own notes only |
| View own PC sheet | Yes (all sheets) | Own sheet only |
| Edit own PC sheet | Yes | Hope spending and combat option picks during play; other edits by GM (open question 19.7) |
| Start a session, load scenes, call rolls, spend Fear | Yes | No |
| Emote, click prompts, roll when called | Yes (through NPCs) | Yes |
| Run AI import, generate images | Yes, with own keys | No |

### Campaign isolation

- Every campaign-scoped table carries `campaign_id`. Every query is filtered by it through one data-access layer; no route builds its own unscoped query.
- A GM's two campaigns never share records. Copying between campaigns is a deliberate export/import action (deferred).
- Automated tests try to read another campaign's data through every API route and must fail.

### Joining a campaign

1. GM creates an invite link (single campaign, optional expiry, revocable).
2. Player opens it, signs in with Discord, and becomes a campaign member.
3. GM assigns the player a PC (a character sheet record). One PC per player per campaign.

### Visibility: private by default

Every narrative record has two layers:

- **Public layer:** name, public description, and the approved visual. This is all a player can ever receive.
- **Private layer:** every other field (personality, secrets, knowledge, stats, GM notes).

Rules:

1. New records are hidden. Players receive nothing about them.
2. A record becomes revealed when the GM clicks Reveal, or automatically when it is shown in a live scene.
3. Once revealed, it stays in that campaign's player journal permanently. The GM can un-reveal it (undo for mistakes).
4. Revealing a record does not reveal the records it links to.
5. The server builds player-facing responses from an explicit allow-list of public fields. Private fields are never sent to a player's browser, even hidden, and tests enforce this.

### Player notes

On any revealed record, players (and the GM) can add notes beneath the GM's public description. Notes are visible to every member of the campaign, show their author and time, and can be edited or deleted only by their author. The GM can delete any note.

## 8. Data model

Narrative records share one `records` table with common columns, plus a `fields` JSON column whose shape is fixed per type by a Zod schema. Things with heavy mechanics or live state (character sheets, stat blocks, scenes, sessions) get their own tables.

Why this split: one table makes links, search, reveal, player notes and visuals work identically for every record type, and adding a type means adding a schema, not a migration. Mechanical data changes every turn in play and needs real columns and constraints.

### Common record columns

| Column | Type | Notes |
| --- | --- | --- |
| id | UUID | Primary key |
| campaign\_id | UUID | Required; isolation key |
| type | enum | npc, area, spot, faction, lore, story\_beat, item, session\_notes |
| name | text | Public |
| public\_description | rich text | Public; what players see when revealed |
| fields | JSON | Private, type-specific; validated by the type's Zod schema |
| gm\_notes | rich text | Private, free-form catch-all |
| parent\_id | UUID, nullable | Only for spot → area (two-level locations) |
| visual\_asset\_id | UUID, nullable | The approved visual |
| stat\_block\_id | UUID, nullable | NPCs only, optional |
| revealed\_at | timestamp, nullable | Null = hidden from players |
| tags | text\[\] | Free tags for filtering |
| source | enum | manual, ai\_import |
| created\_at, updated\_at | timestamps |  |

### Record types and their fields

Fields appear in this order on every record of the type, so the GM always knows where to look. All are optional except name.

| Type | Purpose | Private fields, in display order |
| --- | --- | --- |
| NPC | Anyone the party might talk to | Appearance (for visuals); personality; voice and mannerisms; wants and motivations; what they know; secrets; role in the story; status (alive, dead, missing, unknown); home spot (link); factions (links) |
| Area | A general place: city, town, beach, forest | Kind of place; overview; atmosphere (sights, sounds, smells); notable features; factions present (links); hooks; secrets |
| Spot | Where the party actually stands: the market, the crashed boat, an NPC's house. Always belongs to one Area | Description for the GM to read out; points of interest (become clickable prompts); NPCs usually here (links); items here (links); hidden details; backdrop notes (for visuals) |
| Faction | Any organized group | Goals; leaders (NPC links); members (NPC links); resources; allies and enemies (faction links); public reputation; secrets |
| Lore | History, legends, religion, magic, anything world-level | Category; summary; full details; who knows it (links); what's true vs. what people believe |
| Story beat | A planned or possible moment in the story | Arc name; order; summary; trigger or conditions; NPCs, places and items involved (links); possible outcomes; status (planned, active, done, skipped) |
| Item | Objects of interest, from loot to MacGuffins | Kind; appearance (for visuals); what it does in play; value; current holder or location (link); history |
| Session notes | One per play session | Session number and date; GM recap; key events; NPCs met (links); open threads; prep for next time |

### Character sheet (PCs)

One per PC, linked to the player who owns it. Field names follow your homebrew. Rule values such as the trait list, Hope max and Fear cap come from a ruleset config, not hard-coded, so sheets can be customized later.

| Group | Fields |
| --- | --- |
| Identity | Character name, player (user link), level, class or role name, public description, visual asset |
| Traits | Six traits: Agility, Strength, Finesse, Instinct, Presence, Knowledge, each a modifier from −1 to +2 |
| Defense | Evasion; armor score; armor slots (max and marked) |
| Health | Damage thresholds (minor, major, severe); HP max and current; Stress max and current |
| Hope | Current Hope, 0 to 6 |
| Experiences | List of name + bonus |
| Proficiency | Number |
| Weapons | Primary and secondary: name, trait, range, damage dice and type, feature text. Plus inventory weapons. |
| Armor | Name, base thresholds, base score, feature text |
| Inventory | List of items (free text or Item record links); gold (handfuls, bags, chest) |
| Class feature | Name and description |
| Combat options | List the player can pick from in battle: name, kind (action, reaction, passive), cost (e.g. Hope, Stress), description |

### Stat block (monsters and NPCs)

Standalone records. Monsters are stat blocks with a visual; an NPC can link one when it may fight.

| Group | Fields |
| --- | --- |
| Identity | Name, tier (number), role (e.g. Bruiser), public description, visual asset |
| Core | Difficulty; attack modifier; standard attack (name, range, damage dice, damage type) |
| Experiences | List of name + bonus |
| Motives and tactics | Short text list |
| Features | List of: name, kind (passive, action, reaction), cost (e.g. mark a Stress, spend Fear), description |
| Health | Damage thresholds (major, severe); HP max and current; Stress max and current |

In a battle, each copy of a monster on stage tracks its own HP and Stress. The stat block holds the template values.

### Supporting tables

| Table | Holds |
| --- | --- |
| users | Account, Discord ID, display name, avatar |
| campaigns | Name, GM user, ruleset config version, archived flag |
| campaign\_members | User, campaign, role (gm, player), assigned PC |
| invites | Code, campaign, expiry, revoked flag |
| record\_links | From record, to record, relationship label (e.g. "leader of"); backlinks come from the same rows |
| player\_notes | Record, author, body, timestamps |
| assets | Campaign, kind (character, monster, prop, backdrop), file paths (original, processed), status (pending, approved, rejected), prompt used, model, style bible version, GM revision notes, cost |
| scenes | Campaign, name, type (static, transition, battle), backdrop asset, linked Spot, saved layout |
| scene\_objects | Scene, kind (token, prop, prompt), linked record or PC, position, rotation, scale, layer, visible flag |
| sessions | Campaign, number, started\_at, ended\_at, active scene, current Fear |
| session\_events | Append-only log: rolls, Hope and Fear changes, reveals, scene changes, with actor and time |
| ai\_imports | GM input text, mode, prompt version, model, token usage, status |
| ai\_proposals | Import, proposed action (create, update, link), payload, review state (pending, accepted, edited, rejected) |
| provider\_credentials | User, provider (anthropic, openrouter), encrypted key, last four characters, created\_at |

## 9. Rules engine

Every action roll is 2d12 (one Hope die, one Fear die) plus a trait modifier, compared against a difficulty the GM sets. Whichever die is higher hands out Hope or Fear, whether the roll succeeds or not. All rolling happens on the server, never in the browser.

### Ruleset values (config, not code)

| Setting | Value |
| --- | --- |
| Dice | 2d12: Hope die + Fear die |
| Trait modifier range | −1 to +2 |
| Hope max per PC | 6 |
| Hope spend bonus | +3 to a roll |
| Teamwork cost | 3 Hope |
| GM Fear at session start | 3 |
| GM Fear cap | 12 |

### Resolving an action roll

```latex
\text{total} = d_{\text{hope}} + d_{\text{fear}} + \text{trait modifier} + (3 \text{ if Hope spent})
```

1. **GM calls the roll.** Picks the player, the trait, enters the difficulty, and marks the difficulty public or hidden. An optional label says what it's for ("Climb the wall").
2. **Player sees the prompt.** Trait, modifier and difficulty (if public). They can spend Hope for +3 before rolling.
3. **Server rolls** both d12s with a cryptographically secure random generator.
4. **Critical check.** If both dice match, it is a **critical success**: automatic success, and the player gains 1 Hope.
5. **Success check** (non-critical). Success if the total meets or beats the difficulty (open question 19.2).
6. **Hope or Fear** (non-critical). Hope die higher: player gains 1 Hope (capped at 6). Fear die higher: GM gains 1 Fear (capped at 12). This happens on success or failure.
7. **Broadcast.** Everyone sees the dice, the total, and who gained Hope or Fear. With a hidden difficulty, players see the dice and total but not the difficulty or the success result; the GM sees everything and narrates (open question 19.3).
8. **Log.** The roll is appended to the session's event log.

### Teamwork

For 3 Hope, two players work together: both roll, and the result they choose is the one that counts. That roll's dice decide Hope or Fear. Who pays and whether the other roll also gives Hope or Fear are open question 19.4.

### Fear

- The GM starts every session with 3 Fear. The current count is always visible to all players.
- The GM gains Fear from action rolls (above) and from stat block features that grant it.
- When the GM spends Fear, every player sees an on-stage animation and the counter drop. The GM can add an optional reason.
- The GM can manually adjust Fear and any Hope value, as a correction. Adjustments are logged.

### Implementation rules

- The engine is one pure-function module in the shared package: inputs (dice, modifier, difficulty, current Hope/Fear, config), outputs (result, new Hope/Fear, events). No I/O inside it.
- 100% unit-test coverage on this module, including caps, doubles on 1s and 12s, and Hope spending at 0 Hope (refused).
- The client may preview a roll's odds, but only the server's result is real.

## 10. AI note import

The GM types a free-form brain-dump; Claude Sonnet 5.5 returns proposed records, edits and links in a strict schema; the GM reviews every proposal before anything is saved. The GM's own Anthropic key pays for it.

### Modes

| Mode | When | Context sent with the request |
| --- | --- | --- |
| Bootstrap | Campaign is empty | None. Asks for story overview, major factions and NPCs, areas and spots, lore, opening story beats. |
| Add to campaign | Adding a new NPC, place, arc, etc. | A context pack of existing records (below) so new records fit and link to what exists |
| Fill in a record | A record has empty fields | That record, its links, and the campaign overview |

### Pipeline

1. **Input.** GM writes freely in a large editor and picks a mode. Optional: target types ("only NPCs").
2. **Context pack** (add/fill modes). Server picks relevant records: names mentioned in the text, records linked to those, plus every faction and area by name and one-line summary. Each record goes in as id + name + type + short summary, inside a size budget. Private fields are included: this is the GM's own data going to the GM's own key.
3. **Request.** Versioned system prompt + the context pack + the GM's text, with output forced to the proposal schema (structured output).
4. **Validate.** The server checks the output against the Zod schemas. Links must point to existing ids or to records proposed in the same batch. On failure, it retries once with the validation errors attached. A second failure shows the GM the raw error.
5. **Review screen.** Each proposal is a card: create, update (shown as a field-by-field diff) or link. The GM can accept, edit then accept, or reject each one, or accept all. Possible duplicates (similar names to existing records) are flagged.
6. **Commit.** Accepted proposals are saved in one transaction, tagged `source = ai_import` with the import id. The import and token usage are logged.

### Proposal schema (shape)

- `creates[]`: temporary id, type, name, public description, fields, links to existing or temporary ids
- `updates[]`: existing record id, fields to change (never deletes; empty values don't overwrite)
- `links[]`: from id, to id, relationship label
- `questions[]`: things the model couldn't decide and wants the GM to answer (shown above the cards)

The AI never deletes records and never touches character sheets, stat block numbers, or anything revealed to players without showing it as a diff first.

### Keeping the model swappable

- **One model for now:** `claude-sonnet-5-5`, pinned. Calls go through the Vercel AI SDK so adding providers later is a config entry.
- **Prompts as files:** `packages/prompts/<task>/v<N>.md` with its schema. Every import records which prompt version and model produced it.
- **Eval suite:** 15–20 fixture brain-dumps (empty campaign, add NPC, add area with spots, messy notes, contradictory notes) with checks: schema-valid, expected types and counts, names present, no links to missing ids, no invented mechanics. Run with `pnpm eval` before changing a prompt or model. It costs real tokens, so it's run by hand, not in CI.
- **Model retirement plan:** when Anthropic announces a deprecation, run the eval suite on the replacement, adjust prompts until it passes, bump the prompt version.

### Cost guardrails

- Show an estimated cost before sending large imports.
- Hard cap on input size per import (set in config).
- Per-GM usage page: tokens and estimated cost per import.

## 11. Visual assets and art style

Each visual is one image, generated on request from a record, pushed through a fixed style bible and post-processing, then approved by the GM. Consistency comes from three layers: a locked prompt template, reference images sent with every request, and code that normalizes every output.

### Art direction

- **Look:** Paper Mario cardboard cutouts × Dexter's Lab. Flat colors, bold dark outlines, simple shapes, a limited bright palette, light 90s cartoon exaggeration.
- **Characters and monsters:** full body, standing, facing the viewer, neutral pose, centered, no background. One image per character for now. Emotion comes from how the cutout moves (section 12).
- **Props and items:** a single object, centered, no background.
- **Backdrops:** wide 16:9 painted flat, like theater scenery, no characters in it, low detail at the edges.
- **Never:** photorealism, heavy gradients, text in the image, multiple characters in one image.

### Style bible (versioned files)

Stored in `packages/style-bible/v<N>/`:

- `base.md` — the base style prompt applied to every request
- `templates/` — one prompt template per asset kind (character, monster, prop, backdrop), with slots filled from the record (name, appearance, kind)
- `anchors/` — 4–6 approved reference images that define the look, sent with every request
- `palette.json` — the fixed color palette used in post-processing

Every asset records the style bible version that made it. Changing the style bible bumps the version; old assets are kept, and can be regenerated in bulk if wanted.

### Generation flow

1. GM clicks **Generate visual** on a record (or in bulk on several records). One click; the prompt is built automatically from the template + the record's appearance and public description.
2. A job is queued (pg-boss). The record shows "generating".
3. The worker calls OpenRouter (`openai/gpt-image-2`) with the prompt and anchor images, requesting a transparent background for cutouts.
4. **Post-processing (sharp):** remove any leftover background, trim, add the uniform cardboard border and slight edge shadow, map colors to the palette, resize to standard sizes (cutouts: longest side 1024 px; backdrops: 2048 × 1152), save as WebP plus the untouched original.
5. Asset appears as **pending** with the prompt used.
6. GM reviews: **Approve** (becomes the record's visual), **Regenerate with notes** (notes are added to the prompt, e.g. "bigger hat, angrier eyebrows"), or **Reject**.
7. **Upload instead:** the GM can upload their own image at any point. It goes through the same post-processing so it matches.

### Model choice and swapping

- Image model is one config value (an OpenRouter model slug). Starting model: `openai/gpt-image-2`.
- Before switching models, generate the fixed test set (the same 10 records) with the new model and compare it side by side with the current set.
- Style-model training (e.g. a custom model trained on approved assets) is deferred, but approved assets are kept with their prompts so a training set exists if needed.

### Cost guardrails

- Default to a medium quality setting; high quality only for backdrops if needed.
- Show the estimated cost per generation; log actual cost per asset.
- Rate limit: a set number of image jobs per GM per hour (config).

## 12. The stage

The stage is one fixed, low-poly 3D theater rendered in the browser with React Three Fiber. Everything placed on it is a flat cardboard cutout: characters, monsters, props, clickable prompts, and a painted backdrop hung at the back. Scenes are saved arrangements of these pieces.

### Stage layers (back to front)

| Layer | What it is | Behavior |
| --- | --- | --- |
| Proscenium and curtains | Fixed theater frame, built once | Curtains close and open on scene changes |
| Backdrop | The Spot's backdrop image on a hanging canvas | Swappable; scrolls in a loop in transition scenes |
| Ground | Stage floor, optionally tinted per scene | Fixed geometry |
| Cutouts | PCs, NPCs, monsters, props as textured planes with a thin cardboard edge | Positioned by the GM; animated procedurally |
| Prompts | Signs or cutouts on stands or hanging from ropes, tied to a record or a Spot's point of interest | Clickable; open the public popup |

### Camera and player freedom

- Default view: front-of-house, the whole stage in frame.
- Players can look around within limits (a clamped orbit and zoom) and snap to focus on any prompt. They cannot leave the stage.
- Players can trigger emotes on their own token and click any prompt. Moving tokens is GM-only for the MVP (open question 19.6).

### Cutout animation (no sprite sheets)

All motion is procedural transforms on the cutout, so any new character animates the moment it is approved:

- **Idle:** slight sway
- **Talking:** bounce while the speaker's voice is detected (section 13)
- **Emotes** (player menu): hop, spin, shake (angry), shrink (scared), lean in (curious), tip over (faint), wave
- **Walking:** side-to-side wobble, used in transition scenes
- **Enter and exit:** slide in from the wings or drop in on a rope

### Scene builder (GM)

1. Start from an empty stage, or from a Spot (pre-fills its backdrop and the NPCs and items linked to it).
2. Drag records with approved visuals from a side tray onto the stage. PCs come from the campaign roster.
3. Move, scale, flip and layer cutouts; mark any object hidden (placed but not shown yet).
4. Add prompts and attach each to a record or point of interest.
5. Save as a named scene. Scenes can be built ahead of time or on the fly during a session.

### Live editing and NPC takeover

- During a session, the GM edits the live scene with the same tools; changes appear to everyone immediately.
- Showing a hidden object, or loading a scene, reveals its records to players automatically (section 7).
- **Take over an NPC:** the GM selects an NPC cutout; while active, the GM's voice animates that NPC instead of the GM's own presence, and the NPC's name shows as the speaker. Switch NPCs with one click; release to return to normal.

### Scene types

| Type | Phase | What's special |
| --- | --- | --- |
| Static location | 3 (MVP) | Investigation and NPC conversation; prompts are the focus |
| Transition | 4 | Backdrop scrolls in a loop, tokens wobble as if walking; for talking while traveling |
| Battle | 4 | Players open their combat options from their sheet; monsters show HP/Stress to the GM; Fear spending is prominent |

### Performance budget

- Target: 60 fps on a mid-range laptop with integrated graphics, in Chrome, Firefox, Edge and the Discord client.
- At most 30 objects on stage; cutout textures 1024 px, backdrop 2048 × 1152, compressed.
- No real-time shadows; baked lighting on the stage model; one directional light.
- Measured with a test scene in Phase 3 before the first playtest.

## 13. Live sessions and speaking detection

A live session is a Socket.IO room per campaign, with the server holding the authoritative state: current scene, Fear, Hope, who's connected and who's speaking. Voice stays in Discord; Stagehand only learns *who* is talking, never what they say.

### Session lifecycle

1. GM clicks **Start session**. Fear resets to 3; a session row and session number are created.
2. Players open the campaign (browser or Discord Activity) and join. The room admits the GM plus at most 6 players; a 7th player sees "session full".
3. Each client receives a full state snapshot on join and on every reconnect, then live events.
4. GM clicks **End session**. The event log is closed and attached to that session's notes record.

### Real-time events

| Event | Sent by | Effect |
| --- | --- | --- |
| scene:load | GM | Curtains close, new scene loads for all, its shown records are revealed |
| scene:object.add / move / remove / show / hide | GM | Live scene edit |
| record:reveal / unreveal | GM | Journal updated for all players |
| note:add / edit / delete | Anyone | Player notes on a revealed record |
| emote | Player, or GM via NPC | Plays the emote on that token for everyone |
| npc:takeover / release | GM | Speaking animation goes to the chosen NPC |
| speaking:start / stop | Client | Talking bounce on that person's token |
| roll:call | GM | Prompt appears for the chosen player |
| roll:result | Server | Dice, total, Hope/Fear change broadcast |
| fear:spend / adjust, hope:adjust | GM | Counters update with animation |
| sheet:update | Server | A player's sheet changed (Hope, HP, Stress) |

Every event is validated on the server (who sent it, and are they allowed). Clients never trust each other.

### Speaking detection

One `SpeakingSource` interface emits start/stop for a user. Two implementations:

| Source | Used when | How | Notes |
| --- | --- | --- | --- |
| Discord Activity | Stagehand is launched as an Activity inside the group's Discord voice channel | Discord Embedded App SDK `SPEAKING_START` / `SPEAKING_STOP` events (needs the `rpc.voice.read` scope) | Officially supported. Discord user id is mapped to the Stagehand account through Discord login. |
| Browser mic | Stagehand is in a normal browser tab, with voice in any app | Web Audio API reads the mic level locally; a threshold with a short hold-off decides talking or not; only a true/false is sent | No audio leaves the device. Needs mic permission. Speaker sound can cause false triggers without headphones; each player gets a sensitivity slider and a mute toggle. |

**Rejected:** a Discord bot listening in the voice channel. Discord does not officially support bots receiving voice, and its now-mandatory voice encryption (DAVE, required since March 2026) has already broken bots of this kind.

### Running as a Discord Activity

- Register a Discord application; set up the Activity's URL mapping to the Stagehand domain.
- Inside Discord, all network traffic goes through Discord's proxy, including Socket.IO. The client detects Activity mode and uses proxied paths.
- The player and GM play views must work both inside the Activity frame and in a normal tab. Heavy GM prep tools (workshop, AI import) stay in the normal browser.
- This is the riskiest external piece: prototype it in the first week of Phase 3.

## 14. Security and privacy

The three things that must never leak are GMs' API keys, private campaign fields, and one campaign's data into another. Each has a specific control and a test.

| Asset | Control | Verified by |
| --- | --- | --- |
| GM API keys (Anthropic, OpenRouter) | Encrypted at rest with AES-256-GCM; master key only in a server environment variable, never in the repo or database. Decrypted only in memory for the outgoing call. Never sent to any browser; the UI shows the last 4 characters. Deletable at any time. | Unit test that responses never include key fields; log redaction test |
| Private record fields | Player-facing responses built from an allow-list of public fields (section 7) | Integration tests per record type as a player account |
| Campaign isolation | Single scoped data-access layer; every route checks membership | Cross-campaign access tests on every route |
| Accounts | Discord OAuth only; HTTP-only, secure, same-site session cookies; CSRF protection on state-changing routes | Auth integration tests |
| Live events | Server checks sender's role for every socket event | Socket tests with a player trying GM events |
| Uploads | Images only, size limit (e.g. 10 MB), decoded and re-encoded through sharp, stored with generated names | Upload tests with bad files |
| Home network | Cloudflare Tunnel: no open router ports, home IP not exposed, HTTPS end to end | Port scan of the home IP shows nothing open |
| Abuse and cost | Rate limits on login, AI and image routes; per-GM usage caps in config | Rate-limit tests |
| Data loss | Nightly database dump + asset folder copy to a second location; monthly restore test | Restore drill log |

### Privacy notes

- GM brain-dumps and record text are sent to Anthropic, and image prompts to OpenRouter, under each GM's own account and those providers' terms. The setup screen says so plainly.
- Voice never passes through Stagehand. Browser-mic detection runs entirely on the player's device.
- Players can delete their account; their notes become "Former player".

## 15. Infrastructure, code layout and conventions

Stagehand runs as three Docker containers on the home PC (app, PostgreSQL, cloudflared), reachable at a custom domain through Cloudflare Tunnel. Moving to a VPS later means copying the Compose file, the env file and the data volumes.

### Environments

| Environment | Where | Data |
| --- | --- | --- |
| Development | Your machine, `pnpm dev` + Postgres in Docker | Seed data and throwaway campaigns |
| Production | Home PC, Docker Compose, Cloudflare Tunnel | Real campaigns; nightly backups |
| Later: hosted | A small VPS (if other groups join) + S3-compatible storage | Migrated from production |

### Repository layout

```
stagehand/
  apps/
    web/            React + Vite client (workshop, stage, Activity mode)
    server/         Fastify API, Socket.IO, job workers
  packages/
    shared/         Zod schemas, types, rules engine, ruleset config
    prompts/        Versioned AI prompts + eval fixtures
    style-bible/    Versioned image style prompts, anchors, palette
  infra/
    docker-compose.yml, cloudflared config, backup scripts
  docs/
    decisions/      One file per Decision log entry (optional detail)
```

### Testing

| Level | Tool | Covers | When |
| --- | --- | --- | --- |
| Unit | Vitest | Rules engine (100%), schemas, prompt builders, post-processing | Every commit (CI) |
| Integration | Vitest + test Postgres | API routes, permissions, campaign isolation, public-field filtering | Every commit (CI) |
| End-to-end | Playwright | Sign in, create campaign, AI import review (mocked AI), build a scene, run a roll | Before each release |
| AI evals | Custom script | Prompt and model quality (section 10) | By hand, before prompt or model changes |
| Playtests | Your group | Everything, for real | End of Phase 3 and Phase 4 |

### Conventions

- TypeScript strict; ESLint + Prettier; no `any` without a comment.
- Conventional commit messages referencing feature IDs (e.g. `feat(F1.8): proposal review screen`).
- Trunk-based: short branches, merged when CI is green. Tag releases `v0.<phase>.<n>`.
- Database changes only through Drizzle migrations, committed with the code that needs them.
- Every new external service goes behind an interface in `server/src/providers/`.
- Every change to a decision in this document gets a Decision log row in the same commit.

## 16. Budget

Your first-year cost is estimated at about $75–200, inside the few-hundred-dollar limit. Most infrastructure is free; the real spend is your own AI and image usage while building and testing. Figures are approximate (USD) and should be checked against provider pricing pages before you rely on them.

| Item | Estimate, year 1 | Basis |
| --- | --- | --- |
| Domain name | $10–15 | Standard domain renewal |
| Cloudflare Tunnel, GitHub, GitHub Actions, Discord app | $0 | Free tiers |
| Claude usage (dev, testing, eval runs) | $20–50 | Sonnet 5.5 at $2 / $10 per million input / output tokens; an import is roughly 10–15 cents |
| Image generation (dev and style tuning, \~500 images) | $25–75 | gpt-image-2 via OpenRouter, roughly 5–15 cents per image at medium quality with reference images |
| Off-site backup storage | $0–10 | Small object-storage bucket |
| Optional VPS for the last months | $0–50 | Only if other groups join before month 12 |
| **Total** | **\~$75–200** |  |

What a GM pays (on their own keys): a few cents per AI import, and a few dollars for a full campaign's worth of art (about 100 assets). Stagehand shows these estimates on the settings and usage screens.

Budget rule: if spend passes $150 before Phase 3 ends, review the image quality setting and eval frequency first.

## 17. Risks and mitigations

The biggest risks are scope creep and art consistency; both are handled by phase gates and the style pipeline. Each risk has an early warning sign so it's caught before it costs a month.

| Risk | Likelihood | Impact | Mitigation | Early warning |
| --- | --- | --- | --- | --- |
| Scope creep pushes the playtest past month 8 | High | High | Phase exit criteria; new ideas go to Deferred unless they replace something | Phase 1 not done by end of month 3 |
| Generated art isn't consistent enough | Medium | High | Style bible, anchor images, post-processing, side-by-side test set; manual upload fallback | Fewer than half of first 20 assets approved without regenerating |
| Discord Activity constraints (proxy, frame limits) | Medium | Medium | Prototype in week 1 of Phase 3; browser-mic mode works without Discord | Socket.IO or WebGL fails inside the Activity frame |
| Browser-mic false triggers from speakers | Medium | Low | Sensitivity slider, mute toggle, recommend headphones; Activity mode avoids it | Playtest feedback |
| 3D stage too slow on players' machines | Low | High | Performance budget (section 12), measured before the playtest | Test scene under 45 fps on a mid-range laptop |
| AI import quality is uneven | Medium | Medium | Strict schemas, retries, review screen, eval suite | GM edits more than half of proposals |
| Claude Sonnet 5.5 or gpt-image-2 retired | Medium | Medium | Pinned versions, provider interfaces, eval suite and image test set | Provider deprecation notice |
| OpenRouter drops gpt-image-2 or changes pricing | Low | Medium | Image model is one config value; test set re-run on a new model | Pricing or model-list change |
| Home PC offline during someone's session | Medium | Medium | Acceptable for one group; move to a VPS before onboarding other groups (F4.5) | Any missed session |
| Data loss | Low | High | Nightly backups, off-site copy, monthly restore test | A failed restore drill |
| Private field leaks to players | Low | High | Allow-list responses; per-type tests | Any failing visibility test |
| Licensing: using Daggerheart's official text or layouts | Low | Medium | Homebrew field names and own layouts; the 2d12 mechanic itself isn't copied text | Any copied wording in the UI |

## 18. Decision log

The 16 baseline decisions were made on 2026-11-07. New decisions go at the top with the next number; changed decisions get a new row and the old one is marked superseded.

| ID | Date | Decision | Why | Rejected options |
| --- | --- | --- | --- | --- |
| D-16 | 2026-11-07 | Fear: GM starts each session with 3, cap 12; Hope cap 6; criticals give the player 1 Hope | Homebrew rules as stated by the designer | — |
| D-15 | 2026-11-07 | Locations have exactly two levels: Area and Spot | Enough for play; deeper nesting adds complexity | Arbitrary nesting |
| D-14 | 2026-11-07 | One GM per campaign | Simpler permissions | Co-GM roles |
| D-13 | 2026-11-07 | Homebrew ruleset with values in config; no official Daggerheart text or layouts | Licensing safety; future customization | Copying the official sheet |
| D-12 | 2026-11-07 | Speaking detection via Discord Activity events + browser-mic fallback | Officially supported events; works without Discord too | Discord voice bot (unsupported voice receive, broken by DAVE encryption) |
| D-11 | 2026-11-07 | Image generation through OpenRouter, starting with `openai/gpt-image-2` | One key for many image models; no OpenAI ID verification | OpenAI direct (ID required), Replicate (some OpenAI models need your own OpenAI key), Google Nano Banana (quality judged lacking), FLUX Kontext alone (single model) |
| D-10 | 2026-11-07 | Text AI: Claude Sonnet 5.5, GM's own Anthropic key; one model for the MVP behind a swappable layer | Strong structured output; swappable via SDK, schemas, eval suite | Self-hosted open models per GM (needs a strong GPU), OpenAI, Gemini |
| D-09 | 2026-11-07 | Two keys per GM (Anthropic + OpenRouter); each GM pays own usage | Keeps project costs near zero | Project-paid AI |
| D-08 | 2026-11-07 | 2.5D paper theater: 3D stage, flat cutouts, procedural animation, one image per character | Cheapest, most reliable path that keeps the stage feel; fits the art direction | Rigged 3D characters, pure 2D, sprite sheets |
| D-07 | 2026-11-07 | Art direction: Paper Mario cutouts × Dexter's Lab colors and outlines | Designer's choice | — |
| D-06 | 2026-11-07 | Hosting: Docker Compose on the home PC behind Cloudflare Tunnel | Free, no open ports, portable | Port forwarding, paid cloud now |
| D-05 | 2026-11-07 | Auth: Sign in with Discord (Better Auth) | Needed for Discord identity anyway | Email/password only |
| D-04 | 2026-11-07 | PostgreSQL + Drizzle; narrative records in one table with typed JSON fields | Linked data, isolation, flexible fields | SQLite, MongoDB, Prisma |
| D-03 | 2026-11-07 | Backend: Node + Fastify + Socket.IO | Long-running process suits live rooms | Next.js API routes, Colyseus |
| D-02 | 2026-11-07 | Frontend: React + Vite, React Three Fiber for the stage | Ecosystem, 3D support | SvelteKit, Next.js, Babylon.js |
| D-01 | 2026-11-07 | TypeScript monorepo for everything | One language for a solo developer | Mixed C#/Python services |

## 19. Open questions and working assumptions

None of these block Phase 0–2. Each needs an answer before the phase shown; until then, the build uses the working assumption.

| ID | Question | Working assumption | Needed by |
| --- | --- | --- | --- |
| 19.1 | How much Hope does the +3 bonus cost? | 1 Hope for +3, once per roll | Phase 3 |
| 19.2 | Does a total equal to the difficulty succeed? | Yes: meet or beat | Phase 3 |
| 19.3 | With a hidden difficulty, what do players see? | Dice, total and Hope/Fear change; success or failure only when the GM narrates or clicks Reveal result | Phase 3 |
| 19.4 | Teamwork: who pays the 3 Hope, and does the unused roll give Hope or Fear? | The player asking for help pays; only the chosen roll gives Hope or Fear | Phase 3 |
| 19.5 | Do any rolls other than action rolls (e.g. reaction rolls) give Hope or Fear? | No, action rolls only | Phase 3 |
| 19.6 | Can players move their own token on stage? | No in the MVP; the GM places tokens. Revisit after the first playtest. | Phase 3 |
| 19.7 | What can players edit on their own sheet? | During play: spend Hope, pick combat options. Everything else edited by the GM. | Phase 1 |
| 19.8 | How is leveling up handled? | GM edits the sheet by hand; no level-up wizard in the 12-month plan | Phase 4 |
| 19.9 | Are monster HP and Stress tracked before battle scenes exist? | No; tracking arrives with battle scenes in Phase 4 | Phase 4 |

## Sources

- [Discord Embedded App SDK reference](https://docs.discord.com/developers/developer-tools/embedded-app-sdk) — speaking events for Activities
- [Discord bots and voice receive (JDA issue citing Discord's stance)](https://github.com/discord-jda/JDA/issues/904)
- [Discord voice encryption required since March 1, 2026 (Help Net Security)](https://www.helpnetsecurity.com/2026/05/19/discord-voice-and-video-call-encryption/)
- [OpenAI API organization verification](https://help.openai.com/en/articles/10910291-api-organization-verification)
- [OpenRouter: GPT Image 2](https://openrouter.ai/openai/gpt-image-2)
- [Claude Sonnet 5.5 pricing (Anthropic, via LLM Reference)](https://www.llmreference.com/provider/anthropic-api/claude-sonnet-5-5)
- [Darrington Press Community Gaming License](https://darringtonpress.com/license)
