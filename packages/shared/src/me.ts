import { z } from 'zod';

/** A user's Stagehand display name: trimmed, 1–32 characters. */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name cannot be empty')
  .max(32, 'Display name must be 32 characters or fewer');

/** `GET /api/me`: the signed-in user's own profile. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  /** What Stagehand shows: the custom display name, or the Discord name if none is set. */
  displayName: z.string(),
  /** True when the user has set their own display name. */
  hasCustomDisplayName: z.boolean(),
  /** Discord @username. */
  discordUsername: z.string(),
  avatarUrl: z.url().nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `PATCH /api/me`. `displayName: null` resets to the Discord name. */
export const updateMeRequestSchema = z.strictObject({
  displayName: displayNameSchema.nullable(),
});
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
