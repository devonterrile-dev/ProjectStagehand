import { z } from 'zod';

/** Longest campaign name allowed. The database enforces the same limit. */
export const CAMPAIGN_NAME_MAX = 80;

/** A campaign's name: trimmed, 1–80 characters. */
export const campaignNameSchema = z
  .string()
  .trim()
  .min(1, 'Campaign name cannot be empty')
  .max(CAMPAIGN_NAME_MAX, `Campaign name must be ${String(CAMPAIGN_NAME_MAX)} characters or fewer`);

/** The caller's role in a campaign. Exactly one GM per campaign (D-14). */
export const campaignRoleSchema = z.enum(['gm', 'player']);
export type CampaignRole = z.infer<typeof campaignRoleSchema>;

/** A campaign as the signed-in user sees it, including their own role in it. */
export const campaignSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: campaignRoleSchema,
  /** The campaign's ruleset (`rulesetFor`): trait list, Hope max, Fear cap (§9). */
  rulesetVersion: z.int().min(1),
  /** When the campaign was archived (ISO timestamp), or null if active. Archived = read-only (D-20). */
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Campaign = z.infer<typeof campaignSchema>;

/** `GET /api/campaigns`: every campaign the user belongs to, active and archived. */
export const campaignListResponseSchema = z.object({
  campaigns: z.array(campaignSchema),
});
export type CampaignListResponse = z.infer<typeof campaignListResponseSchema>;

/** `POST /api/campaigns`. The caller becomes the campaign's GM. */
export const createCampaignRequestSchema = z.strictObject({
  name: campaignNameSchema,
});
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

/** `PATCH /api/campaigns/:campaignId`. GM only; refused while archived. */
export const renameCampaignRequestSchema = z.strictObject({
  name: campaignNameSchema,
});
export type RenameCampaignRequest = z.infer<typeof renameCampaignRequestSchema>;
