/**
 * Puppet motion in a live session (F3.7, governance §12 "Puppet motion" and §13, D-55).
 *
 * Emotes are presets played once on a raised puppet, for everyone: a player on their own PC's
 * puppet, the GM on any. They are sent once and never stored or logged; a browser that joins
 * later doesn't see them. Talking follows who is speaking, which each person's browser tells
 * the server as a plain true or false (never any sound) and the server passes on with presence.
 */
import { z } from 'zod';

/** The preset emotes (§12), in the order the menu and the desk list them. */
export const EMOTES = [
  'look-around',
  'hop',
  'nod',
  'shake',
  'shiver',
  'lean-in',
  'bow',
  'spin',
  'droop',
  'wave',
] as const;

export const emoteSchema = z.enum(EMOTES);
export type Emote = z.infer<typeof emoteSchema>;

/** What each emote is called in the menu and on the desk. */
export const EMOTE_LABELS: Record<Emote, string> = {
  'look-around': 'Look around',
  hop: 'Hop',
  nod: 'Nod',
  shake: 'Shake',
  shiver: 'Shiver',
  'lean-in': 'Lean in',
  bow: 'Bow',
  spin: 'Spin',
  droop: 'Droop',
  wave: 'Wave',
};

/** Plays an emote on a raised puppet, by the live object's id. */
export const emoteRequestSchema = z.strictObject({ id: z.uuid(), emote: emoteSchema });
export type EmoteRequest = z.infer<typeof emoteRequestSchema>;

/**
 * Sent to everyone in the session when an emote plays. `id` is new for every play, so the same
 * emote twice in a row plays twice.
 */
export const emotePlayedSchema = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  emote: emoteSchema,
});
export type EmotePlayed = z.infer<typeof emotePlayedSchema>;

/** Whether the sender is talking right now. Sent only when it changes; never answered. */
export const speakingRequestSchema = z.strictObject({ speaking: z.boolean() });
export type SpeakingRequest = z.infer<typeof speakingRequestSchema>;
