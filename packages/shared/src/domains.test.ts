import { describe, expect, it } from 'vitest';

import {
  createDomainCardRequestSchema,
  createDomainRequestSchema,
  DEFAULT_DOMAINS,
  updateDomainCardRequestSchema,
  updateDomainRequestSchema,
} from './domains';
import { emptyRichText } from './rich-text';

const DOMAIN = '5d1a0c7e-2b3f-4e8a-9c61-0f4b2d7e8a19';

describe('the default domains (F4.3)', () => {
  it('are the ten, in order, each described', () => {
    expect(DEFAULT_DOMAINS.map((domain) => domain.name)).toEqual([
      'Arcana',
      'Blade',
      'Bone',
      'Codex',
      'Grace',
      'Midnight',
      'Sage',
      'Splendor',
      'Valor',
      'Dread',
    ]);
    for (const domain of DEFAULT_DOMAINS) {
      expect(domain.description.startsWith(`${domain.name} is the domain of`)).toBe(true);
      expect(createDomainRequestSchema.safeParse(domain).success, domain.name).toBe(true);
    }
  });
});

describe('domain requests', () => {
  it('trims names and refuses empty or long ones', () => {
    expect(createDomainRequestSchema.parse({ name: ' Tide ' })).toEqual({ name: 'Tide' });
    expect(createDomainRequestSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createDomainRequestSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('keeps line breaks in a description, up to 2000 characters', () => {
    expect(updateDomainRequestSchema.parse({ description: 'One.\nTwo.' })).toEqual({
      description: 'One.\nTwo.',
    });
    expect(updateDomainRequestSchema.safeParse({ description: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(updateDomainRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('domain card requests', () => {
  it('takes a domain and a name, and optionally the level, recall cost and type', () => {
    expect(
      createDomainCardRequestSchema.parse({
        domainId: DOMAIN,
        name: 'Ward',
        level: 10,
        recallCost: 0,
        type: 'grimoire',
      }),
    ).toMatchObject({ level: 10, recallCost: 0, type: 'grimoire' });
  });

  it('keeps the level at 1 to 10 and the recall cost at 0 or more, whole', () => {
    const card = (extra: object) => updateDomainCardRequestSchema.safeParse({ ...extra }).success;
    expect(card({ level: 0 })).toBe(false);
    expect(card({ level: 11 })).toBe(false);
    expect(card({ level: 1.5 })).toBe(false);
    expect(card({ recallCost: -1 })).toBe(false);
    expect(card({ recallCost: 100 })).toBe(false);
    expect(card({ type: 'trick' })).toBe(false);
    expect(card({ feature: emptyRichText() })).toBe(true);
    expect(card({})).toBe(false);
  });
});
