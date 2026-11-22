/**
 * Leveling up (F4.9, governance §9 "Leveling up", D-68). Pure: the server checks and applies a
 * level-up with these, and the guide shows the same state as the player picks.
 *
 * Each level-up takes the ruleset's number of picks (two) from the option lists of the next
 * level's tier or lower, each list's options within their counts; lower tiers' unused options
 * stay open (19.22). A two-mark option needs two marks in the same tier and applies on the
 * second: both picks of one level-up, or one pick at each of two level-ups; a half-marked one is
 * lost when the PC leaves that tier. Traits
 * raised are marked until the PC enters a new tier. Entering a tier raises proficiency.
 */
import { z } from 'zod';

import type { DomainCardSummary } from './domains';
import { tierOf } from './rules';
import {
  LEVEL_UP_OPTION_IDS,
  type LevelUpOptionId,
  type LevelUpOptionRule,
  type Ruleset,
} from './ruleset';

export const levelUpOptionIdSchema = z.enum(LEVEL_UP_OPTION_IDS);

/** One pick: an option from a tier's list; `traits` names the two traits it raises. */
export const levelUpPickSchema = z.strictObject({
  tier: z.int(),
  option: levelUpOptionIdSchema,
  traits: z.tuple([z.string(), z.string()]).optional(),
});
export type LevelUpPick = z.infer<typeof levelUpPickSchema>;

/** `POST …/characters/:characterId/level-up`: the guide's picks, sent once on Finish. */
export const levelUpRequestSchema = z.strictObject({
  picks: z.array(levelUpPickSchema).max(4),
  /** The new domain card every level-up brings. */
  cardId: z.uuid('Pick a new domain card'),
  /** The extra card the `domainCard` option brings; null without it. */
  extraCardId: z.uuid().nullable(),
  /** A held card swapped for another of equal or lower level; null for none. */
  swap: z.strictObject({ outId: z.uuid(), inId: z.uuid() }).nullable(),
});
export type LevelUpRequest = z.infer<typeof levelUpRequestSchema>;

/** One level-up the PC has taken: the level it reached and the picks. */
export const levelUpEntrySchema = z.object({
  level: z.int(),
  picks: z.array(levelUpPickSchema),
});
export type LevelUpEntry = z.infer<typeof levelUpEntrySchema>;

/** `POST …/grant-level` (GM): grant the next level, or withdraw a grant. */
export const grantLevelRequestSchema = z.strictObject({ granted: z.boolean() });
export type GrantLevelRequest = z.infer<typeof grantLevelRequestSchema>;

/** What a sheet carries about levelling up: a grant waiting, and the level-ups taken. */
export const sheetLevelUpSchema = z.object({
  granted: z.boolean(),
  history: z.array(levelUpEntrySchema),
});
export type SheetLevelUp = z.infer<typeof sheetLevelUpSchema>;

export const LEVEL_UP_MESSAGES = {
  noGrant: 'The GM hasn’t granted a level yet',
  alreadyGranted: 'A level is already granted: the player levels up first',
  maxLevel: 'This character is at the highest level',
  needsClass: 'Link a class first, or send the character through the creation guide',
  noLevelUp: 'There is no level-up to undo',
} as const;

/** An option as the guide shows it in one tier's list. */
export interface LevelUpListOption {
  readonly id: LevelUpOptionId;
  readonly label: string;
  readonly marks: 1 | 2;
  readonly pickable: boolean;
  /** Marks the list offers in all: count × marks. */
  readonly total: number;
  /** Marks already made. */
  readonly used: number;
  /** Marks that can still be made at the next level-up. */
  readonly left: number;
  /** A two-mark option with one mark made in the next level's tier: the next mark completes it. */
  readonly halfMarked: boolean;
  /** A two-mark option's half mark made in an earlier tier: it can't be completed any more. */
  readonly lost: boolean;
}

export interface LevelUpState {
  readonly level: number;
  readonly nextLevel: number;
  readonly tier: number;
  readonly nextTier: number;
  /** The next level starts a new tier: proficiency rises and trait marks clear. */
  readonly entersTier: boolean;
  /** The lists the next level-up picks from: tier 2 up to the next level's tier. */
  readonly lists: readonly { tier: number; options: readonly LevelUpListOption[] }[];
  /** Traits marked in the next level's tier, which can't be raised again in it. */
  readonly markedTraits: readonly string[];
  /** Two-mark options half-marked in the current tier that entering a new tier would lose. */
  readonly losing: readonly { tier: number; option: LevelUpOptionId }[];
}

const tierAt = (level: number, ruleset: Ruleset) => tierOf(level, ruleset) ?? 0;

/** The level-up state of a PC at `level`, from the level-ups it has taken. */
export function levelUpState(
  history: readonly LevelUpEntry[],
  level: number,
  ruleset: Ruleset,
): LevelUpState {
  const nextLevel = level + 1;
  const tier = tierAt(level, ruleset);
  const nextTier = tierAt(nextLevel, ruleset);
  const entersTier = nextTier !== tier;
  const losing: { tier: number; option: LevelUpOptionId }[] = [];
  const marks = history.flatMap((entry) =>
    entry.picks.map((pick) => ({ ...pick, at: tierAt(entry.level, ruleset) })),
  );
  const markedTraits = marks
    .filter((mark) => mark.option === 'traits' && mark.at === nextTier)
    .flatMap((mark) => mark.traits ?? []);

  const listOption = (listTier: number, rule: LevelUpOptionRule): LevelUpListOption => {
    const made = marks.filter((mark) => mark.tier === listTier && mark.option === rule.id);
    const total = rule.count * rule.marks;
    const odd = rule.marks === 2 && made.length % 2 === 1;
    const lastAt = made.at(-1)?.at;
    const halfMarked = odd && lastAt === nextTier;
    const lost = odd && lastAt !== nextTier;
    // A half mark made in the tier being left now: the guide warns that it will be lost.
    if (odd && entersTier && lastAt === tier) losing.push({ tier: listTier, option: rule.id });
    return {
      id: rule.id,
      label: rule.label,
      marks: rule.marks,
      pickable: rule.pickable,
      total,
      used: made.length,
      left: Math.max(0, total - made.length - (lost ? 1 : 0)),
      halfMarked,
      lost,
    };
  };

  const lists = (ruleset.tiers ?? [])
    .filter((entry) => entry.tier >= 2 && entry.tier <= nextTier)
    .map((entry) => ({
      tier: entry.tier,
      options: (ruleset.levelUpOptions ?? [])
        .filter((rule) => rule.tiers.includes(entry.tier))
        .map((rule) => listOption(entry.tier, rule)),
    }));
  return {
    level,
    nextLevel,
    tier,
    nextTier,
    entersTier,
    lists,
    // Marks belong to a tier: entering a new one starts with none.
    markedTraits,
    losing,
  };
}

/** What a level-up is checked against besides its picks. */
export interface LevelUpContext {
  readonly traits: Readonly<Record<string, number>>;
  /** The linked subclass's cards held (0 to 3); null without a linked subclass. */
  readonly subclassCards: number | null;
  /** The linked class's domains. */
  readonly domainIds: readonly (string | null)[];
  /** Every card of the campaign. */
  readonly cards: readonly Pick<DomainCardSummary, 'id' | 'name' | 'domainId' | 'level'>[];
  /** The cards the PC holds. */
  readonly heldIds: readonly string[];
}

const SUBCLASS_CARDS_MAX = 3;

/** What's wrong with a level-up, or null when it can be taken. */
export function levelUpProblem(
  request: LevelUpRequest,
  state: LevelUpState,
  context: LevelUpContext,
  ruleset: Ruleset,
): string | null {
  const count = ruleset.levelUpPicks ?? 2;
  if (request.picks.length !== count) return `Pick ${String(count)} options`;

  const marked = new Set(state.markedTraits);
  const taken = new Map<string, number>();
  let subclass = context.subclassCards;
  for (const pick of request.picks) {
    const list = state.lists.find((entry) => entry.tier === pick.tier);
    const option = list?.options.find((one) => one.id === pick.option);
    if (option === undefined) return `That option isn't in a list you can pick from`;
    if (!option.pickable) return `${option.label} can't be picked yet`;
    const key = `${String(pick.tier)}:${pick.option}`;
    const times = (taken.get(key) ?? 0) + 1;
    taken.set(key, times);
    if (times > option.left) return `Tier ${String(pick.tier)} has no more of: ${option.label}`;

    if (pick.option === 'traits') {
      const [first, second] = pick.traits ?? ['', ''];
      if (first === second) return 'Pick two different traits';
      for (const trait of [first, second]) {
        const value = context.traits[trait];
        if (value === undefined) return 'Pick two of your traits';
        if (marked.has(trait)) return 'That trait is already marked this tier';
        if (value + 1 > ruleset.traitModifier.max) {
          return `Traits go up to +${String(ruleset.traitModifier.max)}`;
        }
        marked.add(trait);
      }
    } else if (pick.traits !== undefined) {
      return 'Only the trait option names traits';
    }
    if (pick.option === 'subclass') {
      if (subclass === null) return 'Link a subclass first';
      if (subclass >= SUBCLASS_CARDS_MAX) return 'Your subclass is already at mastery';
      subclass += 1;
    }
  }

  const extra = request.picks.some((pick) => pick.option === 'domainCard');
  if (extra !== (request.extraCardId !== null)) {
    return extra ? 'Pick your extra domain card' : 'Only the extra card option gives a second card';
  }
  const held = new Set(context.heldIds);
  const card = (cardId: string) => context.cards.find((one) => one.id === cardId);
  const newCard = (cardId: string, maxLevel: number): string | null => {
    const found = card(cardId);
    if (found === undefined) return 'That card isn’t in this campaign';
    if (held.has(cardId)) return `${found.name} is already on your sheet`;
    if (!context.domainIds.includes(found.domainId)) {
      return `${found.name} isn't from your class's domains`;
    }
    if (found.level > maxLevel) {
      return `${found.name} is level ${String(found.level)}: pick level ${String(maxLevel)} or lower`;
    }
    return null;
  };
  const first = newCard(request.cardId, state.nextLevel);
  if (first !== null) return first;
  if (request.extraCardId !== null) {
    if (request.extraCardId === request.cardId) return 'Pick two different new cards';
    const second = newCard(request.extraCardId, state.nextLevel);
    if (second !== null) return second;
  }
  if (request.swap !== null) {
    const out = card(request.swap.outId);
    if (out === undefined || !held.has(request.swap.outId)) return 'Swap out a card you hold';
    if (request.swap.inId === request.cardId || request.swap.inId === request.extraCardId) {
      return 'Swap in a card you aren’t already taking';
    }
    const swapped = newCard(request.swap.inId, out.level);
    if (swapped !== null) return swapped;
  }
  return null;
}

/** The sheet values a level-up changes. */
export interface LevelUpColumns {
  level: number;
  traits: Record<string, number>;
  hpMax: number;
  hpCurrent: number;
  stressMax: number;
  hopeBonus: number;
  evasion: number;
  proficiency: number;
  subclassCards: number;
  minorThreshold: number;
  majorThreshold: number;
  severeThreshold: number;
}

/**
 * The sheet after a level-up that `levelUpProblem` passed. `typedThresholds` is true when the
 * sheet shows its typed thresholds (no linked armor, and not unarmored): those rise by one with
 * the level, as linked armor's and an unarmored sheet's already do.
 */
export function levelUpEffects(
  request: LevelUpRequest,
  state: LevelUpState,
  before: LevelUpColumns,
  typedThresholds: boolean,
  ruleset: Ruleset,
): LevelUpColumns {
  const after: LevelUpColumns = { ...before, traits: { ...before.traits }, level: state.nextLevel };
  // Marks made so far of each two-mark option, counting a half mark from an earlier level-up.
  const marks = new Map<string, number>();
  for (const pick of request.picks) {
    switch (pick.option) {
      case 'traits':
        for (const trait of pick.traits ?? []) after.traits[trait] = (after.traits[trait] ?? 0) + 1;
        break;
      case 'hp':
        after.hpMax += 1;
        after.hpCurrent += 1;
        break;
      case 'stress':
        after.stressMax += 1;
        break;
      case 'hopeBonus':
        after.hopeBonus += 1;
        break;
      case 'evasion':
        after.evasion += 1;
        break;
      case 'subclass':
        after.subclassCards += 1;
        break;
      case 'proficiency': {
        // Every second mark completes it: a half mark from before, or the other pick now.
        const key = String(pick.tier);
        const option = state.lists
          .find((list) => list.tier === pick.tier)
          ?.options.find((one) => one.id === 'proficiency');
        const made = (marks.get(key) ?? (option?.halfMarked === true ? 1 : 0)) + 1;
        marks.set(key, made);
        if (made % 2 === 0) after.proficiency += 1;
        break;
      }
      case 'domainCard':
      case 'multiclass':
        break;
    }
  }
  if (state.entersTier) after.proficiency += ruleset.proficiency?.perTier ?? 0;
  if (typedThresholds) {
    after.minorThreshold += 1;
    after.majorThreshold += 1;
    after.severeThreshold += 1;
  }
  return after;
}
