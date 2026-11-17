# Project Stagehand — Technical Governance Document

Nov 7, 2026 · @Devon T

## 1. Purpose and how to use this document

This document is the single source of truth for what Stagehand is, which features it has, and which technologies build them. When code and this document disagree, one of them is wrong and gets fixed the same day.

- **Scope:** features, data model, rules engine, AI and image pipelines, the stage, live sessions, security, infrastructure, budget and risks.
- **Status:** approved baseline, v1.0. All decisions below were agreed on 2026-11-07 unless marked otherwise. The Phase 3 stage was redesigned on 2026-11-13 as a tabletop puppet theater (D-36, D-37).
- **Changing it:** any change to a decision adds a row to the Decision log (section 18) with the date, the change and why. Superseded decisions stay in the log, marked superseded.
- **Open items:** anything not yet decided lives in Open questions (section 19). Building on an open item is fine if the build notes the assumption it used.
- **Terminology:** *GM* = game master (campaign owner). *Player* = a person in the campaign. *PC* = player character. *Record* = any campaign entry (NPC, location, faction…). *Session* = one live play night.
- **Stage terms (section 12):** *Table* = the tabletop every player sits at. *Theater* = the puppet theater box on the far side of the table. *Scene* = a saved arrangement of the theater: a backdrop, props, and optionally NPC puppets waiting below. *Prop* = a cardboard cutout of something to see, placed in the theater; players click it to inspect it. *Puppet* = a PC, NPC or monster cutout on a stick, raised into the scene from below. *Depth tick* = one of 10 fixed distances from the front of the theater (0) to the back (9). *Inspect stage* = the small theater on the table that shows one prop close up. *Control desk* = the GM's panel for running the stage.

## 2. Project overview

Stagehand is a browser-based tool for running story-first tabletop RPGs online. It has two halves: a **campaign workshop** where the GM turns ideas into structured notes fast, and a **stage** where those notes come to life for players during play.

It sits between two existing kinds of tool. 2D map tools (Roll20, Foundry) are quick for GMs but add little immersion. 3D tools (TaleSpire) are immersive but slow to build and let players wander. Both are built around grid combat, not roleplay.

### Objectives

1. **GM speed.** A GM can brain-dump ideas and get organized, linked, consistently formatted records back through AI, with review before anything is saved.
2. **A stage for the story.** Players see where they are and who they're talking to, on a stick-puppet theater at the far end of a tabletop, with enough freedom to emote and look closer at things without wandering off.

### Design principles

- **Story over grid.** No measurement, distance or tactical movement systems. Position on stage is about framing, not rules.
- **Same shape every time.** Every record of a type has the same fields in the same order, so the GM always knows where to look mid-session.
- **Private by default.** Nothing reaches a player until the GM reveals it.
- **Human sign-off.** No AI output, text or image, is saved without GM approval.
- **Stay at the table.** A player's controls live in the world: their sheet is a page on the table, props are inspected on a small stage, and emotes open from their own puppet. Buttons floating over the view are kept to a minimum.
- **Players install nothing.** Players join from a browser or a Discord Activity. Only the GM hosts.
- **Swappable parts.** AI models, image models, storage and speaking detection each sit behind an interface so one can be replaced without a rewrite.
- **Cartoony with 90s charm.** Paper Mario cardboard cutouts with Dexter's Lab flat colors and bold dark outlines, performed as a stick-puppet show.

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
- [x] F0.4 Sign in with Discord, session handling, user profile
- [x] F0.5 Domain + tunnel live over HTTPS from the home PC
- [x] F0.6 Backups on shutdown, verified and encrypted (database dump + asset folder), see D-19

### Phase 1: Campaign workshop (months 1–3)

- [x] F1.1 Campaigns: create, rename, archive. Each GM can own many campaigns.
- [x] F1.2 Invites: GM shares an invite link, players join, GM assigns each player a PC
- [x] F1.3 Records for every narrative type: NPC, Area, Spot, Faction, Lore, Story beat, Item, Session notes (section 8)
- [x] F1.4 Character sheets for PCs, stat blocks for monsters and NPCs
- [x] F1.5 Links between records, with a backlinks panel and @-mentions inside note fields
- [x] F1.6 Search and filter across a campaign's records
- [x] F1.7 Settings: GM stores an Anthropic API key (encrypted)
- [x] F1.8 AI import: brain-dump to proposed records, with a review screen (section 10)
- [x] F1.9 Prompt files, schemas and eval suite for AI import
- [x] F1.10 Prop records: a new Prop record type replaces a Spot's points of interest (D-37). A migration turns each existing point of interest into a hidden Prop linked from its Spot; Spots gain a "props here" link field; AI import moves to prompt v5 with its eval cases updated. Ships before F2.3, so props can get visuals like any other record.

**Exit:** your current campaign is entered, mostly through AI import, and every record is approved.

### Phase 2: Visual assets (months 3–5)

- [x] F2.1 Style bible v1, anchor reference images, and asset templates for puppets (PCs, NPCs, monsters), props (Prop and Item records) and back-wall backdrops (section 11)
- [x] F2.2 Settings: GM stores an OpenRouter API key (encrypted)
- [x] F2.3 "Generate visual" button on records, Props included; background job queue
- [x] F2.4 Post-processing: transparency, cardboard border, palette, sizing. Puppet sticks and prop stands are stage geometry, never part of the image (section 11)
- [x] F2.5 Review: use or discard, regenerate with notes, keep current or replace (D-44)
- [ ] F2.6 Manual upload as a fallback, through the same post-processing. Deferred until after the Phase 3 MVP (D-45)
- [ ] F2.7 Asset library per campaign: the images in use, including those of deleted records (only these are kept, D-44). Deferred until after the Phase 3 MVP (D-45)

**Exit:** at least 20 assets across characters, props, monsters and backdrops look like one set when placed side by side.

### Phase 3: Stage MVP and first playtest (months 5–8)

- [x] F3.1 Tabletop theater: the table, the theater box (back wall, side walls, roof, front curtain, open void below), the backdrop on the back wall, the locked player camera, and a performance test scene (section 12)
- [x] F3.2 Scene builder: backdrop from a Spot, props placed left/right, up/down and on a depth tick, optional NPC puppets waiting below, save and load scenes (static location scenes)
- [x] F3.3 Live sessions: start, join (6-player cap), presence, reconnect, the stage in sync for everyone (section 13)
- [x] F3.4 GM control desk: change scenes behind the curtain, add PCs, NPCs and props live, raise, lower and move puppets, show and hide props, reveal records. Emotes moved to F3.7 (D-52)
- [ ] F3.5 Player journal and table: revealed records for players on the site, shared player notes, player entries (F3.5a); at the table, the inspect stage for props, items and NPCs with sticky notes, and the journal as a three-ring binder (F3.5b). The sheet page moved to F3.6 (D-53)
- [ ] F3.6 The sheet as a page on the table (moved from F3.5, D-53); players spend Hope from it; GM calls rolls; Hope and Fear tracking; roll log (section 9)
- [ ] F3.7 Puppet motion: idle sway, talking (rise and brighten), preset emotes (the `emote` event, the GM's emote buttons on the desk, D-52), and an on-stage emote menu on a player's own puppet. Raising and lowering already glide (F3.4)
- [ ] F3.8 GM "take over" an NPC puppet
- [ ] F3.9 Speaking detection: browser mic and Discord Activity

**Exit:** one full session played with your group on Stagehand.

### Phase 4: Richer scenes and polish (months 8–11)

- [ ] F4.1 Transition scenes: looping backdrop, puppets bobbing on their sticks as if walking
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

Players' browsers never hold a key or call an AI provider. The Job worker runs image generation in the background so the API stays responsive. AI note import also runs in the background, inside the API process rather than the Job worker: the request answers at once and the review screen polls for the result, because Cloudflare Tunnel drops a request that stays silent for 100 seconds (D-27).

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
| Routing | React Router (declarative mode) | Most widely used React router; plain library mode keeps the SPA simple (D-17) | TanStack Router |
| 2D drag and drop | dnd-kit | Scene builder tray and lists | react-dnd |
| 3D stage | Three.js via React Three Fiber + drei | Mature WebGL in the browser, React-friendly, cutouts are simple textured planes | Babylon.js, PlayCanvas, Godot web export |
| Backend | Node.js LTS + Fastify | Fast, typed, plugin-based; long-running process suits live rooms | Express, NestJS, Next.js API routes |
| Real-time | Socket.IO | Rooms, reconnects and acknowledgements built in; plenty for 7 people per room | Colyseus, raw WebSockets |
| Validation | Zod | One schema per record type, used by forms, API, database checks and AI output | Yup, io-ts |
| Database | PostgreSQL | Heavily linked records, JSON columns for flexible fields, full-text search | SQLite, MongoDB |
| ORM and migrations | Drizzle ORM + Drizzle Kit | Close to SQL, light, typed | Prisma |
| Background jobs | pg-boss (queue stored in Postgres) | Image generation jobs without adding Redis | BullMQ + Redis |
| Auth | Better Auth, Discord OAuth | Discord login also gives the Discord ID needed for speaking detection | Auth.js |
| Text AI | Claude Sonnet 5.5 (`claude-sonnet-5-5`) via the official Anthropic SDK, behind our own provider interface (D-27) | Strong structured output; one SDK for the key check and the import; our interface keeps the provider swappable | Vercel AI SDK, OpenAI, Gemini |
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
| Add notes to revealed records and player entries | Yes | Yes |
| Edit or delete a note | Edit own notes only; delete any note | Own notes only |
| Write a player entry | No (the GM keeps records) | Yes |
| Edit or delete a player entry | Delete any entry | Own entries only |
| View own PC sheet | Yes (all sheets) | Own sheet only |
| Edit own PC sheet | Yes | Not in Phase 1: view only (D-23). Hope spending arrives with live play (F3.6), combat option picks with battle scenes (F4.2); all other edits by the GM |
| Start a session, load scenes, call rolls, spend Fear | Yes | No |
| Emote a puppet, inspect props, roll when called | Yes (any puppet) | Yes (own puppet only for emotes) |
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

As built (F3.5a, D-53):

- A note is plain text, line breaks kept, 1 to 500 characters, so it fits a sticky note at the table. Notes are listed newest first, each with its author's name and time, and "edited" once changed.
- While a record is un-revealed, its notes are kept but nobody can read or change them; they come back with the record.
- Deleting a record or an entry deletes its notes. A deleted account's notes show "Former player".

### Player entries

A player can write their own simple record: a title (1 to 120 characters) and a plain text description (up to 4,000). Every member of the campaign sees every entry, with its author and time, and anyone can add notes to it as they do to a revealed record. Only the author edits an entry; the author or the GM deletes it. The GM keeps records instead, so the GM can't write an entry (D-53).

### The journal on the site

A player's Records page is the journal: the GM's layout without tags. The search covers names and public descriptions only. Its type chips list only the types with something revealed, with **Player entries** in front, and a player can add an entry from there. A record's page shows its name, type, image and public description, and the notes under them. An @-mention in the public description links to that record's page when players have it, and is plain text otherwise: the server sends a player the id of no record they haven't been shown (§7 rule 4). A Spot's Area is named only when that Area is revealed too. The GM's Records page has the same Player entries chip, and a revealed record's page shows its notes under the form.

## 8. Data model

Narrative records share one `records` table with common columns, plus a `fields` JSON column whose shape is fixed per type by a Zod schema. Things with heavy mechanics or live state (character sheets, stat blocks, scenes, sessions) get their own tables.

Why this split: one table makes links, search, reveal, player notes and visuals work identically for every record type, and adding a type means adding a schema, not a migration. Mechanical data changes every turn in play and needs real columns and constraints.

### Common record columns

| Column | Type | Notes |
| --- | --- | --- |
| id | UUID | Primary key |
| campaign\_id | UUID | Required; isolation key |
| type | enum | npc, area, spot, prop, faction, lore, story\_beat, item, session\_notes. A Postgres enum: a new type needs a migration that rebuilds it (D-41) |
| name | text | Public |
| public\_description | rich text | Public; what players see when revealed |
| fields | JSON | Private, type-specific; validated by the type's Zod schema |
| gm\_notes | rich text | Private, free-form catch-all |
| parent\_id | UUID, nullable | Only for spot → area (two-level locations) |
| visual\_asset\_id | UUID, nullable | The visual in use ("Use this" or "Replace", F2.3, F2.5); NPCs, Props, Items and Spots only (D-42, D-44) |
| stat\_block\_id | UUID, nullable | NPCs only, optional |
| revealed\_at | timestamp, nullable | Null = hidden from players |
| tags | text\[\] | Free tags for filtering |
| search\_vector | tsvector, generated | Search index over name, tags, public description and GM notes, kept by Postgres; never sent to a browser (D-25) |
| public\_search\_vector | tsvector, generated | The players' search: name and public description only, never tags or GM notes; never sent to a browser (F3.5, D-53) |
| source | enum | manual, ai\_import |
| ai\_import\_id | UUID, nullable | The import that created the record, when source is ai\_import (D-27) |
| created\_at, updated\_at | timestamps |  |

### Record types and their fields

Fields appear in this order on every record of the type, so the GM always knows where to look. All are optional except name.

| Type | Purpose | Private fields, in display order |
| --- | --- | --- |
| NPC | Anyone the party might talk to | Appearance (for visuals); personality; voice and mannerisms; wants and motivations; what they know; secrets; role in the story; status (alive, dead, missing, unknown); home spot (link); factions (links) |
| Area | A general place: city, town, beach, forest | Kind of place; overview; atmosphere (sights, sounds, smells); notable features; factions present (links); hooks; secrets |
| Spot | Where the party actually stands: the market, the crashed boat, an NPC's house. Always belongs to one Area | Description for the GM to read out; props here (shown from each Prop's Spot link, never stored on the Spot, D-41); NPCs usually here (links); items here (links); hidden details; backdrop notes (for visuals) |
| Prop | Something to see at a Spot that stays where it is: the well, the statue, the notice board. Shown on stage as a cardboard cutout that players click to inspect; its public description is the text the inspect stage shows (F1.10, D-37) | Appearance (for visuals); hidden details (what a closer look or a roll could turn up); Spot (link, one: the only stored side of the Spot's "props here", D-41) |
| Faction | Any organized group | Goals; leaders (NPC links); members (NPC links); resources; allies and enemies (faction links); public reputation; secrets |
| Lore | History, legends, religion, magic, anything world-level | Category; summary; full details; who knows it (links); what's true vs. what people believe |
| Story beat | A planned or possible moment in the story | Arc name; order; summary; trigger or conditions; NPCs, places, props and items involved (links); possible outcomes; status (planned, active, done, skipped) |
| Item | Objects of interest, from loot to MacGuffins; anything the party can pick up or carry. Can be placed on stage as a prop too | Kind; appearance (for visuals); what it does in play; value; current holder or location (link: an NPC, Spot, Prop or Area); history |
| Session notes | One per play session | Session number and date; GM recap; key events; NPCs met (links); open threads; prep for next time |

### Character sheet (PCs)

One per PC, linked to the player who owns it. Field names follow your homebrew. Rule values such as the trait list, Hope max and Fear cap come from a ruleset config, not hard-coded, so sheets can be customized later. Numbers that change in play are columns; lists and sections are validated JSON (D-23).

| Group | Fields |
| --- | --- |
| Identity | Character name, player (user link), level, class or role name, public description, GM notes (private), visual asset (F2.3, D-42) |
| Traits | Six traits: Agility, Strength, Finesse, Instinct, Presence, Knowledge, each a modifier from −1 to +2 |
| Defense | Evasion; armor score; armor slots (max and marked) |
| Health | Damage thresholds (minor, major, severe); HP max and current; Stress max and current |
| Hope | Current Hope, 0 to 6 |
| Experiences | List of name + bonus |
| Proficiency | Number |
| Weapons | Primary and secondary: name, trait, range, damage dice and type, feature text. Plus inventory weapons. |
| Armor | Name, base thresholds, base score, feature text |
| Inventory | List of items: name, detail, optional link to an Item record (D-24); gold (handfuls, bags, chest) |
| Class feature | Name and description |
| Combat options | List the player can pick from in battle: name, kind (action, reaction, passive), cost (e.g. Hope, Stress), description |

### Stat block (monsters and NPCs)

Standalone records. Monsters are stat blocks with a visual; an NPC can link one when it may fight.

| Group | Fields |
| --- | --- |
| Identity | Name, tier (number), role (e.g. Bruiser), public description, visual asset (not yet: stat blocks have no Generate visual, D-42) |
| Core | Difficulty; attack modifier; standard attack (name, range, damage dice, damage type) |
| Experiences | List of name + bonus |
| Motives and tactics | Short text list |
| Features | List of: name, kind (passive, action, reaction), cost (e.g. mark a Stress, spend Fear), description |
| Health | Damage thresholds (major, severe); HP max; Stress max |

A stat block is a template: it holds HP and Stress maximums only. In a battle, each copy of a monster on stage tracks its own current HP and Stress (F4.2, open question 19.9). Deleting a stat block unlinks the NPCs that used it (D-23).

### Supporting tables

| Table | Holds |
| --- | --- |
| users | Account, Discord ID, Discord username, display name, avatar, email (placeholder for phone-only Discord accounts, D-18) |
| campaigns | Name, GM user, ruleset config version, archived flag |
| campaign\_members | User, campaign, role (gm, player), assigned PC |
| invites | Code, campaign, expiry, revoked flag |
| record\_links | From record, to record, kind (field, other, mention), field key for the §8 link fields, relationship label for other links (e.g. "rival of"); backlinks come from the same rows (D-24) |
| player\_notes | Campaign, the revealed record or the player entry it is on (exactly one), author (cleared if the account is deleted), body (plain text, 1 to 500 characters), timestamps (F3.5, D-53) |
| player\_entries | Campaign, author (cleared if the account is deleted), title (1 to 120 characters), description (plain text, up to 4,000), timestamps (F3.5, D-53) |
| assets | Campaign, the record or PC it was made for (kept when that is deleted), the GM who asked, kind (character, monster, prop, backdrop), status (generating, failed, pending, approved, rejected) and error code, prompt used, model, style bible version, quality and aspect ratio, file paths (original, processed), media type, the processed image's width and height and the post-processing version that made it (D-43), for a Regenerate with notes the asset it changes and the GM's notes, cost, created, started and finished times (D-42). A record or PC keeps its image in use and its drafts under review; a discarded try stays as `rejected` with its files deleted (D-44) |
| scenes | Campaign, name, type (static, transition, battle; only static is made until Phase 4), linked Spot. The backdrop is not stored: it is the Spot's image in use when the scene is read. A scene with no Spot, or whose Spot was deleted, has a bare back wall (D-49) |
| scene\_objects | Scene, campaign, kind (prop, puppet), linked record (a Prop or Item for a prop; an NPC for a puppet), left/right and up/down position inside the theater opening (each 0 to 1, for the bottom center of the cutout), depth tick (0 = front to 9 = back), scale (0.25 to 2.5), flipped, shown flag (props), mount (props: stand or hang), place in the scene's list. A saved scene holds props and, optionally, NPC puppets. A puppet is always saved lowered, at the place it will rise to, so its shown flag stays false. At most 24 objects per saved scene: the 30 of the §12 budget less 6 PCs, which are added live and have no column here yet (D-36, D-49). The kind comes from the record's type. An NPC is in a scene once; a prop record can be placed several times. Deleting a record removes it from every scene |
| play\_sessions | Campaign, number (1, 2, 3… in the campaign), started\_at, ended\_at, the scene loaded last, the Spot copied from that scene (its image in use is the backdrop), how many scenes have been loaded, curtain open or closed, current Fear. One running session per campaign. Not `sessions`: Better Auth owns that table name (D-50) |
| play\_session\_objects | The live theater of a running session: a copy of the loaded scene's objects, each with the id it has in the scene, and the same columns as `scene_objects`. Here the shown flag means a prop in sight or a puppet raised, and players are sent only what is shown. The copy changes on its own during play; the saved scene is untouched. An object is a record or, added live by the GM, a PC (its puppet); an NPC or a PC is on the stage once. Deleting the record or the PC takes the object along. Deleted when the session ends (D-50, D-52) |
| session\_events | Play session, campaign, kind, actor (null for what the stage did by itself), record, details, time; append-only, kept when the session ends. So far a scene load (with the scene's name), a reveal and an un-reveal (F3.4, D-52); rolls and Hope and Fear changes arrive with F3.6 |
| ai\_imports | Campaign, GM, mode, type filter, record being filled in, GM input text, prompt version, model, status (running, questions, ready, failed, committed, discarded), phase (questions or records), the earlier rounds of questions and the GM's answers, model steps taken, error code and details, the model's questions, attempts, token usage over every step (input, output, cache read, cache write), started, finished and committed times (D-27, D-30) |
| ai\_proposals | Import, campaign, position, proposed action (create, update, link), payload as it stands after the GM's edits, payload as the model made it, review state (pending, accepted, edited, rejected) |
| provider\_credentials | User, provider (anthropic, openrouter), encrypted key, last four characters, created\_at, updated\_at; one row per user and provider (D-26) |

## 9. Rules engine

Every action roll is 2d12 (one Hope die, one Fear die) plus a trait modifier, compared against a difficulty the GM sets. Whichever die is higher hands out Hope or Fear, whether the roll succeeds or not. All rolling happens on the server, never in the browser.

### Ruleset values (config, not code)

These live in `packages/shared/src/ruleset.ts` as version 1. Each campaign picks a version with `campaigns.ruleset_version`; a published version is never edited, only superseded by a new one (D-23).

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
| Fill in a record | A record has empty fields, or the GM wants parts of it written | That record in full, its links, and the campaign overview. Its empty fields are filled; a filled field is rewritten only when the GM's notes ask for it, and shows as a diff (D-34). |

### Pipeline

1. **Input.** GM writes freely in a large editor and picks a mode. Optional: target types ("only NPCs").
2. **Context pack** (add/fill modes). The server tells the model about every record of the campaign, at one of three levels (D-27). Every record goes in by short id, type and name, so the model knows what exists and doesn't propose it again. Every faction and area, and the records linked to a named one, also get a one-line summary. The records the text names (by whole name, or by a word only that name has) and the record being filled in go in full; only these can receive field updates, while any record can be renamed, tagged or linked (D-35). In a later step the model's own questions count with the GM's answers, so the records they name go in full. All inside a size budget, most relevant first. Private fields are included: this is the GM's own data going to the GM's own key.
3. **Questions, then request** (D-30). Versioned system prompt + the context pack + the GM's text, with output forced to the proposal schema (structured output). The first call only asks: the model returns the questions whose answers would change what gets recorded, and the GM answers them in one box (the model may then ask more, round after round) or goes on to the records. A round with no questions goes straight on. The records call gets the notes and every answer. The campaign and notes come first in the message and are cached, so later rounds cost little. Each call runs in the background; the page polls until the import has questions, is ready, or has failed.
4. **Validate.** The server checks the output against the Zod schemas of the record types: field names and values, link targets, a Spot's Area, and updates only on records the model was shown in full. Links must point to existing ids or to records proposed in the same batch. On failure, it retries once with the validation errors attached. A second failure shows the GM the raw error. A refusal, or an answer cut off at the output limit, fails the import with a plain message.
5. **Review screen.** Each proposal is a card: create, update (shown as a field-by-field diff against the record as it is now) or link. The GM can accept, edit then accept, or reject each one, or accept all. Every field of a proposal can be edited; links can be removed but not added. Possible duplicates (similar names to existing records) are flagged.
6. **Commit.** Accepted proposals are saved in one transaction, new records tagged `source = ai_import` with the import id. Proposals left pending or rejected are not saved, and links to them are dropped. An update changes only the fields it names and adds tags without removing any. The import and its token usage are recorded.

### Proposal schema (shape)

- `creates[]`: temporary id (`N1`), type, name, the Area of a Spot, tags, fields as key and value pairs (rich text as Markdown, mentions as `[[id]]`). A Prop is put at its Spot by a link from the Prop with field `spot`; a link written from the Spot's side (`propsHere`) is turned around by the server (D-41)
- `updates[]`: existing record id (`E3`), fields to change, tags to add (never deletes; empty values don't overwrite)
- `links[]`: from id, to id, the link field it fills or a relationship label; ids are existing or temporary
- `questions[]`: what the model needs the GM to decide; the whole answer of a questions round (D-30), and what the records call still left open (shown above the cards)

This section describes the import as built through prompt v5 (D-41): something at a Spot worth a closer look that stays where it is becomes a Prop linked to that Spot, something the party can pick up or carry stays an Item (D-33), and never both. The index says which Spot each Prop is at, and a Spot shown in full lists its Props.

The AI never deletes records and never touches character sheets, stat block numbers, or anything revealed to players without showing it as a diff first.

### Keeping the model swappable

- **One model for now:** `claude-sonnet-5-5`, pinned. Calls go through the official Anthropic SDK behind our own provider interface, so another provider is a second implementation of that interface (D-27).
- **Prompts as files:** `packages/prompts/<task>/v<N>.md` with its schema. Every import records which prompt version and model produced it.
- **Eval suite** (D-32): 13 steps of made-up notes in different styles (empty campaign, add NPC, add area with spots, messy, contradictory, session recap, stat block, make-it-up request, a rename, type filter, chained steps), each run through the questions round and the records call, with code checks: valid answer, expected records and updates, no duplicates, no invented records, secrets kept out of players' descriptions, no invented mechanics, sensible questions. The GM's own notes can run the same way from a git-ignored folder. Run with `pnpm eval` (medium and high effort, twice each) before changing a prompt, model or effort. It costs real tokens, so it's run by hand, not in CI.
- **Model retirement plan:** when Anthropic announces a deprecation, run the eval suite on the replacement, adjust prompts until it passes, bump the prompt version.

### Cost guardrails

- An estimated cost on request before sending, from a free token count of the exact request; it is not forced on large imports (D-29).
- Hard cap on input size per import (set in config: 40,000 characters), 20 imports per GM per hour, one running at a time, and 10 model steps per import (question rounds, the records call and retries; D-30).
- Per-GM usage page: tokens and estimated cost per import.

## 11. Visual assets and art style

Each visual is one image, generated on request from a record, pushed through a fixed style bible and post-processing, then approved by the GM. Consistency comes from three layers: a locked prompt template, reference images sent with every request, and code that normalizes every output.

### Art direction

- **Look:** Paper Mario cardboard cutouts × Dexter's Lab. Flat colors, bold dark outlines, simple shapes, a limited bright palette, light 90s cartoon exaggeration.
- **Characters and monsters (puppets):** full body, standing, facing the viewer, neutral pose, centered, no background, with a clean bottom edge: the stage fixes the puppet's stick at the bottom center. One image per character for now. Emotion comes from how the puppet moves (section 12).
- **Props (Prop and Item records):** a single object, centered, no background, drawn to stand up as a cardboard standee in the theater and to read clearly on the inspect stage.
- **Backdrops:** wide 16:9 painted flat, like theater scenery, no characters in it. It fills the theater's back wall only; the side walls and roof are part of the fixed theater. The walls, roof and the front edge of the stage frame it, so keep important detail away from the edges.
- **Never:** photorealism, heavy gradients, text in the image, multiple characters in one image.

### Style bible (versioned files)

Stored in `packages/style-bible/v<N>/`:

- `base.md` — the base style prompt applied to every request. It describes the look in plain words and never names a show, game or artist (D-38)
- `templates/` — one prompt template per asset kind (character, monster, prop, backdrop), with slots filled from the record (name, appearance, kind). The prop template serves Prop and Item records
- `anchors/` — two approved reference images per asset kind that define the look, named `<kind>-<what>`; a request carries only its own kind's two (D-39)
- `style.json` — the key color, the aspect ratio and quality per asset kind, and the list of anchors (D-38)
- `palette.json` — the fixed color palette: the reference for the look and the anchors, kept well clear of the key color. Post-processing does not map images to it (D-43)

Every asset records the style bible version that made it. Changing the style bible bumps the version; old assets are kept, and can be regenerated in bulk if wanted.

### Generation flow

1. GM clicks **Generate visual** on an NPC, Prop, Item or Spot record or a PC's sheet (bulk generation later). An NPC first asks whether it is a humanoid or a monster, which picks the template and anchors; a PC is always a humanoid (D-42). The prompt is built automatically from the template + the record's appearance (a Spot's backdrop notes) and public description.
2. A job is queued (pg-boss, run inside the app process, D-42). The record shows "generating" and polls until it is done.
3. The worker calls OpenRouter (`openai/gpt-image-2`) with the prompt and the anchor images of the asset's kind. The model can't return a transparent background, so puppets and props are drawn on a flat magenta key color instead (D-38).
4. **Post-processing (sharp, D-43):** for puppets and props, clear every pixel close to the key color (the background and any of it seen through a gap in the subject) and the key-tinted fringe of the outline, drop stray specks, trim, resize so the cutout is 1024 px on its longest side, and add a uniform cardboard border (12 px, paper colored, with a 3 px wood-brown cut edge). Transparency is all or nothing and no shadow is baked in: the stage sorts cutouts by depth and draws their shadows, a fake drop shadow each (D-46). Backdrops are cropped to 16:9 if needed and kept at 1536 × 864, the model's own size. Colors stay as the model drew them. Saved as WebP (quality 90, transparency exact) beside the untouched original. Puppet sticks and prop stands are never drawn into the image: the stage adds them as geometry, anchored at the bottom center of the cutout.
5. The image appears as a **draft** with its cost. A record or PC has one image in use, always shown first, and at most one draft under review; tries are not all kept (D-44).
6. GM reviews (D-44): with no image in use, **Use this** (it becomes the record's visual) or **Discard**; beside an image in use, **Replace** or **Keep current**, shown side by side. **Regenerate with notes** (e.g. "bigger hat, angrier eyebrows") sends the draft, or the image in use, back to the model as its only reference image, the untouched original and never the processed version, with the notes added to the prompt. A changed draft is shown **Before** and **After** until the GM picks **Keep new** or **Go back**. Whatever is discarded or replaced loses its files; its row stays for the hourly limit and its cost.
7. **Upload instead:** the GM can upload their own image at any point. It goes through the same post-processing so it matches.

### Model choice and swapping

- Image model is one config value (an OpenRouter model slug). Starting model: `openai/gpt-image-2`.
- Before switching models or changing the style bible, generate the fixed test set (the same 10 made-up records: 3 characters, 2 monsters, 3 props, 2 backdrops) with `pnpm style:sample` and compare its contact sheet side by side with the current set (D-38).
- Style-model training (e.g. a custom model trained on approved assets) is deferred, but approved assets are kept with their prompts so a training set exists if needed.

### Cost guardrails

- Default to a medium quality setting; high quality only for backdrops if needed.
- Show the estimated cost per generation; log actual cost per asset.
- Rate limit: a set number of image jobs per GM per hour (config).

## 12. The stage

The stage is a stick-puppet theater at the far end of a tabletop, rendered in the browser with React Three Fiber (D-36). Every player sits at the same table with the same locked view of the theater. The Spot's art hangs on the theater's back wall, props stand inside it as cardboard cutouts, and PCs and NPCs are puppets on sticks raised into the scene from below. A player's own controls sit on the table in front of them: their sheet is a page they look down at, and props are inspected on a small second theater.

### The table and the theater

| Piece | What it is | Behavior |
| --- | --- | --- |
| Room | A plain room around the table, out of focus: a blurred picture on a large sphere (D-46) | Fixed; never in focus |
| Table | The tabletop the players sit at, low-poly, built once | Fixed; holds the theater, the inspect stage and each player's sheet |
| Theater box | A puppet theater on the far side of the table: a back wall, two side walls and a roof, open at the front and at the bottom | Fixed geometry; walls and roof can be tinted per scene |
| Backdrop | The Spot's backdrop image, 16:9, filling the back wall | Swapped when a scene loads; scrolls in a loop in transition scenes (Phase 4) |
| Front curtain | A curtain across the front of the theater, facing the table | Closes and opens on scene changes; the GM can also close and open it by hand |
| The void | Black, open space below the scene | Puppets wait here, out of sight, and are raised up through it |
| Props | Cardboard cutouts of Prop and Item records on small stands, placed inside the box | Placed by the GM; clickable by players to inspect |
| Puppets | PC, NPC and monster cutouts on sticks | Raised and lowered by the GM; animated procedurally |
| Inspect stage | A small theater with its own closed curtain, on the table beside the main one | Opens on one prop for the player who clicked it |
| Sheet page | The player's character sheet, drawn as a sheet of paper on the table in front of them | Read and pressed directly; see "The sheet page" below |

### Placing things in the scene

- **Across and up:** a prop or puppet is placed anywhere left to right and top to bottom inside the theater's opening.
- **Depth:** it then sits on one of 10 depth ticks, from 0 at the front to 9 at the back. Ticks keep layering predictable and make "step forward" a one-click move.
- **Props** stand on a small stand or hang from the roof; either way the stand is stage geometry, not part of the image (section 11).
- **Puppets** use the same ticks. They are raised from the void to a set height and lowered back into it; a lowered puppet is in the scene but out of sight.
- Scale and a left-right flip can be set per object. Rotation is left to emotes.

### Views and camera

The theater is the same for everyone and always in sync. Where a player is looking is their own business and stays in their browser.

| View | What the player sees | How they get there |
| --- | --- | --- |
| Stage | The whole theater, front on, from their seat at the table. The default | Start of the session; closing any other view |
| Sheet | The camera tilts down to the sheet page on the table | Look down (a key, a scroll down, or clicking the page's edge) |
| Inspect | The camera turns to the inspect stage | Clicking a prop |

- The camera moves smoothly between views and is otherwise locked: no orbit, no zoom, no leaving the table.
- While a player is on the sheet or the inspect stage, the theater keeps playing; they can turn back at any time.
- The GM sees the same theater, with the control desk beside it. The scene builder starts on the players' locked view. **Look around** switches it to an editing camera that orbits the box, always from the front side, with the wheel to zoom; **Preview** is always from the locked view.

### Inspecting a prop

1. A player clicks a prop on the stage.
2. Their camera turns from the theater to the inspect stage on the table, whose curtain is closed.
3. The curtain opens on that prop, larger, with a text box below it holding the prop's public description: what the player can see.
4. Closing it (a click away, Escape, or the close mark on the text box) closes the curtain and turns the camera back to the stage.

The inspect stage is the player's own; other players don't see it open (open question 19.10). It only ever shows public text (open question 19.11).

### The sheet page

- The player's PC sheet is a page on the table in front of them. It is drawn as HTML placed on a plane in the scene (drei `Html` with `transform`), so the text stays sharp and the F1.4 sheet components are reused.
- Options are pressed right on the page where they apply: spend Hope before a called roll (F3.6), and later pick combat options (F4.2).
- The player journal sits beside it as a notebook on the table (open question 19.13).

### Puppet motion (no sprite sheets)

All motion is procedural transforms on the puppet and its stick, so any new character animates the moment its visual is approved:

- **Idle:** slight sway on the stick
- **Talking:** while a voice is detected (section 13), the puppet rises a little and brightens; it settles and dims when the voice stops
- **Raise and lower:** up from the void into the scene, and back down
- **Emotes** (preset, picked from a list): look around (turns a little left, then right), hop, nod, shake (angry), shiver (scared), lean in (curious), bow, spin, droop (faint), wave
- **Walking:** bobbing on the stick, used in transition scenes (Phase 4)

**Player emotes.** Clicking their own puppet opens a small emote menu on the stage, next to the puppet. Players can't emote anyone else's puppet and can't move their own (open question 19.6).

### Scene builder (GM)

1. Start with **New scene** on the campaign's Scenes page (an empty theater, or a Spot), or with **Build a scene here** on a Spot's own page. A Spot sets the backdrop and suggests its Props, NPCs and Items at the top of the tray. The backdrop can be changed to another Spot's, or taken away, at any time.
2. Add records from a side tray by clicking them, or by dragging them into the theater, where they land under the pointer: Props and Items become props, NPCs become puppets. The tray lists every Prop, Item and NPC that has an image for the stage. A suggested record with no image yet is listed with a link to its page.
3. Select an object in the theater or in the panel's list, then place it across and up: drag it in the theater (it stays on its depth tick), nudge it with the arrow keys, or use the panel's sliders. **Step forward** and **Step back** (or the `[` and `]` keys) move it between depth ticks; lines across the theater mark the 10 ticks, with the selected object's lit. Set its size (25% to 250%) and flip it as needed; Delete removes it. A prop can be marked hidden at first (placed but not shown yet; drawn see-through while building) and can hang from the roof instead of standing.
4. NPC puppets saved in a scene start lowered, waiting in the void. While building, a puppet stands where it will rise to; **Preview** shows the scene as players first see it, with hidden props gone and puppets below. PCs are not saved in scenes; the GM raises them live.
5. A scene has a name and saves by itself as it is changed (D-49). It holds at most 24 props and puppets, which leaves room in the budget for 6 PCs. Scenes are built ahead of time; changing one on the fly during a session arrives with the control desk (F3.4).

### GM control desk (live)

The control desk is a 2D panel beside the theater, for the GM only. It holds everything the GM needs during play:

- **Scenes:** the campaign's scenes; loading one while the curtain is open closes it, swaps the scene and opens it again; loading one while it is closed keeps it closed, so the GM can set the stage first (D-52). A manual curtain open and close.
- **Puppets:** every PC and NPC puppet in or near the scene. Select one, then raise or lower it, move it across, up or to another depth tick, flip it, or play an emote.
- **Props:** show or hide placed props; add one from the tray.
- **Reveal:** reveal or un-reveal records (section 7).
- Any puppet or prop can also be selected by clicking it in the theater.

The first part of the desk shipped with live sessions (F3.3, D-50): load a scene, open and close the curtain, a read-only list of what the stage holds, who is here, and End session. The rest shipped with F3.4 (D-52): the list of what is on stage raises, lowers, shows and hides each object, and picking one there or in the theater opens its controls (the scene builder's: across, up, depth, size, flip, hang), Reveal or Un-reveal, Open record and Remove from stage. The GM drags a picked cutout in the theater and moves it with the builder's keys. **Add to stage** offers the PCs, then every Prop, Item and NPC with an image; what is added arrives out of sight (a prop hidden, a puppet below) so it can be placed first. **Reveal** finds any record to reveal or un-reveal. In the GM's theater hidden props are drawn see-through, as in the builder, unless **As players see it** is on; puppets waiting below are only on the desk. Everything the desk changes is the live stage only; the saved scene is untouched. Emotes are F3.7.

### Live editing and NPC takeover

- During a session, every change the GM makes appears for everyone immediately.
- What comes into sight while the curtain is open (a prop shown or added in sight, a puppet raised, a scene's shown props when it loads), and what is in sight when the curtain opens, is revealed to players automatically (section 7). Only that moment reveals it: a record the GM un-reveals while it stays on stage stays hidden until it comes into sight again (D-52). PCs have nothing to reveal.
- Props and puppets glide to a new place instead of jumping, and a puppet rises out of the void and sinks back into it. The cutout the GM is dragging follows the pointer exactly (D-52).
- **Take over an NPC:** the GM selects an NPC puppet; while active, the GM's voice makes that puppet rise and brighten instead of the GM's own presence, and the NPC's name shows as the speaker. Switch NPCs with one click; release to return to normal.

### Scene types

| Type | Phase | What's special |
| --- | --- | --- |
| Static location | 3 (MVP) | Investigation and NPC conversation; props to inspect are the focus |
| Transition | 4 | Backdrop scrolls in a loop, puppets bob on their sticks as if walking; for talking while traveling |
| Battle | 4 | Players pick combat options on their sheet page; monsters show HP/Stress to the GM; Fear spending is prominent |

### Performance budget

- Target: 60 fps on a mid-range laptop with integrated graphics, in Chrome, Firefox, Edge and the Discord client.
- At most 30 objects in the theater; cutout textures 1024 px, backdrop 1536 × 864 (D-43), all sent as WebP. The room, the table, the inspect stage and the sheet page count towards the budget.
- No real-time shadows: a cutout's shadow is a dark copy of it drawn just behind it (D-46). One directional light and an ambient one on the table and theater; art is unlit. The talking brighten is a material change, not an extra light.
- Drawn at no more than 1.5 device pixels per CSS pixel (D-46).
- Measured with the stage test page (`/stage-test`, D-46) before the first playtest: 30 cutouts, each with its own texture, for 30 seconds.
- First measurement, 2026-11-14, 30 objects, Firefox 160 (D-47). A laptop with Intel HD Graphics, 1265 × 887 at 1.5x: 55 fps on average, 20 fps over the slowest 1% of frames. The dev PC (GeForce GTX 980, a 100 Hz monitor), 3399 × 1315 at 1x: 100 fps on average, 91 fps over the slowest 1%. Chrome and Edge are not measured yet.
- About that laptop figure (the designer, who watched the run): its screen shows 60 frames a second at most, so 60 is the ceiling it was measured against, and the live readout stayed at 54 or above for the whole 30 seconds. The 20 fps is therefore a few slow frames, not a stretch of slow running. What causes them is still not known.
- Inside Discord, 2026-11-14 (D-48): the desktop client on a PC with a GeForce RTX 2080 SUPER and a 100 Hz monitor, 30 objects, 3062 × 1088 at 1x: 100 fps on average, 94 fps over the slowest 1%. Integrated graphics inside Discord are not measured yet.
- Discord in a web browser, 2026-11-15 (D-51): Chrome 156 on the same PC, a small Activity frame of 749 × 380 at 1x, 30 objects: 100 fps on average, 97 fps over the slowest 1%. This is the first measurement in Chrome; Edge is not measured yet. The Discord client names the graphics card exactly; Firefox gives only a general label ("or similar"), so the card named in a Firefox line is approximate.

## 13. Live sessions and speaking detection

A live session is a Socket.IO room per campaign, with the server holding the authoritative state: current scene, curtain, every prop and puppet in the theater, Fear, Hope, who's connected and who's speaking. What each player is looking at (stage, sheet page or inspect stage) is never sent; it stays in their browser. Voice stays in Discord; Stagehand only learns *who* is talking, never what they say.

### Session lifecycle

1. GM clicks **Start session**, on the campaign page or at the table. Fear resets to 3; a `play_sessions` row and session number are created. The theater starts empty, behind a closed curtain. A campaign has one running session at a time (D-50).
2. Players open the campaign (browser or Discord Activity) and join from its **Session** card, which leads to the table (`/campaigns/:campaignId/play`). A player who gets there early waits, and the theater opens by itself when the session starts. The room admits the GM plus at most 6 players at once; a 7th player sees "session full" and can try again when a seat is free. A second tab of someone already in takes no seat.
3. Each client receives the whole stage for its role on join and on every reconnect, then the whole stage again after each change. The stage is kept in the database, so restarting the server mid-session loses nothing: browsers reconnect and join again. Only who is connected is kept in memory.
4. GM clicks **End session**. Everyone's theater closes and the live stage is cleared. Closing the event log and attaching it to that session's notes record arrives with the log itself (D-50).

### Real-time events

| Event | Sent by | Effect |
| --- | --- | --- |
| scene:load | GM | The new scene loads for all. With the curtain open it closes, the scene swaps behind it and it opens again, and its shown props are revealed; with it closed it stays closed |
| scene:curtain.open / close | GM | Opens or closes the front curtain for all |
| scene:object.add / move / remove / show / hide | GM | Live edit of a prop or puppet: add one (a record or a PC), position, depth tick, scale, flip, mount, take it off, show or hide a prop; showing reveals its record while the curtain is open |
| puppet:raise / lower | GM | Raises a puppet from the void into the scene or lowers it back; raising reveals its record while the curtain is open |
| record:reveal / unreveal | GM | Journal updated for all players. Built as plain requests, not socket events (D-52) |
| note:add / edit / delete | Anyone | Player notes on a revealed record or a player entry. Built as plain requests, not socket events (D-53) |
| journal:changed | Server | Something players read in the journal changed: a reveal, a note, an entry, a revealed record's text. Each browser reads the journal again (D-53) |
| emote | Player (own puppet), or GM (any puppet) | Plays a preset emote, by id, on that puppet for everyone |
| npc:takeover / release | GM | The talking rise and brighten goes to the chosen NPC puppet |
| speaking:start / stop | Client | That person's puppet rises a little and brightens, then settles |
| roll:call | GM | Prompt appears for the chosen player |
| roll:result | Server | Dice, total, Hope/Fear change broadcast |
| fear:spend / adjust, hope:adjust | GM | Counters update with animation |
| sheet:update | Server | A player's sheet changed (Hope, HP, Stress) |

Built so far (F3.3, D-50): `scene:load`, `scene:curtain.open` and `scene:curtain.close`, on one Socket.IO namespace, `/play`. Around them: a browser sends `session:join` with its campaign and is answered with the stage and who is here, or with why not (no session, full, not a member); the server sends `stage` (the whole stage for that browser's role, after every change), `presence` (who is connected), `session:started` and `session:ended`. F3.4 added the desk's events (D-52): `scene:object.add` (a record or a PC, made by the browser with its own id), `scene:object.move` (any of across, up, depth tick, size, flip, a prop's mount), `scene:object.remove`, `scene:object.show` and `.hide` for props, and `puppet:raise` and `.lower`, each answered like `scene:load`. `record:reveal` and `unreveal` are plain requests instead (`POST …/records/:recordId/reveal` and `/unreveal`), since the record page uses them too and a player has no journal to update until F3.5; during a session the server sends the stage again after one. A browser sends one object's moves at most every 300 ms, together, so a drag stays well inside the live room's limit. `emote` is F3.7; the rest of the table arrives with F3.5 to F3.9. F3.5a added `journal:changed` (D-53): the server sends it to everyone in the session after a reveal or un-reveal, a scene load, an open curtain, an object added, shown or raised (any of which may reveal something), a note or entry written, changed or deleted, a revealed record's edit and a record's delete. Notes and entries are plain requests (`…/journal/…` and `…/notes/:noteId`), like reveals, since the site and the table share them. Each object a player's stage holds now carries `recordId`: the record it shows while players have it, so they can inspect it; null for a PC or an un-revealed record.

A browser changes scene behind its own curtain: the server changes the stage in one step, and each browser closes its curtain, waits for the new scene's images (5 seconds at most), swaps, and opens. Arriving in a session is played the same way, from a closed curtain.

Every event is validated on the server (who sent it, and are they allowed). A connection needs a Stagehand session; membership is checked at every join and the GM's role at every action, from the database. Clients never trust each other. Inspecting a prop, looking at the sheet page and closing either send no event; the public description an inspect shows is already in the scene snapshot, built from the public allow-list (section 7).

### Speaking detection

One `SpeakingSource` interface emits start/stop for a user. Two implementations:

| Source | Used when | How | Notes |
| --- | --- | --- | --- |
| Discord Activity | Stagehand is launched as an Activity inside the group's Discord voice channel | Discord Embedded App SDK `SPEAKING_START` / `SPEAKING_STOP` events (needs the `rpc.voice.read` scope; granted with no approval from Discord, to the application's owner and to another player's account, and events arrive from more than one speaker, D-48, D-51) | Officially supported. Discord user id is mapped to the Stagehand account through Discord login. |
| Browser mic | Stagehand is in a normal browser tab, with voice in any app | Web Audio API reads the mic level locally; a threshold with a short hold-off decides talking or not; only a true/false is sent | No audio leaves the device. Needs mic permission. Speaker sound can cause false triggers without headphones; each player gets a sensitivity slider and a mute toggle. |

**Rejected:** a Discord bot listening in the voice channel. Discord does not officially support bots receiving voice, and its now-mandatory voice encryption (DAVE, required since March 2026) has already broken bots of this kind.

### Running as a Discord Activity

- Register a Discord application; set up the Activity's URL mapping to the Stagehand domain.
- Inside Discord, all network traffic goes through Discord's proxy, including Socket.IO, which connects there as a websocket. The same paths work inside the frame as in a tab, so the client changes no paths; it needs to know it is in Activity mode only for sign-in and speaking (D-48).
- Sign-in inside the frame has no redirect: Discord's SDK gives the page a code, the server exchanges it for the user's Discord token, asks Discord who that is, and signs that Discord user's existing Stagehand account in (`POST /api/auth/activity/sign-in`, D-51). The session is an ordinary one; only its cookie differs, `SameSite=None; Secure; Partitioned`, which a framed page may keep (D-48). So every route and the live room work in the frame as in a tab. Nobody gets an account this way: a new player signs in to Stagehand in a browser once and joins with the GM's invite link, which can't be opened in the frame. The page asks for the `identify` scope only; `rpc.voice.read` is asked for with speaking detection (F3.9).
- Requests from the frame carry the Origin `https://<client id>.discordsays.com`. With the Activity switched on (`ACTIVITY=true`) that origin counts as the app's own in the cross-origin check (section 14), in the live room's origin check and for sign-in. Another application's Activity is another origin, and is refused.
- Discord's proxy replaces the app's Content-Security-Policy with its own. The app's `frame-ancestors 'self'` stays as it is, and inside Discord scripts, styles, images and fonts load only from the app's own address and connections go only to it and to Discord: nothing may be loaded from a third-party host (D-48).
- The player and GM play views must work both inside the Activity frame and in a normal tab. Heavy GM prep tools (workshop, AI import) stay in the normal browser. Inside the frame the app is three pages (D-51): the player's campaigns, with where a session is running; one campaign's session, to start, join or end; and the table. A player who arrives while exactly one of their campaigns has a session running is taken to its table.
- This was the riskiest external piece, so it was prototyped right after F3.1 (D-46). The prototype, an Activity test page behind `ACTIVITY_TEST=true`, ran in the Discord desktop client on 2026-11-14 and everything it tried worked (D-48). On 2026-11-15 a player's own account ran it again in Discord in a web browser, in a small frame, with two people speaking, and everything worked (D-51). Still to try before F3.9: mobile, and integrated graphics inside Discord.
- **Who Discord lets in (found 2026-11-15, D-51).** The Activity is unverified, and Discord lets only the application's owner, its team and its App Testers launch or join an unverified Activity, and only in a server with fewer than 25 members or a DM. Anyone else is refused by Discord with "the server does not have access to the requested activity" before Stagehand is asked anything. So every player is invited as an App Tester in the Developer Portal (up to 50), accepts, and turns on Developer Mode and Application Test Mode with the application's ID in their own Discord (README, "Playing inside Discord"). That covers one group. Opening the Activity to groups Stagehand's developer doesn't know means having Discord verify the application, which is a question for Phase 4 (F4.4). Playing in a browser tab needs none of this.
- Discord's SDK can be signed in (`authenticate`) once per launch, with one set of permissions. Signing in to Stagehand in the frame does not do it; it is left for speaking detection (F3.9), which needs the voice scope, and until then for the Activity test (D-51).

## 14. Security and privacy

The three things that must never leak are GMs' API keys, private campaign fields, and one campaign's data into another. Each has a specific control and a test.

| Asset | Control | Verified by |
| --- | --- | --- |
| GM API keys (Anthropic, OpenRouter) | Encrypted at rest with AES-256-GCM; master key only in a server environment variable, never in the repo or database. Decrypted only in memory for the outgoing call. Never sent to any browser; the UI shows the last 4 characters. Deletable at any time. | Unit test that responses never include key fields; log redaction test |
| Private record fields | Player-facing responses built from an allow-list of public fields (section 7) | Integration tests per record type as a player account |
| Campaign isolation | Single scoped data-access layer; every route checks membership | Cross-campaign access tests on every route |
| Accounts | Discord OAuth only; HTTP-only, secure, same-site session cookies; CSRF protection on state-changing routes. Inside Discord's Activity frame the session cookie has to be `SameSite=None; Secure; Partitioned`, so there the origin checks are the protection: only the app's own address and Discord's proxy for this application may change state, open a live connection or sign in (D-51). Sign-in from the frame is rate limited and gives nobody a new account | Auth integration tests; Activity sign-in tests with another application's origin, an unknown Discord account and too many tries |
| Live events | A socket connection needs a Stagehand session, and one from a page on another site is refused by its `Origin` (browsers' cross-origin rules don't cover websockets). Server checks membership at every join and the sender's role for every socket event, from the database. Messages are small (4 KB at most) and a connection that floods the room is dropped (D-50) | Socket tests with a player trying GM events, a foreign origin, no session, and a non-member |
| Uploads | Images only, size limit (e.g. 10 MB), decoded and re-encoded through sharp, stored with generated names | Upload tests with bad files |
| Home network | Cloudflare Tunnel: no open router ports, home IP not exposed, HTTPS end to end | Port scan of the home IP shows nothing open |
| Abuse and cost | Rate limits on login, AI and image routes; per-GM usage caps in config | Rate-limit tests |
| Logs and error messages | Request logs carry no headers or bodies. GM notes, model answers and record text are never logged. An error is logged by type and code, and in its own words only when we wrote them; a failed query's text and parameters reach neither a log nor a response (D-28) | Log scans in the credential and AI import integration tests |
| Data loss | Encrypted database dump + asset folder on every stack shutdown (and on demand), stored on a second physical disk; every backup is restored into a throwaway database and checked before the stack stops (D-19) | Restore drill log (`restore-drill.log`, one line per backup) |

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
| Off-site backup storage | $0 | Deferred (D-19): backups stay on a second local disk until hosting moves |
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
| Discord Activity constraints (proxy, frame limits) | Low | Medium | Prototyped on 2026-11-14 (D-48): WebGL, Socket.IO, sign-in and speaking events all work in the desktop client; on 2026-11-15 they also worked for another player's account in Discord in a web browser, with two speakers (D-51). The Activity test page stays, to try mobile; browser-mic mode works without Discord. Discord admits only the owner, team and App Testers to an unverified Activity, in servers under 25 members (§13, found 2026-11-15): each player of the first group is added as a tester, and playing in a browser tab stays the way in for anyone Discord turns away | The Activity fails on mobile or another client not tried yet, or a player added as a tester still can't join |
| Browser-mic false triggers from speakers | Medium | Low | Sensitivity slider, mute toggle, recommend headphones; Activity mode avoids it | Playtest feedback |
| 3D stage too slow on players' machines | Low | High | Performance budget (section 12), measured before the playtest | Test scene under 45 fps on a mid-range laptop |
| Sheet page hard to read or use in 3D | Medium | Medium | Sheet drawn as HTML on a plane (sharp text, F1.4 components reused); the Sheet view fills the screen | Playtesters lean in or ask the GM to read their sheet |
| Locked camera feels cramped in small windows or the Discord frame | Medium | Medium | The Stage view fits the theater opening to the window's shape; the stage ran at full speed in a small Activity frame of 749 × 380 (D-51) | Props or puppets cut off at the window edge |
| AI import quality is uneven | Medium | Medium | Strict schemas, retries, review screen, eval suite | GM edits more than half of proposals |
| Claude Sonnet 5.5 or gpt-image-2 retired | Medium | Medium | Pinned versions, provider interfaces, eval suite and image test set | Provider deprecation notice |
| OpenRouter drops gpt-image-2 or changes pricing | Low | Medium | Image model is one config value; test set re-run on a new model | Pricing or model-list change |
| Home PC offline during someone's session | Medium | Medium | Acceptable for one group; move to a VPS before onboarding other groups (F4.5) | Any missed session |
| Data loss | Low | High | Verified, encrypted backups on every shutdown, on a second disk. No off-site copy yet, an accepted risk until hosted (D-19) | A failed restore drill; a session ended with `--skip-backup` or without `stack:shutdown` |
| Private field leaks to players | Low | High | Allow-list responses; per-type tests | Any failing visibility test |
| Licensing: using Daggerheart's official text or layouts | Low | Medium | Homebrew field names and own layouts; the 2d12 mechanic itself isn't copied text | Any copied wording in the UI |

## 18. Decision log

The 16 baseline decisions were made on 2026-11-07. New decisions go at the top with the next number; changed decisions get a new row and the old one is marked superseded.

| ID | Date | Decision | Why | Rejected options |
| --- | --- | --- | --- | --- |
| D-53 | 2026-11-16 | F3.5 (player journal and table) ships in two parts, and **the sheet page moves to F3.6** with Hope spending (the designer's choice). F3.5a (server and site): **players get revealed records** through their own routes (`…/journal/records`), written field by field from the public layer; a record that isn't revealed is answered as not found. **Player search** uses a new generated `records.public_search_vector` (name and public description only, §8 change). **Mentions** of records players don't have reach them as plain text (their label), so no un-revealed record's id reaches a player; mentions of revealed ones link to their page. A Spot's Area is named only when it is revealed too. **Notes** (§7, §8 change) are plain text, 1 to 500 characters, newest first; only the author edits, the author or the GM deletes; they go on a revealed record or a player entry, never both; an un-revealed record's notes are kept but unreadable until it comes back. **Player entries** (new, §7, §8): a title and a plain text description by a player, seen by every member; only the author edits, the author or the GM deletes; anyone notes them; the GM can't write one (the designer's choices). Authors are cleared when an account is deleted and show "Former player". **A player may load the image of any revealed record**, as the stage's version (`playerCanSeeAsset`), not just what the live stage shows. **Notes and entries are plain requests**, not socket events, as reveals are (D-52); the server tells the live room `journal:changed` after any change players read in the journal, including a stage action that may reveal something. **A player's stage objects carry `recordId`** while the record is revealed, so F3.5b can inspect them. The site: a player's Records page is the journal (the GM's layout without tags, only the types with something revealed, Player entries first, New entry); a record's page shows its public layer and notes; an entry has its own page; the GM gets a Player entries chip and notes under a revealed record's form. F3.5b (the table, as designed): the inspect stage for props, items and NPCs (not PCs), with the record's name on paper above and its public description on paper below, and **Post note** that turns to a sticky pad; the journal as a three-ring binder (a key page with Player entries first and each type with something revealed, a type's list, a record's page with the three newest notes on sticky notes and arrows for older ones, Back one page at a time); notes and entries are made and read at the table, and changed or deleted on the site; the GM gets the binder but not the inspect stage (the designer's choices) | Players had nothing to read: every record route was GM-only. One public read path built from an allow-list keeps private fields out by construction. Search over private text would leak it through what matches. A mention's id would point players at records they haven't been shown (§7 rule 4), while the words the GM wrote stay theirs to read. Plain text fits sticky notes and typing at the table. Keeping notes through an un-reveal makes it the undo it is meant to be. Entries let players keep what the GM hasn't written up, and sharing them suits a table. The journal shows images, so a revealed record's image must load off stage. One set of routes serves the site and the table, and an event saying "read again" keeps the table current without a second way to write | Notes as socket events; rich text notes (TipTap); private or party-editable entries; entries by the GM; deleting a record's notes on un-reveal; searching tags for players; sending mentions of un-revealed records with their ids; keeping the sheet page in F3.5; the GM inspecting from the theater |
| D-52 | 2026-11-15 | F3.4 (control desk) ships in two parts: F3.4a (the live stage's edits, PCs on stage, reveals and the session log) and F3.4b (the desk and the GM's theater). F3.4a as built: **a live object is a record or a PC** (`play_session_objects.character_id`, migration 0017, §8 change): the GM adds PCs live, as puppets, since scenes never hold them (D-36); an NPC or a PC is on the stage once, a prop record as often as wanted, at most 30 objects (the §12 budget). New socket events (§13): `scene:object.add` (the browser makes the id; it arrives **out of sight**, a prop hidden and a puppet waiting below, unless a prop is asked to be shown, so the GM places it before players see it), `scene:object.move`, `scene:object.remove`, `scene:object.show` and `.hide` for props, `puppet:raise` and `.lower`, all GM only and answered like `scene:load`. **Reveals** (§7 rule 2): a record is revealed when it comes into sight while the curtain is open (shown, raised, added in sight, or loaded with the scene's shown props), or is in sight when the curtain opens; only that moment reveals it, so an un-reveal sticks while the record stays on stage. **Loading a scene keeps a closed curtain closed** (§12, §13 change): the GM can load, arrange and then open; with the curtain open it plays as before. **Reveal and Un-reveal are plain requests** (`POST …/records/:recordId/reveal` and `/unreveal`, GM only, refused while archived) rather than the `record:reveal` socket event of §13: the record page uses them too, outside any session, and players have no journal to update until F3.5. A reveal does not change the record's `updated_at`. **`session_events` is made** (§8 change): a scene load, a reveal or an un-reveal, with the GM as actor or none for the stage's own reveals; append-only and kept when the session ends. `GET …/stage-records` also lists the PCs with an image for the stage. F3.4b as built: the desk's list of what is on stage raises, lowers, shows and hides; picking an object there or in the theater opens the scene builder's placement controls (now shared, `components/scenes/PlacementControls.tsx`), Reveal, Open record and Remove from stage (asked first; the saved scene keeps it). The GM drags a picked cutout in the theater and moves it with the builder's keys. **Moves are shown at once and sent together**: the GM's browser draws its own moves straight away and sends one object's at most every 300 ms, so a drag reaches players a few times a second inside the live room's limit (60 messages in 10 seconds). **The GM sees hidden props see-through** in the theater (the designer's choice), unless "As players see it" is on; puppets waiting below are picked from the desk. **Props and puppets glide** to a new place, and puppets rise out of the void and sink back into it (the designer's choice); the cutout being dragged follows the pointer exactly. A Reveal to players / Hide from players button is on every record's page. **Emotes move to F3.7** (the designer's choice), with the player's emote menu: they share the `emote` event and the animations | One running stage needs PCs on it, and scenes deliberately leave them out. Adding out of sight means nothing pops up in front of players half-placed. Revealing on the moment something comes into sight follows §7 ("shown in a live scene") without making an un-reveal impossible while it stays on stage. Loading behind a closed curtain is what a GM closing the curtain means: set the stage, then open. Reveal by request keeps one route for the record page and the desk, and a socket event would have nobody to tell yet. A session's log is what F4.3's recap reads, and the first things to log are here. Sending moves together keeps a drag smooth for players without risking the flood limit; drawing them at once keeps it smooth for the GM. Emotes are motion, and the motion work is F3.7 | Emotes in F3.4; snapping into place; the GM's theater drawn exactly as players see it; revealing everything on stage after every change; `record:reveal` as a socket event; a separate PC column per kind of puppet; sending a drag only when it is let go; writing live changes back to the saved scene |
| D-51 | 2026-11-15 | F3.3c as built: Stagehand as a Discord Activity, switched on with `ACTIVITY=true` (off by default). **The frame gets an ordinary Stagehand session, by cookie.** The page posts the code from Discord's SDK to `POST /api/auth/activity/sign-in`; the server exchanges it, asks Discord who the user is, finds the account with that Discord id and makes a Better Auth session whose cookie is `SameSite=None; Secure; Partitioned` (§13, §14 change). A tab's cookie keeps its stricter attributes: the frame talks to Discord's proxy, so it has its own cookie jar. The Discord token goes back to the page for the SDK's `authenticate` and is not stored; the page does not use it yet, because Discord lets a page authenticate once per launch and that is kept for speaking detection (F3.9) and, until then, the Activity test (the first build authenticated at sign-in, and the test's own sign-in then failed with "Already authenticated", code 4002). **Existing accounts only**: an unknown Discord user is told to sign in and join in a browser first. The route is a Better Auth plugin (`apps/server/src/auth/activity-plugin.ts`), so Better Auth's own code makes the session and cookie and its rate limit applies (30 a minute from one address, since a whole table arrives through Discord's proxy). **The route checks the request's origin itself**: Better Auth checks it only when a request carries cookies, and a first sign-in carries none. With the setting on, `https://<client id>.discordsays.com` counts as the app's own origin for sign-in, for the cross-origin check on state-changing routes and for live connections; any other origin, another application's Activity included, is refused. Calls to Discord are behind `providers/discord.ts`. `GET /api/activity/config` tells the page the client id and what is on (`signIn`, `test`). In the frame the app is the player's campaigns, one campaign's session, and the table; after sign-in the page asks for its own profile, and if that is refused it says this Discord client did not keep the cookie. The page asks Discord for `identify` only. The table's desk can be hidden, and the players' list of who is here gives way in a narrow window, for a small frame (§17). The Activity test stays behind `ACTIVITY_TEST`: it is what the frame shows while `ACTIVITY` is off, and a link while it is on. **First run in Discord, 2026-11-15** (desktop client, through a temporary tunnel): the application's owner signed in and started a session, so the cookie is kept and sent in the desktop client; Discord's own policy for the frame allows images from its CDN, so players' Discord pictures can show. A second account could not join: Discord refused it with "the server does not have access to the requested activity", its rule for unverified Activities (§13), so players must be added as App Testers first. **Second run, 2026-11-15** (a player's own account, added as an App Tester, in Discord in a web browser, Chrome 156, through a temporary tunnel): the player signed in and played at the table. The Activity test, run by that player, found everything as in D-48 and more: the same paths work with and without `/.proxy`; Discord's policy again replaced the app's CSP; requests arrived with the Origin `https://<client id>.discordsays.com` and `Sec-Fetch-Site: same-origin`; the `SameSite=None; Secure; Partitioned` cookie came back; Socket.IO moved from polling to a websocket (echo 97 ms); the SDK was ready at once and reported platform `desktop`, as it does in a browser; the test's own sign-in now succeeds, granted `identify`, `rpc.voice.read` and `email` to an account that does not own the application, so the "Already authenticated" fix holds and another player can be given the voice scope; speaking events arrived from 2 people (9 starts and 9 stops); and the stage, in a small frame of 749 × 380 at 1x on a GeForce RTX 2080 SUPER, ran at 100 fps on average and 97 fps over the slowest 1%. **Still not tried:** mobile, and integrated graphics inside Discord | A cookie means every route, the live room and every image load work in the frame exactly as in a tab, with nothing to carry in page script; images in particular are loaded by URL and could not send a token. D-48 saw such a cookie come back in the desktop client. Signing in only existing accounts keeps one way to become a member (the invite link) and lets a frame create nothing. Checking the origin in the route closes the one request Better Auth would have let any site make: signing a visitor's frame in to an account of the caller's choosing | A token kept in page script and sent as a header (Better Auth's bearer plugin: kept as the fallback if a Discord client refuses the cookie); making every session cookie `SameSite=None`; creating an account at first sign-in in the frame; a route outside Better Auth making the session by hand; asking for the voice scope now |
| D-50 | 2026-11-15 | F3.3 (live sessions) ships in three parts: F3.3a (sessions, and what players may load), F3.3b (the live room and the play page) and F3.3c (inside the Discord Activity). F3.3a as built: new `play_sessions` and `play_session_objects` tables (migration 0016, §8 change). A campaign has **one running session** at a time, numbered 1, 2, 3…; starting one sets Fear from the ruleset and leaves an empty theater behind a closed curtain. **The live stage is a copy**: loading a scene copies its Spot and its objects, ids kept, into the session as saved (hidden props hidden, puppets lowered) and leaves the curtain open; a count of loads tells browsers when to change scene behind the curtain. From then on the copy changes on its own, and editing the saved scene changes nothing on stage. Images are still the ones in use when the stage is read (D-49). **The server builds two views of the stage**: the GM's has every object with its record and whether it is shown; a player's has only the backdrop and the objects that are shown and can be drawn, each as an image and a place, with no record id, name or text. **A player may load an image** only as the stage's version, and only while it is the backdrop or an object in sight in the campaign's running session; anything else is answered 404 (§14: `GET …/assets/:assetId/image` was GM only). Starting and ending are plain requests (`GET` and `POST …/play-session`, `POST …/play-session/end`); ending deletes the session's objects, and is allowed in an archived campaign. F3.3b as built: **the live room** is one Socket.IO namespace, `/play`, on the app's single Socket.IO server (the Activity test's echo is another namespace on it). A connection needs the Stagehand session cookie, and a request naming a foreign `Origin` is refused (§14). A browser sends `session:join` and is answered with its role's stage and who is here, or with `no-session` (it waits and is told when one starts), `full` or `not-found`. **The cap** is 6 players connected at once; the GM is not counted, a second tab of a seated player takes no seat, and a seat is free the moment its player's last connection goes. The GM's actions in F3.3 are `scene:load` and the two curtain events (the designer's choice; the rest of the desk is F3.4); each is answered through its acknowledgement, and the role is read from the database every time. **After every change the server sends the whole stage** to a GM room and a players room, and everything sent about one campaign goes out in turn, so a join's snapshot and a broadcast can't overtake each other. Who is connected is kept in memory; the stage is always read from the database, so a server restart mid-session loses nothing. A member who leaves or is removed is dropped from the room. **Each browser changes scene behind its own curtain** (§13): close, wait for the new images (5 seconds at most), swap, open; arriving is played the same way. The table is `/campaigns/:campaignId/play`, loaded with the stage code: players get the theater with a small list of who is here; the GM gets the same theater, from the players' locked view, with a desk beside it (scenes to load, the curtain, what the stage holds, who is here, End session). The campaign page gains a Session card (start, open, join, end). The browser's side is plain TypeScript around a Zustand store (`apps/web/src/play/room.ts`), new to the project but named in §6. Left out on purpose (the designer's calls): loading a scene **marks no record revealed** until F3.4 brings the reveal controls, and `session_events` is not made until there are reveals (F3.4) or rolls (F3.6) to log | A copy lets the control desk (F3.4) raise, move and show things without touching the saved scene, and lets the GM fix a scene in the builder mid-session without the stage jumping. One running session per campaign means a player joining never has to choose. Two views built separately mean a hidden prop can't reach a player because a filter forgot a field (§7). Serving a player only what the stage shows keeps every other drawing in the campaign private, with no reveal bookkeeping needed yet. With no way to un-reveal before F3.4, marking records now could not be undone. Sending the whole stage (30 objects at most) means a browser can never drift from the server, and a reconnect is the same code as a first join. Leaving the curtain to each browser lets it wait for its own images, and leaves the server no timers to lose in a restart. Counting connected players keeps the cap simple for a group that fits it; nobody is locked out by a seat held for someone who left | Reading the saved scene directly during play; the live stage as one JSON column; trimming the GM's view to make the players'; serving players any image of a revealed record; marking shown props revealed in F3.3; making `session_events` now; one event per change with the browser patching its copy; the server timing the curtain; holding a dropped player's seat for a while; starting and ending a session over the socket; keeping the stage in memory |
| D-49 | 2026-11-14 | F3.2 (scene builder) ships in three parts: F3.2a (the scenes API), F3.2b (the builder page) and F3.2c (placing by hand in the theater). F3.2a as built: new `scenes` and `scene_objects` tables (migration 0015, §8 change). **A scene stores its Spot, not a backdrop image**: the backdrop is the Spot's image in use when the scene is read, and each object is drawn with its record's image in use. **A saved scene holds at most 24 objects**, the 30 of the §12 budget less 6 PCs (`SCENE_MAX_OBJECTS` and `SESSION_MAX_PLAYERS` in the shared package). The server works out an object's kind from its record: a Prop or Item is a prop, an NPC is a puppet, and nothing else can be placed. A record needs an image for the stage before it can be placed. A prop record can be placed several times, an NPC once. A prop is on a **stand or hangs from the roof** (`mount`; the designer's choice); a wall tint per scene is left out for now. One flag, `shown`, belongs to props; a puppet is always saved lowered, at the place it will rise to. `scene_objects` has no PC column yet (D-36). The builder **saves by itself** (the designer's choice): a scene's objects go as one whole list (`PUT …/scenes/:sceneId/objects`), with ids made by the browser, and its name and Spot as a PATCH. Deleting a record removes it from every scene; deleting a scene's Spot leaves a bare wall. `GET …/stage-records` lists what can be placed: every Prop, Item and NPC with an image for the stage, and every Spot. All of it is GM only. F3.2b as built: a Scenes page per campaign (`/campaigns/:campaignId/scenes`: new, rename, delete), **Build a scene here** on a Spot, and the builder (`…/scenes/:sceneId`), which fills the window and loads with the stage code. The builder has a tray on the left (the Spot's suggestions, then every record with an image, with a search), the theater in the middle and a panel on the right (§12 "Scene builder"). A new object lands near the middle of the opening on depth tick 5. In the theater, objects are drawn in list order, each 0.002 units nearer the front than the one before, so two on the same tick never flicker through each other; a lowered puppet waits with its top 0.3 units below the opening, out of the camera's sight. A cutout whose image fails to load is left out and the rest of the theater keeps drawing. Links from the builder to a record open in a new tab, so the builder stays open (the designer's call). F3.2c as built: a cutout is **dragged on its own depth tick**: the pointer's ray is cut by the upright plane at that depth (`apps/web/src/stage/placement.ts`), so dragging works from the locked camera and the editing camera alike, and a press that moves less than 4 pixels only selects. A tray row can be dragged into the theater and lands under the pointer on depth tick 5. **Look around** turns on the editing camera (§12 "Views and camera"): an orbit about the middle of the box, held to the front side (about 72° either way, from above down to just below level, 2.5 to 12 units away), with no panning; it holds still while a cutout is dragged. Depth guides mark the 10 ticks while an object is selected. Keys: arrows nudge by 1% of the opening (5% with Shift), `[` and `]` change the tick, Delete or Backspace removes, Escape lets go; none of them act while the GM is typing | A stored backdrop asset would point at deleted files as soon as the GM replaced the Spot's image (D-44), and following the image in use means a better drawing shows up in every scene at once. PCs are raised live, so a scene that used all 30 places would leave no room for them. Working out the kind on the server keeps a scene from ever holding a Faction, or a well on a puppet's stick. One whole list fits saving by itself and last write wins, as link fields do (D-24). Ids from the browser mean an object keeps its identity from the moment it is placed, which the live stage (F3.3) will need. Dragging on the object's own tick keeps depth a separate, one-click choice (D-36), and needs no guess about how far back the pointer means | Storing a backdrop asset on the scene (§8 as first written); a cap of 30; the browser sending each object's kind; one request per object change; a Save button; a wall tint per scene now; props on stands only; dragging that also changes depth; a free-flying editing camera; opening records in the same tab |
| D-48 | 2026-11-14 | The Discord Activity spike (§13) is done, and running inside Discord goes ahead as planned. An Activity test page (`/activity-test`, and the whole app when Discord opens it as an Activity; its server routes and Socket.IO echo only with `ACTIVITY_TEST=true`, which the live site never sets) ran in the Discord desktop client through a temporary tunnel. It found: **(1)** the same request paths work in the frame as in a tab, with or without Discord's `/.proxy` prefix, so the client changes no paths (§13 change). **(2)** Socket.IO connects and moves from polling to a websocket; an echo took 81 ms. **(3)** Discord's proxy replaces the app's Content-Security-Policy with its own, so `frame-ancestors 'self'` never reaches the frame and stays as it is; Discord's policy lets the page load scripts, styles, images and fonts only from its own address and connect only to it and to Discord. **(4)** The server sees the frame's requests with the Origin `https://<client id>.discordsays.com`. **(5)** A `SameSite=None; Secure; Partitioned` cookie comes back. **(6)** Sign-in works with no redirect: the SDK's `authorize` gives a code, the server exchanges it, and `authenticate` accepts the token. **(7)** The `rpc.voice.read` scope was granted with no approval from Discord, and `SPEAKING_START` and `SPEAKING_STOP` arrived, 14 of each from one speaker. **(8)** The stage held the monitor's 100 fps with 30 objects (§12). **Not tried yet:** an account that does not own the Discord application, so whether another player is granted the voice scope is open; speaking events from a second person; Discord in a browser; mobile; a small Activity frame; integrated graphics inside Discord. The test page stays behind its flag for those. Its token route has no rate limit and gets one before it runs anywhere but a dev machine | Neither §17 trigger fired (Socket.IO or WebGL failing in the frame), and the three things Discord's docs leave unclear (the path prefix, the voice scope, cookies in the frame) are answered for the desktop client by a real run. Finding this now means F3.3 and F3.9 are designed on what Discord does, and the remaining cases can be tried with a player before either is built | Leaving it to F3.9; allowing Discord's origins in `frame-ancestors` (built for the spike, removed once the header proved to be replaced); prefixing every request with `/.proxy` |
| D-47 | 2026-11-14 | F3.1 is accepted on its first measurement (§12). With 30 objects in Firefox, a laptop with Intel HD Graphics averaged 55 fps at 1265 × 887 and 1.5x, and the dev PC held its monitor's 100 fps. The laptop is 5 fps under the 60 fps target and above the 45 fps warning sign (§17); its slowest 1% of frames ran at 20 fps, a stutter whose cause is not known yet. Only Firefox was measured: Chrome and Edge are measured when a player sends a result line, and the Discord client in the Activity spike. If a player's machine falls under 45 fps, the first thing to try is lowering the pixel-ratio cap from 1.5 to 1 (D-46) | The designer watched it run on the laptop and was happy with it. The stage test page stays, so any player can measure their own machine before the playtest. A lower cap costs sharpness, so it waits for a measurement that needs it | Holding F3.1 open until Chrome, Edge and Discord are measured; lowering the cap to 1 now |
| D-46 | 2026-11-14 | F3.1 as built, in two parts: F3.1a (the theater) and F3.1b (the performance test scene). The stage is React Three Fiber 9 on Three.js 0.187, with drei, loaded only when a stage page opens, so it stays out of the main bundle. The table and the theater are built in code from named measurements (`apps/web/src/stage/dimensions.ts`): the opening is 3.2 × 1.8 world units (16:9, like the back wall), the theater is 1.5 deep, and the 10 depth ticks run in even steps from just behind the curtain to just in front of the back wall. `DEPTH_TICKS` and `STAGE_MAX_OBJECTS` (30) are in the shared package, for the server's scene checks (F3.2). The player camera is locked and front on, with a 30° field of view, and backs away until the theater's front fits the window both across and up. The table is wood planks and the outside of the theater is kraft cardboard, both generated textures (`pnpm stage:textures`); the open curtain stays gathered over a quarter of the opening, an eighth each side. Around the table is **a room**: a large sphere carrying a generated picture of a plain room, blurred when it is made, so the room is there but out of focus (§12 change). **Cutout shadows are fake drop shadows**: a dark copy of each cutout drawn just behind it, with no shadow maps and no real-time shadows. This refines D-43, which left shadows to the stage, and settles its wording against the §12 budget in the budget's favor (§11 step 4 change). The §12 budget's backdrop size is corrected to 1536 × 864 (D-43) and "compressed" to WebP, and the stage is drawn at no more than 1.5 device pixels per CSS pixel. A stage test page (`/stage-test`, open to any signed-in user, linked from Settings) shows the theater with bundled sample art, the style bible's 8 anchors after post-processing (`pnpm stage:samples`). It fills the theater with up to 30 cutouts on sticks and stands, each with its own texture upload, shows the frame rate and draw calls, and measures 30 seconds into one line a player can send to the GM. The Discord Activity prototype (§13) runs as a spike right after F3.1 | Building in code keeps every measurement a constant that the camera, the depth ticks and the scene builder share. Sample art means the test needs no campaign and no image route for players, and is the same scene on every device. A drop shadow costs one more draw per cutout; a shadow map is the kind of cost the budget rules out on integrated graphics (the designer's call). The room replaces a blank dark void with one draw call and a 16 KB picture. Without a cap, a 4K laptop draws several times the pixels for little gain; the test page can try other caps before the number is fixed | A Blender model for the table and theater; the campaign's own images in the test scene; one shadow-casting light; measuring both kinds of shadow before choosing; downloaded photo textures; a flat dark background; the Activity prototype inside F3.1 |
| D-45 | 2026-11-14 | F2.6 (manual upload) and F2.7 (asset library) are deferred until after the Phase 3 MVP; work moves on to Phase 3 with F3.1. They stay on the roadmap, unticked, to come back to later | Both are nice to have but neither is needed for the MVP: Generate visual with review (F2.3 to F2.5) already gives every record and PC its image, and the playtest matters more | Building F2.6 and F2.7 before Phase 3; dropping them from the roadmap |
| D-44 | 2026-11-14 | F2.5 as built. A record or PC has **one image in use** and at most one draft under review: a new image, or a new image and a change of it. The Visual card shows the image in use first. With no image in use a draft gets **Use this** or **Discard**; beside one, **Replace** or **Keep current**, shown side by side. A new image is refused while a draft waits. **Regenerate with notes** works on the draft, or on the image in use when there is no draft: the request sends one reference image, the stored original exactly as the model made it (never the processed version), instead of the anchors, and the prompt is the record's normal prompt plus a revision block (`packages/style-bible/v1/revision.md`, added to v1, which changes no existing prompt) ending with the notes. The new asset records `revised_from_id` and the notes (about $0.05). A changed draft is shown **Before** and **After** until the GM picks **Keep new** or **Go back**; nothing else is allowed meanwhile, nor while an image is being made. Discarding (and replacing) marks a try `rejected` and deletes its original and processed files; the row stays, with its cost. Starting a new image dismisses failed tries; the image in use can only be replaced. At startup the server discards drafts of deleted records and deletes the files of any discarded try that still has them. Migration 0014 adds `revised_from_id`, lets a rejected row have no file, and keeps per record or PC its image in use and its newest unused finished try, discarding the rest. Refines D-42 (every try kept, newest first) and §11 steps 5 and 6 | The GM wants each record to hold one final image without the disk filling with tries. Sending back the untouched original makes the notes an edit of the image the GM saw, not a new drawing, and keeps the processed version's cut-out and border out of the model's copy. Comparing before and after means a worse edit is never a loss. Keeping the small row keeps the hourly limit honest and the cost history whole | Keeping every try; a regenerated image replacing the old draft automatically; sending the anchors with the image to edit; sending the processed image; deleting discarded rows outright; a fresh generation with the notes added to the prompt |
| D-43 | 2026-11-14 | F2.4 as built. Post-processing (`apps/server/src/visuals/process.ts`, sharp) clears **every** pixel close to the image's own key color (sampled from its edges, since the model's magenta drifts), not only the background reached from the edges, plus the key-tinted fringe of the outline and stray specks; then trims, sizes a cutout to 1024 px on its longest side and adds a 12 px paper-colored cardboard border with a 3 px wood-brown cut edge. Transparency is all or nothing and no shadow is baked in. Backdrops stay 1536 × 864. Colors are **not** mapped to the palette. Output is WebP at quality 90 with exact transparency (about 100 KB a cutout), stored beside the untouched original; the asset records its size and the post-processing version. It runs in the image job right after the original is stored; if it fails the try still ends `pending` with its original only. A second pg-boss queue, `process-visual`, remakes stage versions at startup for any image without one or made by an older version. `GET …/image` serves the stage version (the original until there is one), `?v=original` the original; the browser's URL carries the version, so a remade image is never served from cache. A free command, `pnpm style:process`, runs the pipeline over saved images and writes a side-by-side sheet. Refines D-38 and §11 step 4 | On the real test images an edge-only fill left magenta windows in most cutouts (between a well's posts, inside a lantern handle), and the palette and prompt already keep magenta out of subjects. All-or-nothing transparency lets the Phase 3 stage sort overlapping cutouts by depth without blending; real shadows from the stage look better than a baked one. Mapping to the 39-color palette discolored too many images (the GM's call, after the sheet). Backdrops at 2048 × 1152 would only be an upscale. Lossy WebP with exact alpha is about a quarter the size of lossless and looks the same at 3× zoom | A flood fill from the edges only; a baked soft drop shadow; mapping to the palette (hard, OKLab); a kraft-brown border; upscaling backdrops; lossless WebP; processing in a separate job after the image is stored |
| D-42 | 2026-11-13 | F2.3 as built. **Generate visual** is on NPC, Prop, Item and Spot records and on PC sheets; stat blocks have none yet. Props and Items use the prop template and anchors, Spots the backdrop ones, and PCs the character ones; an NPC asks the GM "humanoid or monster?" and uses the character or the monster template and anchors. On a PC's sheet the Visual card sits between Identity and Traits. The prompt is the base style plus the kind's template, filled with the name and labelled lines from the record (the same lines, in the same order, as the image test set), each capped at 1,000 characters, and is stored with the asset, never logged. Jobs go through pg-boss 12 inside the app process (queue `generate-visual`, its own `pgboss` schema in the same database, 2 workers, no pg-boss retries; a rate-limited call is tried once more): the request answers 202 with a `generating` asset and the browser polls. A new `assets` table (§8) keeps every try, with the statuses generating, failed, pending, approved and rejected and an error code when failed; at startup a try that had started is marked interrupted, and one still generating after 15 minutes counts as interrupted. Images are stored as the model made them on local disk under `ASSETS_DIR` (the `stagehand_assets` volume in production, archived by `stack:shutdown`) and served to the GM only, by `GET …/assets/:assetId/image`. **Use this one** comes forward from F2.5: it sets the record's or PC's `visual_asset_id` and marks the try approved; F2.5 keeps regenerate with notes and reject. Limits per GM: 30 images an hour, 3 at once, one at a time per record or PC. Deleting a record or PC keeps its assets, for the asset library (F2.7) | The GM wanted to see images on real records before post-processing and review exist. An NPC can be a sailor or a goblin, and only the GM knows which. pg-boss keeps queued jobs across a stack restart without adding Redis, and running it in the app process keeps the stack at three containers. Keeping every try lets the GM compare, pick, and see what each cost | Guessing the kind from a linked stat block or from keywords; the in-process runner AI import uses (a queued job would not survive a restart); a separate worker container; keeping only the latest try; approving only through F2.5 |
| D-41 | 2026-11-13 | F1.10 as built. A Prop's `spot` link (one Spot) is the only stored link between a Prop and its Spot; a Spot's "Props here" is shown from those links (`INVERSE_LINK_FIELDS` in the shared package), with a "New prop here" button that creates a Prop already placed there, and the Spot's backlinks panel leaves those rows out. Props can also be the target of an Item's current holder and a Story beat's involved. Migration 0011 rebuilds the `record_type` enum (every pending migration runs in one transaction, and Postgres can't use a value added with `ADD VALUE` before it commits), then turns each point of interest into a hidden Prop at its Spot, with its detail as hidden details and the Spot's tags, source and import; a point of interest that is already an Item at that place (linked from the Spot's items here, or held by the Spot or its Area; names compared without a leading article, one inside the other as whole words counts) stays only the Item, its detail added to the Item's GM notes; old import proposals lose the key. AI import moves to prompt v5: a Prop for what stays put, an Item for what can be carried, never both; the index shows each Prop's Spot and a full Spot lists its Props; a Spot→Prop link written as `propsHere` is turned around into the Prop's link. The eval gains a `props` case (15 steps) and a `linkedTo` expectation (§8, §10 change) | One stored side means the Spot's list and the Props can never disagree, and AI import has one way to place a Prop. Rebuilding the enum lets the data move run in the same migration. The trunk in the GM's real notes was both an Item and a point of interest; matching loosely on name and place keeps it one record | Two link fields kept in sync; two independent link fields (like an NPC's home spot and a Spot's NPCs); `ADD VALUE` and a data migration in a separate release; making every point of interest a Prop; exact name matching only |
| D-40 | 2026-11-13 | A GM's OpenRouter key (F2.2) is stored exactly like the Anthropic key (D-26): one encrypted row per user and provider, shown only by its last four characters. Before it is stored, the server checks it with `GET https://openrouter.ai/api/v1/key` (key metadata, no generation, no credit used, no retries, 10-second timeout); a key OpenRouter rejects, a management key (`is_management_key`: it can only manage other keys and can't generate images), a rate limit or no answer stores nothing, each with its own message. The key routes take the provider from the path: `PUT` and `DELETE /api/me/credentials/:provider` for `anthropic` and `openrouter`, 404 for anything else. Settings shows one card per provider, the same card with each provider's words. Refines D-26 | The check costs nothing and catches a mistyped or management key when it is entered, not at the first Generate visual. One route and one card for both providers means a third provider is a schema, a check and a few sentences | A format check only; a test image generation as the check (it costs money); separate routes and cards per provider |
| D-39 | 2026-11-13 | Style bible v1 is released with 8 anchors, two per asset kind (character, monster, prop, backdrop), and each image request carries only its own kind's two; characters and monsters are separate groups (§11 change: was 4–6 anchors sent with every request). Anchors are WebP, at most 1024 px on the longest side, named `<kind>-<what>`, and at most 4 per kind. The character and monster templates add a cute chibi, flat-vector style block (big head, stubby limbs, perfectly even outlines, flat fills with one hard shade, simple geometric details, solid oval eyes with no pupils); props and backdrops keep the round-1 look. The final palette is 39 colors: 32 clustered from the anchors (k-means in Lab, magenta excluded) plus 7 from the draft for colors the anchors lack (pink, purple, blue, teal, pale sky, bright yellow, light grey) | Each reference adds about a cent to every image it is sent with, and a character's references don't help a monster or a backdrop. Two per kind kept one look across the test set at about $0.055 a puppet, $0.071 a prop and $0.044 a backdrop. The designer chose the anchors and the chibi direction from two sample rounds. A palette only from the anchors would push future pinks and purples onto the nearest anchor color | All anchors with every request (about $0.12 a puppet); trimming to 6 shared anchors; characters and monsters sharing one group; a palette taken only from the anchors; keeping the draft palette |
| D-38 | 2026-11-13 | The image style bible (F2.1, §11 changes): gpt-image-2 through OpenRouter returns only opaque images (`background` takes `auto` or `opaque`), so the puppet and prop templates ask for a flat magenta (`#FF00FF`) background, which F2.4 removes with a flood fill from the image edges; the palette keeps every color well away from magenta, and backdrops stay opaque. The style prompts describe the look in plain words (flat color, bold dark outlines, chunky 90s cartoon shapes, cardboard theater) and never name a franchise; the loader refuses one. `packages/style-bible/v<N>/` gains `style.json` (key color, aspect ratio and quality per kind, anchors). The OpenRouter image call is plain `fetch` to `POST /api/v1/images` behind `providers/openrouter.ts`, no SDK. The fixed test set of §11 is 10 made-up records, drawn by hand with `pnpm style:sample` (key in the git-ignored server env, paid, never in CI), which writes a contact sheet. The anchors are picked from its runs. F2.1 ships in two parts: F2.1a (package, provider, test set and command) and F2.1b (anchors, final palette) | Asking for a transparent background is not possible with this model; a key color removed from the edges inward is the simplest reliable cutout, and the thick dark outline the style asks for gives the fill a hard stop. Image models refuse or copy named franchises, and the anchors carry the look better than a name. A dev command lets the look be tuned before F2.2 and F2.3 exist, and reuses the provider they will need | Requesting transparency anyway; a white or green screen (both common in the art); removing the background with a segmentation model; naming the reference shows in the prompt; the OpenAI SDK pointed at OpenRouter; making the anchors outside Stagehand |
| D-37 | 2026-11-13 | Props are records: a new `prop` record type (name, public description, appearance, hidden details, Spot link) replaces a Spot's points of interest, and Spots gain a "props here" link field. A Prop's public description is the text the inspect stage shows. Built as F1.10 before Phase 2 visuals: a migration turns each existing point of interest into a hidden Prop linked from its Spot (its detail becomes the Prop's hidden details), AI import moves to prompt v5 and its eval cases follow. Items can also be placed as props; a thing the party can carry stays an Item (D-33), a thing that stays put is a Prop (§8, §10, §11 change) | A prop on the new stage needs its own art, its own player-facing text and its own reveal; records already have all three, and Phase 2's "Generate visual" works on records. Making the change before Phase 2 means no asset ever has to be attached to anything but a record | Points of interest upgraded in place (id, public text and a visual inside the Spot's private fields, which mixes public and private data and needs assets tied to a Spot and a list position); props only as Item records (a well or a statue isn't an item) |
| D-36 | 2026-11-13 | The stage is a stick-puppet theater at the far end of a tabletop (§12 rewritten, §1, §2, §4, §7, §8, §11, §13 change). The theater is a box with a back wall, two side walls, a roof, a front curtain and an open black void below. The Spot's backdrop fills the back wall only (16:9, 2048 × 1152); walls and roof are fixed. Props are cardboard cutouts placed across and up inside the opening and on one of 10 depth ticks. PCs and NPCs are puppets on sticks raised from the void. Players get locked views (stage, sheet page on the table, inspect stage) with smooth moves between them; only the theater is synced, each player's view stays in their browser. Clicking a prop turns that player's camera to a small inspect stage whose curtain opens on the prop, with its public description below. A talking puppet rises a little and brightens. Emotes are presets (e.g. look around); players open them from a small on-stage menu on their own puppet, the GM plays them on any puppet from a control desk. A saved scene holds the backdrop, props, and optionally NPC puppets that start lowered; PCs are added live. The live session table is `play_sessions`. Refines D-08; supersedes the orbit camera, clickable prompt signs, entering from the wings and the player emote menu in the 2026-11-07 §12 | The designer's settled vision for Phase 3, written down before Phase 2 because it sets what Phase 2 produces: back-wall backdrops, props for Prop and Item records, and puppets with a clean bottom edge and no stick drawn in. Locked views keep every player looking at the story, and putting the sheet and the inspect stage on the table keeps controls in the world. Depth ticks make placing quick and layering predictable | A clamped orbit camera; a backdrop wrapping onto the side walls; free depth placement; emotes from a button bar or from the sheet page; GM-only emotes; saving PCs in scenes |
| D-35 | 2026-11-12 | Any record in the index can be renamed or tagged, not only those shown in full; in a later step the model's questions count, with the GM's answers, towards which records go in full; and prompt v4 has the questions round ask every filing choice (what becomes a record, where it belongs, renames) so the records step decides instead of asking (§10 context pack change) | In the first real import on v3 the GM agreed to a rename the model had suggested, but the record was only in the index, so the rename was refused; the GM's answer didn't name the record, the model's question did. A rename or a new tag overwrites nothing, so it needs no full view. The same import went to the records with no further questions and then left a filing question open above the cards | Making the GM name the record in the answer; showing every record in full |
| D-34 | 2026-11-12 | From the first eval run: the import runs at `high` effort instead of `medium` (D-27), and fill mode may rewrite a field that already has content when the GM's notes ask for it, shown in review as a diff (§10 modes change) | High effort passed 29 of 30 steps against 25 for medium, and on the GM's real notes it made the trunk an Item every time where medium never did, for about 40% more per call (about $0.03 a step) and about 17 seconds instead of 10. Fill mode was throwing away a description the GM asked for because creating the record had already written a short one; the GM still accepts or rejects the change | Staying at medium; fill mode touching empty fields only |
| D-33 | 2026-11-12 | The import prompt (v3) gives anything the notes call an item, or that the party can pick up, open or carry and that matters to the story, its own Item record, even when it is also a point of interest of a Spot (§10) | In the eval pilot, a trunk the GM listed under "Key Items" became only a point of interest on its beach, so there was no record to fill in or reveal later, while a pendant in the same notes became an Item | Leaving items as points of interest only; making every point of interest an Item |
| D-32 | 2026-11-12 | The import eval is slim: 12 made-up steps instead of 15–20, code checks only (no model judge), one sign-off on the cases, and it compares medium and high effort, each run twice. The GM's own notes run from a git-ignored folder (§10 eval suite change) | The import already works well in hand testing, so the eval is insurance for the changes that will come: a model retirement, a new prompt, an effort setting. Code checks catch the failures that matter there (duplicates, leaked secrets, invented mechanics, broken answers) and give the same grade every time. Twelve cases can't resolve small score differences, which is accepted for now | The full 15–20 case suite with a graded pilot; no eval until the first model change; a model judging quality; testing low effort |
| D-31 | 2026-11-12 | The import prompt (v2) has the model come up with a name, an appearance or a description when the GM's notes or answers ask for one, and only then; otherwise it still records only what the notes say (§10) | Asking for "a name for the bartender" is the GM deciding, and the model refusing made the GM write it by hand. Limiting it to what was asked keeps the rule against invented plot and secrets. v2 ships before the eval suite exists (F1.9b), against the "run the eval before a prompt change" rule; the eval measures v2 when it lands | Never inventing anything (v1); letting the model fill gaps freely |
| D-30 | 2026-11-12 | An import asks its questions before proposing any records: the GM answers in one box, round after round, or presses "Generate records"; a round with no questions goes straight to the records. At most 10 model steps per import. A ready import with no proposals can be closed (committed with nothing saved) (§8, §10 pipeline change) | Questions that touch many records were answered by editing card after card. Answering first lets the model apply each answer everywhere it matters, and the cached prompt keeps a round cheap. The step cap keeps a loop from running up cost | Questions and records in one answer (F1.8a); a fresh set of records after answering, carrying no review decisions; one answer box per question |
| D-29 | 2026-11-12 | The import page shows the estimated cost when the GM asks for it ("Check cost"), instead of a forced confirm step before large imports (§10 cost guardrails change) | The estimate is free and exact for the input, but a forced step slows every large import, and its answer-size part is a guess until the eval calibrates it. What each import actually cost is shown afterwards, per import and in total, on the import page and in Settings | A confirm step above a size threshold; a confirm step before every import |
| D-28 | 2026-11-11 | Every error a route throws is answered and logged by one handler. An error we raise ourselves is sent and logged in its own words. Any other error is logged as its type, its codes (Fastify's, and Postgres's error code, constraint and table) and, for a server fault, the place it was thrown, never its message; and a server fault is answered with a fixed message | A failed database query's error carries the query and its parameters, which is whatever the GM was saving. Fastify's default handling wrote that to the log and into the 500 response. Found by the log scan in the F1.8a import tests | Fastify's default error handling; redacting log lines by pattern; logging whole errors outside production |
| D-27 | 2026-11-11 | AI note import calls Anthropic through the official `@anthropic-ai/sdk` behind our own `AnthropicProvider` interface; the Vercel AI SDK is not used (§6 changes). The model writes a small answer that knows nothing of the record types: rich text as Markdown (the server converts it to and from the editor's JSON, with `[[id]]` for a mention), a record's fields as key and value pairs, and records named by short ids (`E3` for an existing record, `N1` for a new one; real ids never leave the server). The server checks every answer against the real per-type schemas, sends it back once with its problems, and on a second failure shows the GM those problems. The model is told about every record of the campaign: all of them by id, type and name; every Faction and Area and the neighbours of named records by one line; the records the notes name, and a record being filled in, in full, inside a size budget. Only records shown in full can receive field updates; any record can receive links. An update is a proposal like any other (accept, edit or reject), shown as a diff against the record as it is when the review opens; it changes only the fields it names and adds tags without removing any. In review every field of a proposal can be edited; links can be removed but not added, and an update can drop changes but not gain new ones. The call runs in the background of the API process with no job queue: `POST …/imports` answers 202 and the browser polls; an import cut off by a restart is marked failed at the next start. It is streamed, with `output_config.effort` set to `medium` and the prompt file marked cacheable. A refusal or a cut-off answer fails the import with a plain message; Anthropic's server-side refusal fallback is not used while it is a beta. Commit saves every accepted proposal in one transaction, under ids assigned when the proposals were made: new records (Areas before Spots), their links, updates, then links from existing records, with `source = ai_import` and `ai_import_id` on the new records. A Spot whose proposed Area was left out blocks the save with a message naming both; links to left-out or deleted records are dropped; an update or link whose own record was deleted is skipped and reported. Guardrails: 40,000 characters of notes, 20 imports per GM per hour, one running import per GM (a unique index), a free token count behind the cost estimate, and `GET /api/me/usage`. F1.8 and F1.9 ship as four commits: F1.9a, F1.8a, F1.8b, F1.9b | One SDK already does the key check, and its types document streaming, structured output and token counting; our own interface is what keeps the provider swappable. Anthropic's structured output refuses recursive schemas and allows few optional properties, so Markdown and key and value fields keep the answer inside what it accepts while our Zod schemas stay the one source of truth. The index of every record is what stops a second brain-dump from duplicating the first; limiting updates to records shown in full means the model never overwrites text it hasn't read. Cloudflare Tunnel drops a request that is silent for 100 seconds, and an import can take longer. Ids assigned up front let proposals link to and mention each other before anything is saved | Vercel AI SDK; editor JSON on the wire; one schema property per record field; sending only the records the notes name, or every record in full; running the import inside the request; a job queue now; saving proposals one at a time; adding links during review; the beta refusal fallback |
| D-26 | 2026-11-11 | A GM's provider key is one row of `provider_credentials` per user and provider (not per campaign), used for every campaign they run. It is encrypted with AES-256-GCM under `CREDENTIALS_ENCRYPTION_KEY` (32 random bytes, server environment only), stored as `v1.<iv>.<ciphertext>.<tag>` with associated data naming the user and provider, so a value moved to another row won't decrypt. No key rotation yet: losing or changing the master key means GMs enter their keys again. Before an Anthropic key is stored, the server checks it with Anthropic (`GET /v1/models` through the official `@anthropic-ai/sdk`, free, no retries); a key Anthropic rejects or forbids is refused (400), and when Anthropic is rate limiting (503) or can't be reached (502) nothing is saved. Replacing a key resets its date; a refused replacement keeps the old key. Routes: `GET /api/me/credentials` (provider, last four, date), `PUT` and `DELETE /api/me/credentials/anthropic`; OpenRouter's arrive with F2.2. Only `getProviderKey` decrypts, for the outgoing call. The screen is a Settings page (`/settings`) linked from the header and the Profile page, open to every signed-in user. The Anthropic SDK is used here alongside the Vercel AI SDK choice in §6 for the F1.8 import call, which F1.8 revisits | A bad key is caught when it's entered, not mid-import, and the check costs nothing; binding the ciphertext to its row stops a database edit from handing one GM's key to another; one user-level key matches D-09 (each GM pays their own usage) | Format check only; per-campaign keys; deriving the master key from a passphrase (it's already random); saving a key unchecked when Anthropic is down; showing keys on the Profile page |
| D-25 | 2026-11-11 | Search across a campaign's records looks at name, tags, public description and GM notes, not the type-specific fields. Postgres keeps a generated `records.search_vector` (the `simple` config: lower-cased, no stemming) with name and tags weighted highest, then public description, then GM notes. A search's words are runs of letters and digits; a record matches when every word starts a word somewhere in it, or when its name contains the whole text. Results rank exact name, name prefix, name substring, then text rank, and a hit found only in the text carries a short excerpt naming the field. Filters narrow the list together: type, tags (the record has every tag given), and Area (its Spots). The list route takes them as `q`, `tag`, `areaId`, `type` and `limit`, and stays GM only. A quick jump box (Ctrl or Cmd+K) finds records the same way, plus stat blocks and PCs by name, filtered in the browser. The vector holds private text, so player search (F3.5) will need a public-only one. F1.6 ships in two parts: F1.6a (API) and F1.6b (UI) | A generated column can't fall out of sync and needs no backfill or write-path code; no stemming keeps homebrew names intact, and prefix matching finds a record while its name is still being typed; the GM picked these fields, so type fields don't flood results; excerpts show why a record was found | Searching every type field; Postgres `english` stemming; a search-text column written by the app; filtering every record in the browser; trigram similarity as the main match; status filters; server-side search for stat blocks and PCs |
| D-24 | 2026-11-10 | Links between records are rows of `record_links` (campaign, from record, to record, kind, field key, label), never part of `fields`. Three kinds. `field` rows fill the §8 link fields; each field declares in `RECORD_FIELD_SPECS` which record types it accepts and whether it holds one or many, and the server enforces both: home spot → one Spot; factions, factions present, allies and enemies → Factions; NPCs usually here, leaders, members, NPCs met → NPCs; items here → Items; who knows it → NPCs or Factions; involved → NPCs, Areas, Spots or Items; current holder → one NPC, Spot or Area. `other` rows are extra links from any record to any other, with an optional relationship label typed by the GM (up to 60 characters, one per pair of records). `mention` rows mirror the @-mentions in a record's public description, GM notes and rich fields, and the server re-syncs them on every save. A record can't link to itself. PCs aren't records, so they can't be link targets; instead an inventory row can carry `recordId`, an Item of the same campaign, which the player's own sheet never receives. Backlinks are the same rows read the other way, plus the PCs carrying an Item. Mentions are allowed only in record text; sheets and stat blocks still refuse them. A mention stores the record's id and its name at the time; an id that isn't a record of this campaign (deleted, from another campaign, or made up) stays in the text, makes no row, shows as plain text, and the note still saves. Deleting a record removes every link to and from it (composite foreign keys with ON DELETE CASCADE) and clears it from PC inventories; mentions of it remain as text. PATCH sends each link field's whole id list, and the whole list of other links. When players can see records (F3.5), mentions of records they haven't been shown become plain text without the id (§7 rule 4). F1.5 ships in two parts: F1.5a (API) and F1.5b (UI) | One table holds field links, extra links, mentions and backlinks, and gives F1.8's proposed links one place to land; checking targets keeps §8's shapes meaningful; replacing whole lists fits per-field autosave; dropping unknown mention ids instead of refusing them means a delete never makes other notes unsaveable and never reveals whether an id exists elsewhere; keeping mentions out of sheets means a player's sheet can never carry a record id | Link ids inside `fields` jsonb; untyped links with only a free label; a table per link kind; refusing saves that mention unknown ids; rewriting other records' text when a record is renamed or deleted; mentions in sheets and stat blocks; one add/remove endpoint per link; checking target types and cardinality in the database (they depend on shared config, as in D-23) |
| D-23 | 2026-11-10 | Character sheets (the grown `characters` table) and stat blocks (`stat_blocks`) use hybrid storage: numbers that change in play are integer columns with database checks (never negative; current ≤ max for HP, Stress and armor slots), while traits and the repeating lists and sections are jsonb validated by shared Zod schemas. Ruleset values live in a versioned config in the shared package, picked by `campaigns.ruleset_version`; published versions are immutable, and rules that depend on them (trait ids and range, Hope max) are checked only in Zod. Answers 19.7 for Phase 1: a player can only view their own PC's sheet, built from an explicit allow-list (no GM notes), and any other PC is 404. Stat blocks hold template values only (HP and Stress max). NPC records link one through `records.stat_block_id` (composite FK, NPCs only). Deleting a PC leaves its player without one; deleting a stat block unlinks its NPCs. PATCH replaces each key it sends whole, validated inside the row lock against the stored sheet, and lowering a max below its current value is refused. Damage thresholds have no ordering rule. F1.4 ships in two parts: F1.4a (API) and F1.4b (UI) | The governance split (§8) wants real columns for live mechanical data, but the trait list must come from config; whole-key replace keeps autosave simple; allow-list responses are the only safe way to give players part of a private row; unlinking loses only a link, while refusing the delete would send the GM through every NPC first | Everything in one jsonb column; fully normalized child tables; letting players edit Hope before live play; refusing a stat block delete while NPCs use it (409); `ON DELETE SET NULL` on the composite FK (it would null `campaign_id` too); clamping current values when a max drops |
| D-22 | 2026-11-09 | Rich text (public description, GM notes and the rich record fields) is stored as TipTap/ProseMirror document JSON, validated by a shared Zod schema with a closed set of nodes (paragraph, heading 1–3, bullet and ordered list, list item, blockquote, hard break, horizontal rule, text) and marks (bold, italic, strike, code, link to http(s) or mailto); anything else is rejected. `mention` is added in F1.5. Record edits autosave field by field through a partial PATCH merged on the server, where null clears a field; last write wins (one GM, D-14). Records are hard-deleted, and deleting an Area that still has Spots is refused. The §8 link fields are `record_links` rows (F1.5), not part of `fields`. F1.3 ships in two parts: F1.3a (schemas and API) and F1.3b (editor UI) | One format for the editor, storage, search and AI-import output; a closed schema is easier to keep safe than sanitising HTML; per-field autosave loses nothing when a tab closes; refusing the delete keeps Spots from vanishing by accident | HTML strings; Markdown (no stable mapping for mentions); a single Save button; cascading or detaching Spots when an Area is deleted |
| D-21 | 2026-11-09 | Invites are reusable links with an optional expiry (never, 1 day, 7 days), revocable, several active at once. The code (128 random bits) is stored as-is so the GM can copy a link again. There is no cap on campaign membership; the 6-player limit applies when a live session starts (Phase 3). A PC is a row in `characters`: just a name in F1.2, extended into the full sheet by F1.4. The player link is `campaign_members.character_id`, which means one PC per player and one player per PC, and a composite FK keeps both in the same campaign. Removing a player or leaving keeps the PC, unassigned. Refines D-20: actions that only remove access (revoking an invite, removing a player, leaving) still work on an archived campaign | Groups share one link in Discord; rotating groups can have more than 6 members; F1.2 needs PCs to assign before sheets exist, and growing the same table avoids a data move in F1.4 | Single-use links; links with a max-use count; capping membership at 6; deferring PC assignment to F1.4 |
| D-20 | 2026-11-09 | Archiving a campaign is reversible and makes it read-only: only the GM can archive or unarchive, and every other write is refused while it is archived. No hard delete for now. The §8 "archived flag" is an `archived_at` timestamp (null = active). The GM is stored both as `campaigns.gm_user_id` and as the campaign's only `gm` row in `campaign_members`; a partial unique index enforces D-14 | Archive is a safe "put away" for finished campaigns that keeps the player journal intact; deleting a campaign with linked records, assets and sessions needs its own design | Hiding without making read-only; permanent delete in F1.1 |
| D-19 | 2026-11-08 | Backups run on stack shutdown (`pnpm stack:shutdown`) and on demand, not nightly. Each is restored into a throwaway database and checked, encrypted with a passphrase kept outside the backup, and stored on a second local disk. No off-site copy for now. Supersedes the "nightly" and "monthly restore test" parts of §14 and the off-site storage line in §16 | The home PC runs Stagehand only while it's in use, so a nightly job would rarely find it on; verifying every backup is stronger than a monthly drill | Nightly scheduled task; OneDrive or Cloudflare R2 off-site copy (deferred) |
| D-18 | 2026-11-08 | Discord sign-in requests `identify email`. Accounts without an email (phone-only) get a placeholder `<discordId>@discord.invalid`, because Better Auth requires an email | Keeps a real email when one exists, in case email features are wanted later | `identify` only with placeholder emails for everyone |
| D-17 | 2026-11-08 | Client routing: React Router in declarative mode | Boring, widely documented; the SPA needs only basic routing for now | TanStack Router |
| D-16 | 2026-11-07 | Fear: GM starts each session with 3, cap 12; Hope cap 6; criticals give the player 1 Hope | Homebrew rules as stated by the designer | — |
| D-15 | 2026-11-07 | Locations have exactly two levels: Area and Spot | Enough for play; deeper nesting adds complexity | Arbitrary nesting |
| D-14 | 2026-11-07 | One GM per campaign | Simpler permissions | Co-GM roles |
| D-13 | 2026-11-07 | Homebrew ruleset with values in config; no official Daggerheart text or layouts | Licensing safety; future customization | Copying the official sheet |
| D-12 | 2026-11-07 | Speaking detection via Discord Activity events + browser-mic fallback | Officially supported events; works without Discord too | Discord voice bot (unsupported voice receive, broken by DAVE encryption) |
| D-11 | 2026-11-07 | Image generation through OpenRouter, starting with `openai/gpt-image-2` | One key for many image models; no OpenAI ID verification | OpenAI direct (ID required), Replicate (some OpenAI models need your own OpenAI key), Google Nano Banana (quality judged lacking), FLUX Kontext alone (single model) |
| D-10 | 2026-11-07 | Text AI: Claude Sonnet 5.5, GM's own Anthropic key; one model for the MVP behind a swappable layer | Strong structured output; swappable via SDK, schemas, eval suite | Self-hosted open models per GM (needs a strong GPU), OpenAI, Gemini |
| D-09 | 2026-11-07 | Two keys per GM (Anthropic + OpenRouter); each GM pays own usage | Keeps project costs near zero | Project-paid AI |
| D-08 | 2026-11-07 | 2.5D paper theater: 3D stage, flat cutouts, procedural animation, one image per character. Refined by D-36 (tabletop stick-puppet theater) | Cheapest, most reliable path that keeps the stage feel; fits the art direction | Rigged 3D characters, pure 2D, sprite sheets |
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
| 19.6 | Can players move their own puppet on stage? | No in the MVP; the GM places, raises and lowers puppets, and players only emote their own (D-36). Revisit after the first playtest. | Phase 3 |
| 19.7 | What can players edit on their own sheet? | Answered for Phase 1 by D-23: nothing; players view their own sheet only. Later: spend Hope (F3.6) and pick combat options (F4.2); everything else edited by the GM. | Phase 1 |
| 19.8 | How is leveling up handled? | GM edits the sheet by hand; no level-up wizard in the 12-month plan | Phase 4 |
| 19.9 | Are monster HP and Stress tracked before battle scenes exist? | No; tracking arrives with battle scenes in Phase 4 | Phase 4 |
| 19.10 | Do other players see when someone is inspecting a prop? | No; the inspect stage is private to the player who opened it | Phase 3 |
| 19.11 | Can inspecting a prop show more than its public description (hidden details, a roll to notice more)? | No; it shows the public description only. The GM shares more by editing that description or by calling a roll | Phase 3 |
| 19.12 | Where do dice appear when a roll is made? | Rolled on the table in front of the theater, seen by everyone | Phase 3 |
| 19.13 | Where does the player journal live in the table view? | A notebook on the table beside the sheet page | Phase 3 |

## Sources

- [Discord Embedded App SDK reference](https://docs.discord.com/developers/developer-tools/embedded-app-sdk) — speaking events for Activities
- [Discord bots and voice receive (JDA issue citing Discord's stance)](https://github.com/discord-jda/JDA/issues/904)
- [Discord voice encryption required since March 1, 2026 (Help Net Security)](https://www.helpnetsecurity.com/2026/05/19/discord-voice-and-video-call-encryption/)
- [OpenAI API organization verification](https://help.openai.com/en/articles/10910291-api-organization-verification)
- [OpenRouter: GPT Image 2](https://openrouter.ai/openai/gpt-image-2)
- [Claude Sonnet 5.5 pricing (Anthropic, via LLM Reference)](https://www.llmreference.com/provider/anthropic-api/claude-sonnet-5-5)
- [Darrington Press Community Gaming License](https://darringtonpress.com/license)
