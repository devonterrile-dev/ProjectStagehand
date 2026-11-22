import { describe, expect, it } from 'vitest';

import {
  completesMulticlass,
  levelUpEffects,
  levelUpProblem,
  levelUpRequestSchema,
  levelUpState,
  type LevelUpColumns,
  type LevelUpContext,
  type LevelUpEntry,
  type LevelUpPick,
  type LevelUpRequest,
} from './level-ups';
import { rulesetFor, type LevelUpOptionId, type Ruleset } from './ruleset';

const v1 = rulesetFor(1);
const v2 = rulesetFor(2);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GRACE = id(1);
const CODEX = id(2);
const BLADE = id(3);
const NEW_GRACE_1 = id(11);
const GRACE_2 = id(12);
const CODEX_3 = id(13);
const BLADE_1 = id(14);
const GRACE_5 = id(15);
const HELD_GRACE_2 = id(16);

const pick = (tier: number, option: LevelUpOptionId, traits?: [string, string]): LevelUpPick =>
  traits === undefined ? { tier, option } : { tier, option, traits };
const entry = (level: number, ...picks: LevelUpPick[]): LevelUpEntry => ({ level, picks });

const TRAITS = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 };
const context = (over: Partial<LevelUpContext> = {}): LevelUpContext => ({
  traits: TRAITS,
  subclassCards: 1,
  domainIds: [GRACE, CODEX],
  cards: [
    { id: NEW_GRACE_1, name: 'Inspire', domainId: GRACE, level: 1 },
    { id: GRACE_2, name: 'Rally', domainId: GRACE, level: 2 },
    { id: CODEX_3, name: 'Tome', domainId: CODEX, level: 3 },
    { id: BLADE_1, name: 'Whirlwind', domainId: BLADE, level: 1 },
    { id: GRACE_5, name: 'Anthem', domainId: GRACE, level: 5 },
    { id: HELD_GRACE_2, name: 'Held', domainId: GRACE, level: 2 },
  ],
  heldIds: [HELD_GRACE_2],
  ...over,
});
const request = (over: Partial<LevelUpRequest> = {}): LevelUpRequest => ({
  picks: [pick(2, 'hp'), pick(2, 'evasion')],
  cardId: NEW_GRACE_1,
  extraCardId: null,
  swap: null,
  ...over,
});
const option = (state: ReturnType<typeof levelUpState>, tier: number, optionId: LevelUpOptionId) =>
  state.lists.find((list) => list.tier === tier)?.options.find((one) => one.id === optionId);

describe('levelUpState', () => {
  it('opens tier 2 at level 1, entering a new tier', () => {
    const state = levelUpState([], 1, v2);
    expect(state).toMatchObject({ level: 1, nextLevel: 2, tier: 1, nextTier: 2, entersTier: true });
    expect(state.lists.map((list) => list.tier)).toEqual([2]);
    expect(state.lists[0]?.options.map((one) => one.id)).toEqual([
      'traits',
      'hp',
      'stress',
      'hopeBonus',
      'domainCard',
      'evasion',
    ]);
    expect(option(state, 2, 'traits')).toMatchObject({ total: 3, used: 0, left: 3 });
  });

  it("counts each list's marks, and keeps lower tiers open", () => {
    const history = [
      entry(2, pick(2, 'hp'), pick(2, 'hp')),
      entry(3, pick(2, 'evasion'), pick(2, 'stress')),
    ];
    const state = levelUpState(history, 4, v2);
    expect(state).toMatchObject({ nextLevel: 5, tier: 2, nextTier: 3, entersTier: true });
    expect(state.lists.map((list) => list.tier)).toEqual([2, 3]);
    expect(option(state, 2, 'hp')).toMatchObject({ used: 2, left: 0 });
    expect(option(state, 2, 'stress')).toMatchObject({ used: 1, left: 1 });
    expect(option(state, 3, 'hp')).toMatchObject({ used: 0, left: 2 });
    expect(option(state, 3, 'multiclass')).toMatchObject({ pickable: true, crossedOut: false });
  });

  it('marks traits within a tier, and clears the marks on a new tier', () => {
    const history = [entry(2, pick(2, 'traits', ['agility', 'strength']), pick(2, 'hp'))];
    expect(levelUpState(history, 2, v2).markedTraits).toEqual(['agility', 'strength']);
    const later = [
      ...history,
      entry(3, pick(2, 'hp'), pick(2, 'stress')),
      entry(4, pick(2, 'evasion'), pick(2, 'stress')),
    ];
    expect(levelUpState(later, 4, v2).markedTraits).toEqual([]);
  });

  it('half-marks a two-mark option, completes it, and loses a half mark on a new tier', () => {
    const first = [entry(5, pick(3, 'proficiency'), pick(3, 'hp'))];
    expect(option(levelUpState(first, 5, v2), 3, 'proficiency')).toMatchObject({
      halfMarked: true,
      lost: false,
      left: 1,
    });
    const both = [...first, entry(6, pick(3, 'proficiency'), pick(3, 'hp'))];
    expect(option(levelUpState(both, 6, v2), 3, 'proficiency')).toMatchObject({ used: 2, left: 0 });

    const late = [entry(7, pick(3, 'proficiency'), pick(3, 'evasion'))];
    const leaving = levelUpState(late, 7, v2);
    expect(leaving.losing).toEqual([{ tier: 3, option: 'proficiency' }]);
    expect(option(leaving, 3, 'proficiency')).toMatchObject({ lost: true, left: 0 });
    const after = levelUpState([...late, entry(8, pick(4, 'hp'), pick(4, 'stress'))], 8, v2);
    expect(after.losing).toEqual([]);
    expect(option(after, 3, 'proficiency')).toMatchObject({ lost: true, left: 0 });
    expect(option(after, 4, 'proficiency')).toMatchObject({ lost: false, left: 2 });
  });

  it('has no lists for a ruleset without levels, and no options without a table', () => {
    expect(levelUpState([], 1, v1)).toMatchObject({ tier: 0, nextTier: 0, lists: [] });
    const bare = levelUpState([], 1, { ...v2, levelUpOptions: undefined });
    expect(bare.lists).toEqual([{ tier: 2, options: [] }]);
    // A trait pick stored without its traits marks none.
    expect(levelUpState([entry(2, pick(2, 'traits'), pick(2, 'hp'))], 2, v2).markedTraits).toEqual(
      [],
    );
  });
});

describe('levelUpProblem', () => {
  const at = (level: number, history: LevelUpEntry[] = []) => levelUpState(history, level, v2);
  const problem = (
    over: Partial<LevelUpRequest> = {},
    level = 1,
    history: LevelUpEntry[] = [],
    ctx: Partial<LevelUpContext> = {},
    ruleset: Ruleset = v2,
  ) => levelUpProblem(request(over), levelUpState(history, level, ruleset), context(ctx), ruleset);

  it('passes a complete level-up', () => {
    expect(problem()).toBeNull();
    expect(
      levelUpProblem(
        request({ swap: { outId: HELD_GRACE_2, inId: GRACE_2 } }),
        at(1),
        context(),
        v2,
      ),
    ).toBeNull();
    expect(
      problem({ picks: [pick(2, 'domainCard'), pick(2, 'hp')], extraCardId: GRACE_2 }, 2),
    ).toBeNull();
  });

  it('needs the right number of picks, from lists open to the PC', () => {
    expect(problem({ picks: [pick(2, 'hp')] })).toBe('Pick 2 options');
    expect(problem({ picks: [pick(2, 'hp')] }, 1, [], {}, { ...v2, levelUpPicks: undefined })).toBe(
      'Pick 2 options',
    );
    expect(problem({ picks: [pick(3, 'hp'), pick(2, 'hp')] })).toBe(
      "That option isn't in a list you can pick from",
    );
    expect(problem({ picks: [pick(2, 'subclass'), pick(2, 'hp')] })).toBe(
      "That option isn't in a list you can pick from",
    );
    const locked: Ruleset = {
      ...v2,
      levelUpOptions: v2.levelUpOptions?.map((rule) =>
        rule.id === 'evasion' ? { ...rule, pickable: false } : rule,
      ),
    };
    expect(problem({ picks: [pick(2, 'evasion'), pick(2, 'hp')] }, 1, [], {}, locked)).toBe(
      "+1 Evasion can't be picked yet",
    );
  });

  it('keeps to the counts; a two-mark option may take both picks of one level-up', () => {
    expect(problem({ picks: [pick(3, 'proficiency'), pick(3, 'proficiency')] }, 4)).toBeNull();
    const half = [entry(5, pick(3, 'proficiency'), pick(3, 'hp'))];
    expect(problem({ picks: [pick(3, 'proficiency'), pick(3, 'proficiency')] }, 5, half)).toBe(
      'Tier 3 has no more of: +1 Proficiency (two marks)',
    );
    expect(problem({ picks: [pick(2, 'evasion'), pick(2, 'evasion')] })).toBe(
      'Tier 2 has no more of: +1 Evasion',
    );
    expect(problem({ picks: [pick(2, 'hp'), pick(2, 'hp')] })).toBeNull();
  });

  it('raises two different unmarked traits, up to the maximum', () => {
    const traits = (a: string, b: string) => ({
      picks: [pick(2, 'traits', [a, b]), pick(2, 'hp')],
    });
    expect(problem(traits('agility', 'strength'))).toBeNull();
    expect(problem(traits('agility', 'agility'))).toBe('Pick two different traits');
    expect(problem({ picks: [pick(2, 'traits'), pick(2, 'hp')] })).toBe(
      'Pick two different traits',
    );
    expect(problem(traits('agility', 'luck'))).toBe('Pick two of your traits');
    const marked = [entry(2, pick(2, 'traits', ['agility', 'strength']), pick(2, 'hp'))];
    expect(problem(traits('agility', 'finesse'), 2, marked)).toBe(
      'That trait is already marked this tier',
    );
    expect(
      problem({
        picks: [
          pick(2, 'traits', ['agility', 'finesse']),
          pick(2, 'traits', ['finesse', 'presence']),
        ],
      }),
    ).toBe('That trait is already marked this tier');
    expect(
      problem(traits('agility', 'finesse'), 1, [], { traits: { ...TRAITS, agility: 5 } }),
    ).toBe('Traits go up to +5');
    expect(problem({ picks: [pick(2, 'hp', ['agility', 'finesse']), pick(2, 'evasion')] })).toBe(
      'Only the trait option names traits',
    );
  });

  it('upgrades a linked subclass up to mastery', () => {
    const upgrade = { picks: [pick(3, 'subclass'), pick(3, 'hp')] };
    expect(problem(upgrade, 4)).toBeNull();
    expect(problem(upgrade, 4, [], { subclassCards: null })).toBe('Link a subclass first');
    expect(problem(upgrade, 4, [], { subclassCards: 3 })).toBe(
      'Your subclass is already at mastery',
    );
    expect(
      problem({ picks: [pick(3, 'subclass'), pick(4, 'subclass')] }, 7, [], { subclassCards: 2 }),
    ).toBe('Your subclass is already at mastery');
  });

  it('takes an extra card only with its option', () => {
    expect(problem({ picks: [pick(2, 'domainCard'), pick(2, 'hp')] })).toBe(
      'Pick your extra domain card',
    );
    expect(problem({ extraCardId: GRACE_2 })).toBe(
      'Only the extra card option gives a second card',
    );
  });

  it('checks each new card: in the campaign, not held, in the domains, at or below the level', () => {
    expect(problem({ cardId: id(99) })).toBe('That card isn’t in this campaign');
    expect(problem({ cardId: HELD_GRACE_2 })).toBe('Held is already on your sheet');
    expect(problem({ cardId: BLADE_1 })).toBe("Whirlwind isn't from your class's domains");
    expect(problem({ cardId: CODEX_3 })).toBe('Tome is level 3: pick level 2 or lower');
    const extra = { picks: [pick(2, 'domainCard'), pick(2, 'hp')] };
    expect(problem({ ...extra, extraCardId: NEW_GRACE_1 })).toBe('Pick two different new cards');
    expect(problem({ ...extra, extraCardId: GRACE_5 })).toBe(
      'Anthem is level 5: pick level 2 or lower',
    );
  });

  it('swaps a held card for one of equal or lower level', () => {
    expect(problem({ swap: { outId: GRACE_2, inId: NEW_GRACE_1 } })).toBe(
      'Swap out a card you hold',
    );
    expect(problem({ swap: { outId: id(98), inId: NEW_GRACE_1 } })).toBe(
      'Swap out a card you hold',
    );
    expect(problem({ swap: { outId: HELD_GRACE_2, inId: NEW_GRACE_1 } })).toBe(
      'Swap in a card you aren’t already taking',
    );
    expect(problem({ swap: { outId: HELD_GRACE_2, inId: CODEX_3 } }, 4)).toBe(
      'Tome is level 3: pick level 2 or lower',
    );
  });
});

describe('levelUpEffects', () => {
  const BEFORE: LevelUpColumns = {
    level: 1,
    traits: { ...TRAITS },
    hpMax: 6,
    hpCurrent: 4,
    stressMax: 6,
    hopeBonus: 0,
    evasion: 10,
    proficiency: 1,
    subclassCards: 1,
    minorThreshold: 3,
    majorThreshold: 7,
    severeThreshold: 14,
  };
  const effects = (
    picks: LevelUpPick[],
    level = 1,
    history: LevelUpEntry[] = [],
    typed = false,
    ruleset: Ruleset = v2,
  ) =>
    levelUpEffects(
      request({ picks }),
      levelUpState(history, level, ruleset),
      { ...BEFORE, level },
      typed,
      ruleset,
    );

  it('applies each option, and entering tier 2 raises proficiency', () => {
    const after = effects([pick(2, 'traits', ['agility', 'knowledge']), pick(2, 'hp')]);
    expect(after).toMatchObject({ level: 2, hpMax: 7, hpCurrent: 5, proficiency: 2 });
    expect(after.traits).toMatchObject({ agility: 3, knowledge: 0 });
    expect(BEFORE.traits['agility']).toBe(2);
    expect(effects([pick(2, 'stress'), pick(2, 'hopeBonus')], 2)).toMatchObject({
      stressMax: 7,
      hopeBonus: 1,
      proficiency: 1,
    });
    expect(effects([pick(2, 'evasion'), pick(2, 'domainCard')], 2)).toMatchObject({ evasion: 11 });
    expect(effects([pick(3, 'subclass'), pick(3, 'multiclass')], 5)).toMatchObject({
      subclassCards: 2,
    });
  });

  it('raises proficiency on the second mark of the two-mark option only', () => {
    const first = effects([pick(3, 'proficiency'), pick(3, 'hp')], 5);
    expect(first.proficiency).toBe(1);
    const second = effects([pick(3, 'proficiency'), pick(3, 'hp')], 6, [
      entry(6, pick(3, 'proficiency'), pick(3, 'hp')),
    ]);
    expect(second.proficiency).toBe(2);
    // Both marks at one level-up complete it at once.
    expect(effects([pick(3, 'proficiency'), pick(3, 'proficiency')], 5).proficiency).toBe(2);
    expect(effects([pick(9, 'proficiency'), pick(3, 'hp')], 5).proficiency).toBe(1);
  });

  it('raises typed thresholds with the level, and traits it has none of', () => {
    const typed = effects([pick(2, 'traits'), pick(2, 'hp')], 2, [], true);
    expect(typed).toMatchObject({ minorThreshold: 4, majorThreshold: 8, severeThreshold: 15 });
    const fresh = levelUpEffects(
      request({ picks: [pick(2, 'traits', ['luck', 'agility'])] }),
      levelUpState([], 2, v2),
      { ...BEFORE, level: 2 },
      false,
      v2,
    );
    expect(fresh.traits['luck']).toBe(1);
  });

  it('adds nothing for a new tier in a ruleset without proficiency', () => {
    expect(
      effects([pick(2, 'hp')], 1, [], false, { ...v2, proficiency: undefined }).proficiency,
    ).toBe(1);
  });
});

describe('levelUpRequestSchema', () => {
  it('parses picks, the new card, an extra card and a swap', () => {
    const body = request({
      picks: [pick(2, 'traits', ['agility', 'strength']), pick(2, 'domainCard')],
      extraCardId: GRACE_2,
      swap: { outId: HELD_GRACE_2, inId: NEW_GRACE_1 },
    });
    expect(levelUpRequestSchema.parse(body)).toEqual(body);
    expect(
      levelUpRequestSchema.safeParse({ ...body, picks: [pick(2, 'hp')], cardId: '' }).success,
    ).toBe(false);
  });
});

describe('Multiclassing (F4.10)', () => {
  const BARD = id(41);
  const RANGER = id(42);
  const BONE = id(43);
  const TROUBADOUR = id(44);
  const BEASTBOUND = id(45);
  const BONE_3 = id(46);
  const BONE_4 = id(47);
  const classes = [
    { id: BARD, name: 'Bard', domainIds: [GRACE, CODEX], subclassIds: [TROUBADOUR] },
    { id: RANGER, name: 'Ranger', domainIds: [BONE, CODEX], subclassIds: [BEASTBOUND] },
  ];
  const mcContext = (over: Partial<LevelUpContext> = {}): LevelUpContext =>
    context({
      classId: BARD,
      classes,
      cards: [
        ...context().cards,
        { id: BONE_3, name: 'Track', domainId: BONE, level: 3 },
        { id: BONE_4, name: 'Pounce', domainId: BONE, level: 4 },
      ],
      ...over,
    });
  const twice = [pick(3, 'multiclass'), pick(3, 'multiclass')];
  const second = { classId: RANGER, domainId: BONE, subclassId: BEASTBOUND };
  const check = (
    over: Partial<LevelUpRequest>,
    level = 4,
    history: LevelUpEntry[] = [],
    ctx: Partial<LevelUpContext> = {},
  ) => levelUpProblem(request(over), levelUpState(history, level, v2), mcContext(ctx), v2);

  it('crosses out the other tier and the same tier’s unused subclass upgrade', () => {
    const done = [entry(5, ...twice)];
    const now = levelUpState(done, 5, v2);
    expect(option(now, 3, 'multiclass')).toMatchObject({ used: 2, left: 0, crossedOut: false });
    expect(option(now, 3, 'subclass')).toMatchObject({ crossedOut: true, left: 0 });
    const later = levelUpState([...done, entry(6, pick(3, 'hp'), pick(3, 'hp'))], 7, v2);
    expect(option(later, 4, 'multiclass')).toMatchObject({ crossedOut: true, left: 0 });
    expect(option(later, 4, 'subclass')).toMatchObject({ crossedOut: false, left: 1 });

    const upgradedFirst = levelUpState(
      [entry(5, pick(3, 'subclass'), pick(3, 'hp')), entry(6, ...twice)],
      6,
      v2,
    );
    expect(option(upgradedFirst, 3, 'subclass')).toMatchObject({ crossedOut: false, left: 0 });

    const byHand = levelUpState([], 7, v2, true);
    expect(option(byHand, 3, 'multiclass')).toMatchObject({ crossedOut: true });
    expect(option(byHand, 4, 'multiclass')).toMatchObject({ crossedOut: true });
  });

  it('completes with both picks now, or the second mark after a half mark', () => {
    expect(completesMulticlass(request({ picks: twice }), levelUpState([], 4, v2))).toBe(3);
    const half = [entry(5, pick(3, 'multiclass'), pick(3, 'hp'))];
    const one = request({ picks: [pick(3, 'multiclass'), pick(3, 'hp')] });
    expect(completesMulticlass(one, levelUpState(half, 5, v2))).toBe(3);
    expect(completesMulticlass(one, levelUpState([], 4, v2))).toBeNull();
    expect(completesMulticlass(request(), levelUpState([], 1, v2))).toBeNull();
  });

  it('needs another class, one of its domains the PC hasn’t, and one of its subclasses', () => {
    expect(check({ picks: twice })).toBe(
      'Pick your second class, one of its domains and a subclass',
    );
    expect(check({ multiclass: second })).toBe('Only completing Multiclass picks a second class');
    expect(check({ picks: twice, multiclass: { ...second, classId: id(99) } })).toBe(
      'That class isn’t in this campaign',
    );
    expect(check({ picks: twice, multiclass: { ...second, classId: BARD } })).toBe(
      'Pick a class other than your own',
    );
    for (const domainId of [CODEX, GRACE]) {
      expect(check({ picks: twice, multiclass: { ...second, domainId } })).toBe(
        "Pick one of Ranger's domains that you don't have",
      );
    }
    expect(check({ picks: twice, multiclass: { ...second, subclassId: TROUBADOUR } })).toBe(
      'Pick a subclass of Ranger',
    );
    expect(check({ picks: twice, multiclass: second })).toBeNull();
    expect(check({ picks: twice, multiclass: second }, 4, [], { classes: undefined })).toBe(
      'That class isn’t in this campaign',
    );
  });

  it('takes multiclass domain cards up to half the level, rounded up', () => {
    expect(check({ picks: twice, multiclass: second, cardId: BONE_3 })).toBeNull();
    expect(check({ picks: twice, multiclass: second, cardId: BONE_4 })).toBe(
      'Pounce is level 4: multiclass domain cards go up to level 3',
    );
    const have = { multiclass: { domainId: BONE, subclassId: BEASTBOUND, subclassCards: 1 } };
    expect(check({ cardId: BONE_3 }, 5, [], have)).toBeNull();
    expect(check({ cardId: BONE_3 }, 5, [], {})).toBe("Track isn't from your class's domains");
  });

  it('upgrades the subclass the player picks, but not in the tier it multiclasses', () => {
    const half = [entry(5, pick(3, 'multiclass'), pick(3, 'hp'))];
    expect(
      check({ picks: [pick(3, 'multiclass'), pick(3, 'subclass')], multiclass: second }, 5, half),
    ).toBe("Multiclassing crosses out this tier's subclass upgrade");
    const target = (picked: LevelUpPick) => ({ picks: [picked, pick(4, 'hp')] });
    const multi: LevelUpPick = { tier: 4, option: 'subclass', target: 'multiclass' };
    const have = (subclassCards: number, subclassId: string | null = BEASTBOUND) => ({
      multiclass: { domainId: BONE, subclassId, subclassCards },
    });
    expect(check(target(multi), 7, [], have(1))).toBeNull();
    expect(check(target(multi), 7, [], have(3))).toBe(
      'Your multiclass subclass is already at mastery',
    );
    expect(check(target(multi), 7, [], have(1, null))).toBe(
      'You have no multiclass subclass to upgrade',
    );
    expect(check(target(multi), 7)).toBe('You have no multiclass subclass to upgrade');
    expect(check(target({ tier: 4, option: 'hp', target: 'main' }), 7)).toBe(
      'Only the subclass option picks a subclass',
    );
  });

  it('sets the second class on completing, and upgrades the multiclass subclass', () => {
    const base: LevelUpColumns = {
      level: 4,
      traits: { ...TRAITS },
      hpMax: 6,
      hpCurrent: 6,
      stressMax: 6,
      hopeBonus: 0,
      evasion: 10,
      proficiency: 2,
      subclassCards: 1,
      minorThreshold: 0,
      majorThreshold: 0,
      severeThreshold: 0,
    };
    const done = levelUpEffects(
      request({ picks: twice, multiclass: second }),
      levelUpState([], 4, v2),
      base,
      false,
      v2,
    );
    expect(done).toMatchObject({
      multiclassClassId: RANGER,
      multiclassDomainId: BONE,
      multiclassSubclassId: BEASTBOUND,
      multiclassSubclassCards: 1,
    });
    const notYet = levelUpEffects(
      request({ picks: [pick(3, 'multiclass'), pick(3, 'hp')], multiclass: second }),
      levelUpState([], 4, v2),
      base,
      false,
      v2,
    );
    expect(notYet.multiclassClassId).toBeUndefined();
    const up = (multiclassSubclassCards?: number) =>
      levelUpEffects(
        request({ picks: [{ tier: 4, option: 'subclass', target: 'multiclass' }, pick(4, 'hp')] }),
        levelUpState([], 8, v2),
        { ...base, level: 8, multiclassSubclassCards },
        false,
        v2,
      );
    expect(up(2)).toMatchObject({ multiclassSubclassCards: 3, subclassCards: 1 });
    expect(up(undefined).multiclassSubclassCards).toBe(2);
  });
});
