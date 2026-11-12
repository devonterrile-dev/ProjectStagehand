/**
 * Drizzle schema entry point: every table is exported from here.
 *
 * Conventions (governance §8, §15):
 * - Column names are camelCase in TypeScript and snake_case in SQL (`casing: 'snake_case'`
 *   in both drizzle.config.ts and the client), so `createdAt` becomes `created_at`.
 * - Timestamps are `timestamp(..., { withTimezone: true })` (timestamptz).
 * - Every campaign-scoped table carries `campaignId`.
 * - Change tables here, then run `pnpm db:generate` and commit the generated SQL with the code.
 */
export * from './ai-imports';
export * from './auth';
export * from './campaigns';
export * from './invites';
export * from './provider-credentials';
export * from './record-links';
export * from './records';
export * from './stat-blocks';
