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
    pointsOfInterest: [{ name: 'Fishmonger', detail: 'Sells more than fish' }],
    hiddenDetails: richText('A trapdoor under the fish crates'),
    backdropNotes: 'Wide dock at dusk',
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
  faction: { readAloud: richText('x') },
  lore: { goals: richText('x') },
  story_beat: { category: 'x' },
  item: { arcName: 'x' },
  session_notes: { kind: 'x' },
};
