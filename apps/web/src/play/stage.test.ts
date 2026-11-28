import { describe, expect, it } from 'vitest';

import {
  gmObject,
  gmStage,
  playerObject,
  playerStage,
  present,
  stageImage,
} from '@/test/play-fixtures';

import { battleView, playPath, stageImageUrls, talkingPuppets, theaterView } from './stage';

const CAMPAIGN = 'campaign-1';
const urlOf = (n: number) => `/api/campaigns/${CAMPAIGN}/assets/${stageImage(n).assetId}/image?p=3`;

describe('theaterView', () => {
  it('draws everything a player is sent, props on their mount and puppets on sticks', () => {
    const view = theaterView(
      CAMPAIGN,
      playerStage({
        objects: [
          playerObject(1, { across: 0.2, depthTick: 7, scale: 1.5, flipped: true }),
          playerObject(2, { mount: 'hang', up: 0.6 }),
          playerObject(3, { kind: 'puppet', mount: null, up: 0.3 }),
        ],
      }),
    );

    expect(view.backdropUrl).toBe(urlOf(0));
    expect(view.cutouts).toEqual([
      expect.objectContaining({
        url: urlOf(1),
        width: 640,
        height: 1024,
        across: 0.2,
        depthTick: 7,
        scale: 1.5,
        flipped: true,
        mount: 'stand',
      }),
      expect.objectContaining({ url: urlOf(2), mount: 'hang', up: 0.6 }),
      expect.objectContaining({ url: urlOf(3), mount: 'stick', up: 0.3 }),
    ]);
    for (const cutout of view.cutouts) {
      expect(cutout).toMatchObject({ faded: false, lowered: false });
    }
  });

  it('marks what a player may inspect: a revealed record, never a PC (F3.5b)', () => {
    const view = theaterView(
      CAMPAIGN,
      playerStage({
        objects: [playerObject(1), playerObject(2, { kind: 'puppet', recordId: null })],
      }),
    );
    expect(view.cutouts.map((cutout) => cutout.recordId)).toEqual([playerObject(1).recordId, null]);
    // The GM's theater picks cutouts instead.
    const gm = theaterView(CAMPAIGN, gmStage({ objects: [gmObject(1, 'Stone Well')] }));
    expect(gm.cutouts[0]?.recordId).toBeUndefined();
  });

  it('shows the GM the theater as players see it: nothing hidden, nothing without an image', () => {
    const stage = gmStage({
      objects: [
        gmObject(1, 'Stone Well'),
        gmObject(2, 'Secret Trapdoor', { shown: false }),
        gmObject(3, 'Old Marta', { kind: 'puppet', mount: null, shown: false }),
        gmObject(4, 'Undrawn Crate', { image: null }),
        gmObject(5, 'Raised Captain', { kind: 'puppet', mount: null }),
      ],
    });

    expect(theaterView(CAMPAIGN, stage).cutouts.map((cutout) => cutout.url)).toEqual([
      urlOf(1),
      urlOf(5),
    ]);
  });

  it('draws the GM the hidden props see-through when asked, never the puppets below', () => {
    const view = theaterView(CAMPAIGN, gmStage(), { hiddenProps: true });

    expect(view.cutouts.map((cutout) => [cutout.url, cutout.faded])).toEqual([
      [urlOf(1), false],
      [urlOf(2), true],
    ]);
  });

  it('draws the GM a move still on its way where it is going', () => {
    const stage = gmStage();
    const [well] = stage.objects;
    const view = theaterView(CAMPAIGN, stage, {
      pending: { [well?.id ?? '']: { across: 0.9, depthTick: 1, flipped: true } },
    });

    expect(view.cutouts[0]).toMatchObject({ across: 0.9, depthTick: 1, flipped: true, up: 0 });
  });

  it('passes a passer on with where it began, and walks the puppets that travel (F5.4)', () => {
    const view = theaterView(
      CAMPAIGN,
      playerStage({
        travel: { playing: true, distance: 2 },
        objects: [
          playerObject(1, { passFrom: 1.5 }),
          playerObject(2, { kind: 'puppet', mount: null }),
          playerObject(3, { kind: 'puppet', mount: null, passFrom: 1.75 }),
        ],
      }),
    );

    expect(view.cutouts.map((cutout) => [cutout.passFrom, cutout.walking])).toEqual([
      [1.5, false],
      [null, true],
      // A stationary NPC passes by; it doesn't walk.
      [1.75, false],
    ]);
    // A static scene's puppets never walk.
    expect(theaterView(CAMPAIGN, playerStage()).cutouts.every((cutout) => !cutout.walking)).toBe(
      true,
    );
  });

  it('draws no hidden prop see-through in a transition scene: it comes in from the right (F5.4)', () => {
    const view = theaterView(CAMPAIGN, gmStage({ travel: { playing: false, distance: 0 } }), {
      hiddenProps: true,
    });

    expect(view.cutouts.map((cutout) => cutout.url)).toEqual([urlOf(1)]);
  });

  it('leaves the back wall bare without a backdrop', () => {
    const view = theaterView(CAMPAIGN, playerStage({ backdrop: null, objects: [] }));

    expect(view).toEqual({ backdropUrl: null, cutouts: [] });
  });
});

describe('talkingPuppets', () => {
  const vex = '00000000-0000-4000-8000-00000000a001';
  const view = theaterView(
    CAMPAIGN,
    playerStage({
      objects: [
        playerObject(1),
        playerObject(2, { kind: 'puppet', mount: null, characterId: vex }),
        playerObject(3, { kind: 'puppet', mount: null }),
      ],
    }),
  );
  const [well, vexPuppet, marta] = view.cutouts.map((cutout) => cutout.id);

  it('is each PC puppet whose player talks (F3.7)', () => {
    const sam = present(1, 'Sam', { characterId: vex });
    expect([...talkingPuppets(view.cutouts, [sam])]).toEqual([]);
    expect([...talkingPuppets(view.cutouts, [{ ...sam, speaking: true }])]).toEqual([vexPuppet]);
  });

  it('is the NPC the GM voices while the GM talks, never anything of the GM’s own (F3.8)', () => {
    const gm = present(0, 'Mira', { role: 'gm', speaking: true });
    expect([...talkingPuppets(view.cutouts, [gm])]).toEqual([]);
    expect([...talkingPuppets(view.cutouts, [{ ...gm, voicing: marta ?? null }])]).toEqual([marta]);
    expect([
      ...talkingPuppets(view.cutouts, [{ ...gm, speaking: false, voicing: marta ?? null }]),
    ]).toEqual([]);
    // An NPC this stage doesn't hold (gone below for players) talks nowhere.
    expect([...talkingPuppets(view.cutouts, [{ ...gm, voicing: playerObject(9).id }])]).toEqual([]);
    expect(well).toBeDefined();
  });
});

describe('stageImageUrls', () => {
  it('lists each image in sight once, the backdrop included', () => {
    const stage = playerStage({
      objects: [playerObject(1), playerObject(1, { across: 0.8 }), playerObject(2)],
    });

    expect(stageImageUrls(CAMPAIGN, stage).sort()).toEqual([urlOf(0), urlOf(1), urlOf(2)].sort());
  });

  it('asks a GM for the hidden props too, which the GM sees through, but no puppet below', () => {
    expect(stageImageUrls(CAMPAIGN, gmStage()).sort()).toEqual(
      [urlOf(0), urlOf(1), urlOf(2)].sort(),
    );
  });
});

describe('battleView (F5.5)', () => {
  const marta = gmStage().objects[2];
  if (marta === undefined) throw new Error('missing fixture');

  it('is nothing with no battle on', () => {
    expect(battleView(CAMPAIGN, gmStage())).toBeNull();
    expect(battleView(CAMPAIGN, playerStage())).toBeNull();
  });

  it('gives the GM every token with its puppet’s name and picture, moves on their way first', () => {
    const stage = gmStage({
      objects: [...gmStage().objects, gmObject(4, 'Faceless', { kind: 'puppet', image: null })],
      battle: {
        size: 'small',
        strokes: [],
        tokens: [
          { id: marta.id, side: 'monster', square: null },
          { id: gmObject(4, 'Faceless').id, side: 'npc', square: null },
        ],
      },
    });

    expect(battleView(CAMPAIGN, stage)).toEqual({
      size: 'small',
      strokes: [],
      tokens: [
        {
          id: marta.id,
          side: 'monster',
          url: urlOf(3),
          width: 640,
          height: 1024,
          name: 'Old Marta',
          square: null,
        },
      ],
    });
    expect(
      battleView(CAMPAIGN, stage, { [marta.id]: { column: 1, row: 2 } })?.tokens[0]?.square,
    ).toEqual({ column: 1, row: 2 });
  });

  it('gives a player the tokens on the mat with their own pictures, and asks for them', () => {
    const stage = playerStage({
      battle: {
        size: 'large',
        strokes: [],
        tokens: [
          {
            id: marta.id,
            side: 'npc',
            image: stageImage(7),
            characterId: null,
            square: { column: 17, row: 0 },
          },
        ],
      },
    });

    expect(battleView(CAMPAIGN, stage)?.tokens).toEqual([
      {
        id: marta.id,
        side: 'npc',
        url: urlOf(7),
        width: 640,
        height: 1024,
        name: null,
        square: { column: 17, row: 0 },
      },
    ]);
    // Her puppet waits below, out of the player's objects: the token's picture is still loaded.
    expect(stageImageUrls(CAMPAIGN, stage)).toContain(urlOf(7));
  });
});

describe('playPath', () => {
  it('is the campaign’s play page', () => {
    expect(playPath('abc')).toBe('/campaigns/abc/play');
  });
});
