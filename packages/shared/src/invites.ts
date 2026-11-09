import { z } from 'zod';

/** An invite code: 16 random bytes, base64url (22 characters). */
export const inviteCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Invalid invite code');

/** How long a new invite link stays valid (D-21). */
export const inviteExpirySchema = z.enum(['never', '1d', '7d']);
export type InviteExpiry = z.infer<typeof inviteExpirySchema>;

/** `POST /api/campaigns/:campaignId/invites`. GM only. */
export const createInviteRequestSchema = z.strictObject({
  expiresIn: inviteExpirySchema,
});
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

/** An active invite link, as the GM sees it. The link is `<origin>/join/<code>`. */
export const inviteSchema = z.object({
  id: z.uuid(),
  code: inviteCodeSchema,
  /** ISO timestamp, or null if it never expires. */
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Invite = z.infer<typeof inviteSchema>;

/** `GET /api/campaigns/:campaignId/invites`: active (not revoked, not expired) links. */
export const inviteListResponseSchema = z.object({ invites: z.array(inviteSchema) });
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;

/** `GET /api/invites/:code`: what the invited person sees before joining. */
export const invitePreviewSchema = z.object({
  campaignId: z.uuid(),
  campaignName: z.string(),
  gmDisplayName: z.string(),
  /** True when the signed-in user is already in the campaign (as GM or player). */
  alreadyMember: z.boolean(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/** `POST /api/invites/:code/accept`. */
export const acceptInviteResponseSchema = z.object({ campaignId: z.uuid() });
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;
