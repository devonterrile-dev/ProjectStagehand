import { describe, expect, it } from 'vitest';

import { gmObject, gmStage, playerObject, playerStage, stageImage } from '@/test/play-fixtures';

import { playPath, stageImageUrls, theaterView } from './stage';

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

  it('leaves the back wall bare without a backdrop', () => {
    const view = theaterView(CAMPAIGN, playerStage({ backdrop: null, objects: [] }));

    expect(view).toEqual({ backdropUrl: null, cutouts: [] });
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

describe('playPath', () => {
  it('is the campaign’s play page', () => {
    expect(playPath('abc')).toBe('/campaigns/abc/play');
  });
});
