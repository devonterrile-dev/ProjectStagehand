import { z } from 'zod';

import { campaignRoleSchema } from './campaigns';

/** One person in a campaign, as every member sees them. */
export const memberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.url().nullable(),
  role: campaignRoleSchema,
  /** The player's PC, or null (always null for the GM). */
  character: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  joinedAt: z.iso.datetime({ offset: true }),
});
export type Member = z.infer<typeof memberSchema>;

/** `GET /api/campaigns/:campaignId/members`: the GM first, then players by name. */
export const memberListResponseSchema = z.object({ members: z.array(memberSchema) });
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

/** `PUT /api/campaigns/:campaignId/members/:userId/character`. GM only; null unassigns. */
export const assignCharacterRequestSchema = z.strictObject({
  characterId: z.uuid().nullable(),
});
export type AssignCharacterRequest = z.infer<typeof assignCharacterRequestSchema>;
