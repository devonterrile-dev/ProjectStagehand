/**
 * The fixed image test set (governance §11, D-38): the same 10 made-up records every time, so
 * a style bible change or a new image model can be compared side by side with the last run.
 * Generic on purpose: the repo is public, and these subjects spoil nothing.
 *
 * Each subject lists the fields the F2.3 prompt builder will read from a real record of that
 * kind, in the same order, so the prompts here look like the ones the GM will get.
 */
import type { AssetKind } from '@stagehand/shared';
import type { SubjectLine } from '@stagehand/style-bible';

export interface TestSubject {
  /** Stable, used in file names and `--only`. */
  id: string;
  kind: AssetKind;
  /** The record it stands in for. */
  source: string;
  name: string;
  lines: SubjectLine[];
}

export const TEST_SET: readonly TestSubject[] = [
  {
    id: 'pc-ranger',
    kind: 'character',
    source: 'PC sheet',
    name: 'Wren Ashdown',
    lines: [
      ['Class or role', 'Ranger'],
      [
        'Description',
        'A young ranger with a patched green hooded cloak, a short bow over one shoulder, freckles and a wide, confident grin.',
      ],
    ],
  },
  {
    id: 'npc-shopkeeper',
    kind: 'character',
    source: 'NPC record',
    name: 'Bramble Tuck',
    lines: [
      [
        'Appearance',
        'A short, round gnome with a huge white mustache, tiny round spectacles, a red striped apron full of pockets and a pencil behind one ear.',
      ],
      ['Description', 'Runs the general store on the village square and knows everyone by name.'],
    ],
  },
  {
    id: 'npc-sailor',
    kind: 'character',
    source: 'NPC record',
    name: 'Old Hennick',
    lines: [
      [
        'Appearance',
        'A tall, bony old sailor with a scruffy grey beard, a knitted blue cap, a yellow raincoat and one wooden leg.',
      ],
      ['Description', 'Sits on the harbor wall all day, telling stories to anyone who stops.'],
    ],
  },
  {
    id: 'monster-bog-troll',
    kind: 'monster',
    source: 'Stat block',
    name: 'Bog Troll',
    lines: [
      ['Role', 'Bruiser'],
      [
        'Description',
        'A hulking swamp troll with mossy green skin, long arms that nearly drag on the ground, a lumpy nose, tiny eyes and a club made from a tree branch.',
      ],
    ],
  },
  {
    id: 'monster-cave-spider',
    kind: 'monster',
    source: 'Stat block',
    name: 'Cave Spider',
    lines: [
      ['Role', 'Skulk'],
      [
        'Description',
        'A spider the size of a pony, purple-black with orange stripes, eight beady eyes and thick fuzzy legs.',
      ],
    ],
  },
  {
    id: 'prop-well',
    kind: 'prop',
    source: 'Prop record',
    name: 'Village Well',
    lines: [
      [
        'Appearance',
        'A round stone well with a small wooden roof, a crank handle and a bucket hanging on a rope.',
      ],
      ['Description', 'The old well in the middle of the square. The stones are worn smooth.'],
    ],
  },
  {
    id: 'item-lantern',
    kind: 'prop',
    source: 'Item record',
    name: 'Green Lantern',
    lines: [
      ['Kind', 'Light source'],
      ['Appearance', 'A brass hand lantern with green glass panes and a dented top ring.'],
      ['Description', 'A lantern that gives off a soft green glow.'],
    ],
  },
  {
    id: 'prop-notice-board',
    kind: 'prop',
    source: 'Prop record',
    name: 'Notice Board',
    lines: [
      [
        'Appearance',
        'A wooden notice board on two posts with a little shingled roof, covered in pinned papers and posters.',
      ],
      ['Description', 'Job offers, lost pets and a wanted poster.'],
    ],
  },
  {
    id: 'backdrop-village-square',
    kind: 'backdrop',
    source: 'Spot record',
    name: 'Village Square',
    lines: [
      [
        'Backdrop notes',
        'A cobbled village square with timber-framed houses, a bakery with a striped awning, a clock tower in the middle distance and green rolling hills beyond. Sunny late morning.',
      ],
      ['Area', 'A cozy farming village'],
    ],
  },
  {
    id: 'backdrop-forest-path',
    kind: 'backdrop',
    source: 'Spot record',
    name: 'Forest Path',
    lines: [
      [
        'Backdrop notes',
        'A winding dirt path leading into a dense forest of tall, twisted trees, big mushrooms along the edges and shafts of light through the canopy. Late afternoon.',
      ],
      ['Area', 'The Old Woods'],
    ],
  },
];
