import { describe, expect, it } from 'vitest';

import { createCharacterRequestSchema } from './characters';

describe('createCharacterRequestSchema', () => {
  it('trims the name and allows an optional player to assign to', () => {
    expect(createCharacterRequestSchema.parse({ name: '  Vex  ' })).toEqual({ name: 'Vex' });
    const userId = '0b7e2f1c-3c1d-4b8a-9a50-6f2a0e1d9c11';
    expect(createCharacterRequestSchema.parse({ name: 'Vex', assignToUserId: userId })).toEqual({
      name: 'Vex',
      assignToUserId: userId,
    });
  });

  it('rejects empty and too-long names, bad ids and unknown fields', () => {
    expect(createCharacterRequestSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createCharacterRequestSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
    expect(createCharacterRequestSchema.safeParse({ name: 'V', assignToUserId: 'x' }).success).toBe(
      false,
    );
    expect(createCharacterRequestSchema.safeParse({ name: 'V', level: 3 }).success).toBe(false);
  });
});
