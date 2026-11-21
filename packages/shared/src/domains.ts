/**
 * Domains and domain cards (F4.3, governance §8 "Domains and domain cards", D-61): the first
 * gameplay records of their own. Every member of the campaign reads them; only the GM creates,
 * edits or deletes them. They are never revealed, never take notes, and the AI never sees them.
 *
 * Every campaign starts with the ten default domains, unless the GM copies another campaign's
 * gameplay records when creating it (19.14).
 */
import { z } from 'zod';

import { richTextSchema } from './rich-text';

const timestamp = z.iso.datetime({ offset: true });

/** Longest domain name. The database enforces it too. */
export const DOMAIN_NAME_MAX = 60;
/** Longest domain description. */
export const DOMAIN_DESCRIPTION_MAX = 2000;
/** Longest domain card name. The database enforces it too. */
export const DOMAIN_CARD_NAME_MAX = 120;
/** A card's level runs from 1 to ruleset v2's highest level (§9). */
export const DOMAIN_CARD_LEVEL_MAX = 10;
/** Highest recall cost: the Stress marked to bring a card from the vault. */
export const RECALL_COST_MAX = 99;

/** A card's kind: an ability, a spell or a grimoire. */
export const DOMAIN_CARD_TYPES = ['ability', 'spell', 'grimoire'] as const;
export const domainCardTypeSchema = z.enum(DOMAIN_CARD_TYPES);
export type DomainCardType = z.infer<typeof domainCardTypeSchema>;

/**
 * The ten domains every fresh campaign starts with, in this order. Names and descriptions from
 * the Daggerheart SRD 2.0, used under the Darrington Press Community Gaming License (19.26).
 * Migration 0022 seeded the same text into the campaigns that existed then.
 */
export const DEFAULT_DOMAINS: readonly { readonly name: string; readonly description: string }[] =
  Object.freeze([
    {
      name: 'Arcana',
      description:
        'Arcana is the domain of innate and instinctual magic. Those who choose this path tap into the raw, enigmatic forces of the realms to manipulate both their own energy and the elements. Arcana offers wielders a volatile power, but it is incredibly potent when correctly channeled. The Arcana domain can be accessed by the Druid and Sorcerer classes.',
    },
    {
      name: 'Blade',
      description:
        'Blade is the domain of weapon mastery. Whether by steel, bow, or perhaps a more specialized arm, those who follow this path have the skill to cut short the lives of others. Wielders of Blade dedicate themselves to achieving inexorable power over death. The Blade domain can be accessed by the Guardian and Warrior classes.',
    },
    {
      name: 'Bone',
      description:
        'Bone is the domain of tactics and the body. Practitioners of this domain have an uncanny control over their own physical abilities and an eye for predicting the behaviors of others in combat. Adherents to Bone gain an unparalleled understanding of bodies and their movements. The Bone domain can be accessed by the Ranger & Warrior classes.',
    },
    {
      name: 'Codex',
      description:
        'Codex is the domain of intensive magical study. Those who seek magical knowledge turn to the equations of power recorded in books, written on scrolls, etched into walls, or tattooed on bodies. Codex offers a commanding and versatile understanding of magic to devotees who pursue knowledge beyond the boundaries of common wisdom. The Codex domain can be accessed by the Bard and Wizard classes.',
    },
    {
      name: 'Grace',
      description:
        'Grace is the domain of charisma. Through rapturous storytelling, charming spells, or a shroud of lies, those who channel this power define the realities of their adversaries, bending perception to their will. Grace offers its wielders raw magnetism and mastery over language. The Grace domain can be accessed by the Bard and Rogue classes.',
    },
    {
      name: 'Midnight',
      description:
        'Midnight is the domain of shadows and secrecy. Whether by clever tricks, deft magic, or the cloak of night, those who channel these forces practice the art of obscurity and can uncover sequestered treasures. Midnight offers practitioners the power to control and create enigmas. The Midnight domain can be accessed by the Rogue and Sorcerer classes.',
    },
    {
      name: 'Sage',
      description:
        'Sage is the domain of the natural world. Those who walk this path tap into the unfettered power of the earth and its creatures to unleash raw magic. Sage grants its adherents the vitality of a blooming flower and the ferocity of a ravenous predator. The Sage domain can be accessed by the Druid and Ranger classes.',
    },
    {
      name: 'Splendor',
      description:
        'Splendor is the domain of life. Through this magic, followers gain the ability to heal and, to an extent, control death. Splendor offers its disciples the magnificent ability to both give and end life. The Splendor domain can be accessed by the Seraph and Wizard classes.',
    },
    {
      name: 'Valor',
      description:
        'Valor is the domain of protection. Whether through attack or defense, those who choose this discipline channel formidable strength to protect their allies in battle. Valor offers great power to those who raise their shields in defense of others. The Valor domain can be accessed by the Guardian and Seraph classes.',
    },
    {
      name: 'Dread',
      description:
        'Dread is the domain of nightmares and fear. Those who choose this path can call forth monstrosities, enfeeble their foes, and channel terrifying magic to destroy their enemies. Dread grants its adherents power over forces most are too afraid to employ. The Dread domain can be accessed by the Warlock and Witch classes.',
    },
  ]);

export const domainNameSchema = z
  .string()
  .trim()
  .min(1, 'Domain name cannot be empty')
  .max(DOMAIN_NAME_MAX, `Domain name must be ${String(DOMAIN_NAME_MAX)} characters or fewer`);

/** Plain text; line breaks are kept. */
export const domainDescriptionSchema = z
  .string()
  .trim()
  .max(
    DOMAIN_DESCRIPTION_MAX,
    `The description must be ${String(DOMAIN_DESCRIPTION_MAX)} characters or fewer`,
  );

export const domainCardNameSchema = z
  .string()
  .trim()
  .min(1, 'Card name cannot be empty')
  .max(
    DOMAIN_CARD_NAME_MAX,
    `Card name must be ${String(DOMAIN_CARD_NAME_MAX)} characters or fewer`,
  );

export const domainCardLevelSchema = z
  .int('Must be a whole number')
  .min(1, 'Level must be 1 or more')
  .max(DOMAIN_CARD_LEVEL_MAX, `Level must be ${String(DOMAIN_CARD_LEVEL_MAX)} or less`);

export const recallCostSchema = z
  .int('Must be a whole number')
  .min(0, 'Must be 0 or more')
  .max(RECALL_COST_MAX, `Must be ${String(RECALL_COST_MAX)} or less`);

/** A domain card in a list: everything but its feature. */
export const domainCardSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  domainId: z.uuid(),
  domainName: z.string(),
  level: z.int(),
  recallCost: z.int(),
  type: domainCardTypeSchema,
  updatedAt: timestamp,
});
export type DomainCardSummary = z.infer<typeof domainCardSummarySchema>;

/** A whole domain card. */
export const domainCardSchema = domainCardSummarySchema.extend({
  /** The bulk of the card: what it does, read by the table, not run by the app (§8). */
  feature: richTextSchema,
  createdAt: timestamp,
});
export type DomainCard = z.infer<typeof domainCardSchema>;

/** A domain in a list. */
export const domainSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  /** How many cards belong to it. */
  cardCount: z.int().nonnegative(),
  updatedAt: timestamp,
});
export type DomainSummary = z.infer<typeof domainSummarySchema>;

/** A domain with its cards, by level and then name. */
export const domainSchema = domainSummarySchema.extend({
  cards: z.array(domainCardSummarySchema),
  createdAt: timestamp,
});
export type Domain = z.infer<typeof domainSchema>;

/** `GET /api/campaigns/:campaignId/domains`: any member. Sorted by name. */
export const domainListResponseSchema = z.object({ domains: z.array(domainSummarySchema) });
export type DomainListResponse = z.infer<typeof domainListResponseSchema>;

/** `POST /api/campaigns/:campaignId/domains`: the GM; refused while archived. */
export const createDomainRequestSchema = z.strictObject({
  name: domainNameSchema,
  description: domainDescriptionSchema.optional(),
});
export type CreateDomainRequest = z.infer<typeof createDomainRequestSchema>;

/** `PATCH /api/campaigns/:campaignId/domains/:domainId`: the GM; refused while archived. */
export const updateDomainRequestSchema = z
  .strictObject({
    name: domainNameSchema.optional(),
    description: domainDescriptionSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateDomainRequest = z.infer<typeof updateDomainRequestSchema>;

/** `GET /api/campaigns/:campaignId/domain-cards`: any member. By domain, level, then name. */
export const domainCardListResponseSchema = z.object({
  cards: z.array(domainCardSummarySchema),
});
export type DomainCardListResponse = z.infer<typeof domainCardListResponseSchema>;

/** `POST /api/campaigns/:campaignId/domain-cards`: the GM; refused while archived. */
export const createDomainCardRequestSchema = z.strictObject({
  domainId: z.uuid(),
  name: domainCardNameSchema,
  level: domainCardLevelSchema.optional(),
  recallCost: recallCostSchema.optional(),
  type: domainCardTypeSchema.optional(),
});
export type CreateDomainCardRequest = z.infer<typeof createDomainCardRequestSchema>;

/**
 * `PATCH /api/campaigns/:campaignId/domain-cards/:cardId`: the GM; refused while archived. Any
 * subset of the keys; each replaces its whole value.
 */
export const updateDomainCardRequestSchema = z
  .strictObject({
    domainId: z.uuid().optional(),
    name: domainCardNameSchema.optional(),
    level: domainCardLevelSchema.optional(),
    recallCost: recallCostSchema.optional(),
    type: domainCardTypeSchema.optional(),
    feature: richTextSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
export type UpdateDomainCardRequest = z.infer<typeof updateDomainCardRequestSchema>;
