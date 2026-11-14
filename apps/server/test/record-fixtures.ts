/**
 * Valid record data for every type, for the integration tests. Adding a record type means
 * adding its fixture here, so the per-type tests cover it.
 */
import type { RecordType, RichText } from '@stagehand/shared';

/** One paragraph of rich text. */
export function richText(text: string): RichText {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

/** A full, valid `fields` object for every type. */
export const FULL_FIELDS: Record<RecordType, Record<string, unknown>> = {
  npc: {
    appearance: 'Tall, salt-stained coat',
    personality: richText('Gruff but fair'),
    voiceAndMannerisms: 'Low voice, taps the table',
    wants: richText('To find her brother'),
    knowledge: richText('Knows the tide schedule'),
    secrets: richText('Smuggles for the Tide Guild'),
    roleInStory: richText('Reluctant ally'),
    status: 'alive',
  },
  area: {
    kindOfPlace: 'Harbour town',
    overview: richText('Built on stilts'),
    atmosphere: richText('Gulls, brine, creaking rope'),
    notableFeatures: richText('The drowned bell tower'),
    hooks: richText('A ship that never docks'),
    secrets: richText('The mayor is a mimic'),
  },
  spot: {
    readAloud: richText('Stalls bob on barrels'),
    hiddenDetails: richText('A trapdoor under the fish crates'),
    backdropNotes: 'Wide dock at dusk',
  },
  prop: {
    appearance: 'A barnacled bell on a post',
    hiddenDetails: richText('The clapper is a key'),
  },
  faction: {
    goals: richText('Control the harbour'),
    resources: richText('Three ships, one judge'),
    publicReputation: richText('Honest traders'),
    secrets: richText('They sank the Marigold'),
  },
  lore: {
    category: 'Religion',
    summary: richText('The Drowned God sleeps'),
    fullDetails: richText('Long ago, before the flood'),
    trueVsBelieved: richText('He is awake'),
  },
  story_beat: {
    arcName: 'The Marigold',
    order: 2,
    summary: richText('The wreck is found'),
    trigger: richText('The party reaches the reef'),
    possibleOutcomes: richText('They recover the bell'),
    status: 'planned',
  },
  item: {
    kind: 'Relic',
    appearance: 'A bronze bell the size of a fist',
    effect: richText('Rings when lies are told'),
    value: 'Priceless to the Guild',
    history: richText('Cast for the Marigold'),
  },
  session_notes: {
    sessionNumber: 3,
    date: '2026-11-09',
    gmRecap: richText('The party found the bell'),
    keyEvents: richText('Fight on the dock'),
    openThreads: richText('Who hired the divers?'),
    prepForNextTime: richText('Stat the mimic mayor'),
  },
};

/** A field that belongs to a different type than the one named, for "wrong type" tests. */
export const FOREIGN_FIELD: Record<RecordType, Record<string, unknown>> = {
  npc: { goals: richText('x') },
  area: { status: 'alive' },
  spot: { kindOfPlace: 'x' },
  prop: { readAloud: richText('x') },
  faction: { readAloud: richText('x') },
  lore: { goals: richText('x') },
  story_beat: { category: 'x' },
  item: { arcName: 'x' },
  session_notes: { kind: 'x' },
};

/** Every editable key of a character sheet, valid for ruleset 1 (F1.4). */
export const FULL_SHEET_PATCH = {
  name: 'Vex Tidecaller',
  level: 3,
  className: 'Ranger',
  publicDescription: richText('A wiry sailor with a harpoon'),
  gmNotes: richText('Secretly heir to the Tide Guild'),
  traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
  evasion: 11,
  armorScore: 3,
  armorSlotsMax: 4,
  armorSlotsMarked: 1,
  minorThreshold: 3,
  majorThreshold: 7,
  severeThreshold: 14,
  hpMax: 7,
  hpCurrent: 5,
  stressMax: 6,
  stressCurrent: 2,
  hope: 4,
  proficiency: 2,
  experiences: [{ name: 'Sailor', bonus: 2 }],
  weapons: {
    primary: {
      name: 'Harpoon',
      trait: 'finesse',
      range: 'Close',
      damageDice: '1d10+2',
      damageType: 'physical',
      feature: 'Reel in a hit target',
    },
    secondary: null,
    inventory: [
      {
        name: 'Knife',
        trait: null,
        range: 'Melee',
        damageDice: '1d6',
        damageType: 'physical',
        feature: '',
      },
    ],
  },
  armor: {
    name: 'Oilskin',
    baseMajorThreshold: 6,
    baseSevereThreshold: 13,
    baseScore: 3,
    feature: 'Waterproof',
  },
  inventory: [{ name: 'Rope', detail: '50 ft' }],
  gold: { handfuls: 3, bags: 1, chests: 0 },
  classFeature: { name: 'Hunter’s Mark', description: 'Track one target' },
  combatOptions: [
    { name: 'Volley', kind: 'action', cost: '1 Hope', description: 'Hit two targets' },
  ],
};

/** Every editable key of a stat block (F1.4). */
export const FULL_STAT_BLOCK_PATCH = {
  name: 'Reef Shark',
  tier: 2,
  role: 'Bruiser',
  publicDescription: richText('A grey shape under the boat'),
  difficulty: 14,
  attackModifier: -1,
  standardAttack: { name: 'Bite', range: 'Melee', damageDice: '2d8+3', damageType: 'physical' },
  experiences: [{ name: 'Blood in the water', bonus: 3 }],
  motives: ['Circle', 'Ambush from below'],
  features: [
    { name: 'Thrash', kind: 'reaction', cost: 'Mark a Stress', description: 'Knock back' },
  ],
  majorThreshold: 9,
  severeThreshold: 17,
  hpMax: 6,
  stressMax: 3,
};
