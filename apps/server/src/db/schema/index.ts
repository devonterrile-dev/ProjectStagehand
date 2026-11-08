/**
 * Drizzle schema entry point: every table is exported from here.
 *
 * Conventions (governance §8, §15):
 * - Column names are camelCase in TypeScript and snake_case in SQL (`casing: 'snake_case'`
 *   in both drizzle.config.ts and the client), so `createdAt` becomes `created_at`.
 * - Every campaign-scoped table carries `campaignId`.
 * - Change tables here, then run `pnpm db:generate` and commit the generated SQL with the code.
 *
 * No tables yet: Better Auth's tables arrive with F0.4, and campaign data with Phase 1.
 */
export {};
