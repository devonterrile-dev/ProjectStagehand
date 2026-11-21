import { describe, expect, it } from 'vitest';

import { FEATURE_LIST_MAX } from './classes';
import { createSpeciesRequestSchema, updateSpeciesRequestSchema } from './species';

describe('species requests (F4.6)', () => {
  it('creates with a name only', () => {
    expect(createSpeciesRequestSchema.parse({ name: ' Faerie ' })).toEqual({ name: 'Faerie' });
    expect(createSpeciesRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createSpeciesRequestSchema.safeParse({ name: 'Elf', features: [] }).success).toBe(false);
  });

  it('keeps the features in order', () => {
    const features = [
      { name: 'Luckbender', text: 'Spend 3 Hope to reroll.' },
      { name: 'Wings', text: 'You can fly.' },
    ];
    expect(updateSpeciesRequestSchema.parse({ features })).toEqual({ features });
  });

  it('refuses an empty patch, unknown keys, unnamed features and too many', () => {
    expect(updateSpeciesRequestSchema.safeParse({}).success).toBe(false);
    expect(updateSpeciesRequestSchema.safeParse({ picture: 'x' }).success).toBe(false);
    expect(
      updateSpeciesRequestSchema.safeParse({ features: [{ name: '', text: 'x' }] }).success,
    ).toBe(false);
    const many = Array.from({ length: FEATURE_LIST_MAX + 1 }, () => ({ name: 'A', text: '' }));
    expect(updateSpeciesRequestSchema.safeParse({ features: many }).success).toBe(false);
  });
});
