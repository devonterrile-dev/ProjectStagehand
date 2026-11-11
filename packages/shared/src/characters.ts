import { z } from 'zod';

/** A PC's name: trimmed, 1–80 characters. The database enforces the same limit. */
export const characterNameSchema = z
  .string()
  .trim()
  .min(1, 'Character name cannot be empty')
  .max(80, 'Character name must be 80 characters or fewer');

/** A player character in a list. The full sheet is `CharacterSheet` (F1.4). */
export const characterSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The player who has this PC, or null if unassigned. */
  assignedToUserId: z.uuid().nullable(),
});
export type Character = z.infer<typeof characterSchema>;

/** `GET /api/campaigns/:campaignId/characters`. GM only. */
export const characterListResponseSchema = z.object({ characters: z.array(characterSchema) });
export type CharacterListResponse = z.infer<typeof characterListResponseSchema>;

/** `POST /api/campaigns/:campaignId/characters`. GM only; optionally assigns it straight away. */
export const createCharacterRequestSchema = z.strictObject({
  name: characterNameSchema,
  assignToUserId: z.uuid().optional(),
});
export type CreateCharacterRequest = z.infer<typeof createCharacterRequestSchema>;
