import { describe, expect, it } from 'vitest';

import {
  EMOTE_LABELS,
  emotePlayedSchema,
  emoteRequestSchema,
  EMOTES,
  speakingRequestSchema,
} from './motion';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('emotes', () => {
  it('has the ten presets of §12, each with a label', () => {
    expect(EMOTES).toHaveLength(10);
    for (const emote of EMOTES) expect(EMOTE_LABELS[emote].length).toBeGreaterThan(0);
  });

  it('asks for a known emote on one object, and nothing else', () => {
    expect(emoteRequestSchema.safeParse({ id: id(1), emote: 'wave' }).success).toBe(true);
    expect(emoteRequestSchema.safeParse({ id: id(1), emote: 'dance' }).success).toBe(false);
    expect(emoteRequestSchema.safeParse({ id: 'x', emote: 'wave' }).success).toBe(false);
    expect(emoteRequestSchema.safeParse({ id: id(1), emote: 'wave', loud: true }).success).toBe(
      false,
    );
  });

  it('tells everyone which emote plays on which object, with an id of its own', () => {
    expect(emotePlayedSchema.parse({ id: id(2), objectId: id(1), emote: 'bow' })).toEqual({
      id: id(2),
      objectId: id(1),
      emote: 'bow',
    });
    expect(emotePlayedSchema.safeParse({ objectId: id(1), emote: 'bow' }).success).toBe(false);
  });
});

describe('speaking', () => {
  it('is a plain true or false', () => {
    expect(speakingRequestSchema.parse({ speaking: true })).toEqual({ speaking: true });
    expect(speakingRequestSchema.safeParse({ speaking: 'yes' }).success).toBe(false);
    expect(speakingRequestSchema.safeParse({ speaking: true, level: 0.4 }).success).toBe(false);
  });
});
