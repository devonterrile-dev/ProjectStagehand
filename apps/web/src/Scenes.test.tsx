import {
  SCENE_MAX_OBJECTS,
  type Campaign,
  type CampaignRecord,
  type SceneObjectInput,
} from '@stagehand/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StageCutout } from '@/lib/scenes';
import type { SceneBuilderCanvasProps } from '@/stage/SceneBuilderCanvas';
import {
  campaign,
  currentUrl,
  failRequests,
  MIRA,
  mockApi,
  record,
  renderAt,
  uuid,
  type FakeWorld,
} from '@/test/app-harness';
import type { SceneSeed } from '@/test/scenes-world';

type FetchMock = ReturnType<typeof mockApi>;

/** What the page last handed the canvas, so a test can play the part of the 3D theater. */
let canvasProps: SceneBuilderCanvasProps | null = null;

// jsdom has no WebGL, so the 3D canvas is replaced by a stand-in that shows what it was given.
vi.mock('@/stage/SceneBuilderCanvas', () => ({
  SceneBuilderCanvas: (props: SceneBuilderCanvasProps) => {
    canvasProps = props;
    return (
      <div
        data-testid="scene-canvas"
        data-backdrop={props.backdropUrl ?? ''}
        data-selected={props.selectedId ?? ''}
        data-objects={JSON.stringify(props.objects)}
        data-editable={String(props.editable)}
        data-look-around={String(props.lookAround)}
        data-guide-tick={props.guideTick === null ? '' : String(props.guideTick)}
      />
    );
  },
}));

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** The parsed JSON bodies of every request to a URL ending in `suffix` with `method`. */
function bodiesTo(fetchMock: FetchMock, suffix: string, method: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => urlOf(input).endsWith(suffix) && init?.method === method)
    .map(([, init]): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : null));
}

const canvas = () => screen.findByTestId('scene-canvas');
/** The cutouts the theater was last asked to draw. */
const drawn = (stage: HTMLElement) => JSON.parse(stage.dataset['objects'] ?? '[]') as StageCutout[];
const tray = () => within(screen.getByRole('complementary', { name: 'Tray' }));
const panel = () => within(screen.getByRole('complementary', { name: 'Scene objects' }));
const placedCount = () => screen.getByLabelText('Objects placed').textContent;

/** The theater reports a press on a cutout, or beside them all (null). */
function press(id: string | null) {
  act(() => {
    canvasProps?.onSelect(id);
  });
}

const ref = (r: CampaignRecord) => ({ id: r.id, type: r.type, name: r.name });

/**
 * A coast campaign: the Fish Market (a Spot with a backdrop) has a well, a keeper and an
 * undrawn coil of rope; a pendant and a gull have images but belong to no Spot.
 */
function world(
  options: {
    scenes?: (records: Fixture) => SceneSeed[];
    overrides?: Partial<Campaign>;
    extra?: FakeWorld;
  } = {},
) {
  const coast = campaign({ name: 'Painted Coast', ...options.overrides });
  const area = record({ type: 'area', name: 'Saltmarsh' });
  const keeper = record({ type: 'npc', name: 'Old Keeper', visualAssetId: uuid() });
  const rope = record({ type: 'item', name: 'Coil of Rope' });
  const market = record({
    type: 'spot',
    name: 'Fish Market',
    parentId: area.id,
    visualAssetId: uuid(),
    links: { npcsHere: [ref(keeper)], itemsHere: [ref(rope)] },
  });
  const cellar = record({ type: 'spot', name: 'Bare Cellar', parentId: area.id });
  const well = record({
    type: 'prop',
    name: 'Stone Well',
    visualAssetId: uuid(),
    links: { spot: [ref(market)] },
  });
  const pendant = record({ type: 'item', name: 'Tide Pendant', visualAssetId: uuid() });
  const gull = record({ type: 'npc', name: 'Gull Whisperer', visualAssetId: uuid() });
  const fixture = { coast, area, keeper, rope, market, cellar, well, pendant, gull };
  const fetchMock = mockApi(MIRA, [coast], {
    campaignData: {
      [coast.id]: { records: [area, keeper, rope, market, cellar, well, pendant, gull] },
    },
    scenes: { [coast.id]: options.scenes?.(fixture) ?? [] },
    ...options.extra,
  });
  return { ...fixture, fetchMock };
}

type Fixture = Omit<ReturnType<typeof world>, 'fetchMock'>;

/** An object as the builder would have saved it. */
function saved(recordId: string, overrides: Partial<SceneObjectInput> = {}): SceneObjectInput {
  return {
    id: uuid(),
    recordId,
    across: 0.5,
    up: 0,
    depthTick: 5,
    scale: 1,
    flipped: false,
    ...overrides,
  };
}

const scenesUrl = (c: Campaign) => `/campaigns/${c.id}/scenes`;
const sceneUrl = (c: Campaign, sceneId: string) => `${scenesUrl(c)}/${sceneId}`;

/** A world with one saved scene at the Fish Market, opened in the builder. */
async function openBuilder(
  objects: (fixture: Fixture) => SceneObjectInput[] = () => [],
  options: { spot?: 'market' | 'cellar' | null; overrides?: Partial<Campaign> } = {},
) {
  const sceneId = uuid();
  const built = world({
    scenes: (fixture) => [
      {
        id: sceneId,
        name: 'Market at dawn',
        spotId: options.spot === null ? null : fixture[options.spot ?? 'market'].id,
        objects: objects(fixture),
      },
    ],
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  renderAt(sceneUrl(built.coast, sceneId));
  const stage = await canvas();
  return { ...built, sceneId, stage, objectsPath: `/scenes/${sceneId}/objects` };
}

/** The last list of objects the builder saved. */
async function lastSave(fetchMock: FetchMock, objectsPath: string): Promise<SceneObjectInput[]> {
  expect(await screen.findByText('Saved', undefined, { timeout: 3000 })).toBeDefined();
  const bodies = bodiesTo(fetchMock, objectsPath, 'PUT') as { objects: SceneObjectInput[] }[];
  return bodies.at(-1)?.objects ?? [];
}

describe('Scenes list', () => {
  it('is opened from the campaign page and lists scenes by name', async () => {
    const { coast } = world({
      scenes: ({ market, well }) => [
        { id: uuid(), name: 'zebra crossing' },
        {
          id: uuid(),
          name: 'Market at dawn',
          spotId: market.id,
          objects: [saved(well.id), saved(well.id, { across: 0.2 })],
        },
      ],
    });
    renderAt(`/campaigns/${coast.id}`);

    fireEvent.click(await screen.findByRole('link', { name: 'Open scenes' }));

    const list = await screen.findByRole('list', { name: 'Scenes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'Market at dawnFish Market2 placed',
      'zebra crossingNo backdropnothing placed',
    ]);
    expect(currentUrl()).toBe(scenesUrl(coast));
  });

  it('says so when there are no scenes yet', async () => {
    const { coast } = world();
    renderAt(scenesUrl(coast));

    expect(await screen.findByText(/No scenes yet/)).toBeDefined();
  });

  it('creates a scene from a Spot, named after it, and opens the builder', async () => {
    const { coast, market, fetchMock } = world();
    renderAt(scenesUrl(coast));
    fireEvent.click(await screen.findByRole('button', { name: 'New scene' }));
    const dialog = within(await screen.findByRole('dialog'));

    fireEvent.change(dialog.getByLabelText('Spot'), { target: { value: market.id } });
    expect(dialog.getByLabelText<HTMLInputElement>('Scene name').value).toBe('Fish Market');
    fireEvent.click(dialog.getByRole('button', { name: 'Create scene' }));

    const stage = await canvas();
    expect(bodiesTo(fetchMock, '/scenes', 'POST')).toEqual([
      { name: 'Fish Market', spotId: market.id },
    ]);
    expect(currentUrl()).toMatch(new RegExp(`^${scenesUrl(coast)}/[0-9a-f-]{36}$`));
    expect(stage.dataset['backdrop']).toContain(`/assets/${market.visualAssetId ?? ''}/image`);
  });

  it('creates an empty theater with a name of its own, and insists on a name', async () => {
    const { coast, fetchMock } = world();
    renderAt(scenesUrl(coast));
    fireEvent.click(await screen.findByRole('button', { name: 'New scene' }));
    const dialog = within(await screen.findByRole('dialog'));

    fireEvent.click(dialog.getByRole('button', { name: 'Create scene' }));
    expect(dialog.getByRole('alert').textContent).toBe('Scene name cannot be empty');
    expect(bodiesTo(fetchMock, '/scenes', 'POST')).toEqual([]);

    fireEvent.change(dialog.getByLabelText('Scene name'), { target: { value: ' Dream ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Create scene' }));

    const stage = await canvas();
    expect(bodiesTo(fetchMock, '/scenes', 'POST')).toEqual([{ name: 'Dream', spotId: null }]);
    expect(stage.dataset['backdrop']).toBe('');
  });

  it('renames and deletes a scene from its row', async () => {
    const sceneId = uuid();
    const { coast, fetchMock } = world({ scenes: () => [{ id: sceneId, name: 'Old name' }] });
    renderAt(scenesUrl(coast));

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Options for Old name' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }));
    const rename = within(await screen.findByRole('dialog'));
    fireEvent.change(rename.getByLabelText('Scene name'), { target: { value: 'New name' } });
    fireEvent.click(rename.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByRole('link', { name: /New name/ })).toBeDefined();
    expect(bodiesTo(fetchMock, `/scenes/${sceneId}`, 'PATCH')).toEqual([{ name: 'New name' }]);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Options for New name' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText('Delete New name?')).toBeDefined();
    fireEvent.click(confirm.getByRole('button', { name: 'Delete scene' }));

    expect(await screen.findByText(/No scenes yet/)).toBeDefined();
  });

  it('is for the GM only, and read-only while archived', async () => {
    const player = world({ overrides: { role: 'player' } });
    renderAt(scenesUrl(player.coast));
    expect(await screen.findByText(/Only the GM can see them/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New scene' })).toBeNull();
  });

  it('offers no changes while the campaign is archived', async () => {
    const { coast } = world({
      scenes: () => [{ id: uuid(), name: 'Frozen' }],
      overrides: { archivedAt: '2026-11-14T09:00:00.000Z' },
    });
    renderAt(scenesUrl(coast));

    expect(await screen.findByRole('link', { name: /Frozen/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New scene' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Options for Frozen' })).toBeNull();
  });
});

describe('Build a scene here', () => {
  it("makes a scene from a Spot's page and opens it with the Spot's backdrop", async () => {
    const { coast, market, fetchMock } = world();
    renderAt(`/campaigns/${coast.id}/records/${market.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Build a scene here' }));

    const stage = await canvas();
    expect(bodiesTo(fetchMock, '/scenes', 'POST')).toEqual([
      { name: 'Fish Market', spotId: market.id },
    ]);
    expect(stage.dataset['backdrop']).toContain(`/assets/${market.visualAssetId ?? ''}/image`);
    expect(screen.getByRole('heading', { name: 'Fish Market' })).toBeDefined();
  });

  it('is only on Spots', async () => {
    const { coast, well } = world();
    renderAt(`/campaigns/${coast.id}/records/${well.id}`);

    expect(await screen.findByRole('link', { name: 'Fill in with AI' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Build a scene here' })).toBeNull();
  });
});

describe('Scene builder', () => {
  it('fills the window with the theater, the backdrop on its back wall', async () => {
    const { market, coast, stage } = await openBuilder();

    expect(screen.getByRole('heading', { name: 'Market at dawn' })).toBeDefined();
    expect(stage.dataset['backdrop']).toBe(
      `/api/campaigns/${coast.id}/assets/${market.visualAssetId ?? ''}/image?p=3`,
    );
    expect(drawn(stage)).toEqual([]);
    expect(placedCount()).toBe(`0 of ${String(SCENE_MAX_OBJECTS)} placed`);
    // No app header: the page is all stage.
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('link', { name: '← Scenes' }).getAttribute('href')).toBe(
      scenesUrl(coast),
    );
  });

  it("suggests the Spot's own records first, then offers every record with an image", async () => {
    const { coast, rope } = await openBuilder();

    const suggested = within(screen.getByRole('region', { name: 'Suggested for Fish Market' }));
    expect(suggested.getByRole('button', { name: 'Add Stone Well' })).toBeDefined();
    expect(suggested.getByRole('button', { name: 'Add Old Keeper' })).toBeDefined();
    // Not drawn yet: it can't be added, but its record is one click away.
    expect(suggested.queryByRole('button', { name: 'Add Coil of Rope' })).toBeNull();
    expect(suggested.getByRole('link', { name: 'Open Coil of Rope' }).getAttribute('href')).toBe(
      `/campaigns/${coast.id}/records/${rope.id}`,
    );

    const all = within(screen.getByRole('region', { name: 'All records with an image' }));
    expect(
      (await all.findAllByRole('button')).map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Add Gull Whisperer', 'Add Old Keeper', 'Add Stone Well', 'Add Tide Pendant']);

    fireEvent.change(all.getByLabelText('Search the tray'), { target: { value: 'tide' } });
    expect(all.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Add Tide Pendant',
    ]);
    fireEvent.change(all.getByLabelText('Search the tray'), { target: { value: 'zzz' } });
    expect(all.getByText('Nothing matches that search.')).toBeDefined();
  });

  it('adds a prop from the tray: on a stand, selected, and saved by itself', async () => {
    const { well, coast, stage, fetchMock, objectsPath } = await openBuilder();

    fireEvent.click(await tray().findByRole('button', { name: 'Add Tide Pendant' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Suggested for Fish Market' })).getByRole(
        'button',
        { name: 'Add Stone Well' },
      ),
    );

    const cutouts = drawn(stage);
    expect(cutouts).toHaveLength(2);
    expect(cutouts[1]).toMatchObject({
      url: `/api/campaigns/${coast.id}/assets/${well.visualAssetId ?? ''}/image?p=3`,
      width: 640,
      height: 1024,
      up: 0,
      depthTick: 5,
      scale: 1,
      flipped: false,
      mount: 'stand',
      faded: false,
      lowered: false,
    });
    // The second lands beside the first, not on top of it.
    expect(cutouts[1]?.across).not.toBe(cutouts[0]?.across);
    expect(stage.dataset['selected']).toBe(cutouts[1]?.id);
    expect(panel().getByRole('heading', { name: 'Stone Well' })).toBeDefined();
    expect(placedCount()).toBe(`2 of ${String(SCENE_MAX_OBJECTS)} placed`);

    const objects = await lastSave(fetchMock, objectsPath);
    expect(objects).toEqual([
      expect.objectContaining({ across: 0.5, shown: true, mount: 'stand' }),
      {
        id: cutouts[1]?.id,
        recordId: well.id,
        across: cutouts[1]?.across,
        up: 0,
        depthTick: 5,
        scale: 1,
        flipped: false,
        shown: true,
        mount: 'stand',
      },
    ]);
  });

  it('places the selected prop from the panel: across, height, depth, size and flip', async () => {
    const { stage, fetchMock, objectsPath } = await openBuilder(({ well }) => [saved(well.id)]);
    const [object] = drawn(stage);
    press(object?.id ?? '');

    fireEvent.change(panel().getByLabelText('Left to right'), { target: { value: '0.25' } });
    fireEvent.change(panel().getByLabelText('Height'), { target: { value: '0.6' } });
    fireEvent.change(panel().getByLabelText('Size'), { target: { value: '1.5' } });
    fireEvent.click(panel().getByRole('button', { name: 'Step forward' }));
    fireEvent.click(panel().getByRole('button', { name: 'Step forward' }));
    fireEvent.click(panel().getByRole('button', { name: 'Step back' }));
    fireEvent.click(panel().getByRole('button', { name: 'Flipped' }));

    expect(drawn(stage)).toEqual([
      expect.objectContaining({ across: 0.25, up: 0.6, scale: 1.5, depthTick: 4, flipped: true }),
    ]);
    expect(panel().getByText('tick 4 of 0 (front) to 9 (back)')).toBeDefined();
    expect(panel().getByRole('button', { name: 'Flipped' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(await lastSave(fetchMock, objectsPath)).toEqual([
      expect.objectContaining({
        id: object?.id,
        across: 0.25,
        up: 0.6,
        scale: 1.5,
        depthTick: 4,
        flipped: true,
      }),
    ]);
  });

  it('stops at the front and the back of the theater', async () => {
    const { stage } = await openBuilder(({ well, pendant }) => [
      saved(well.id, { depthTick: 0 }),
      saved(pendant.id, { depthTick: 9, across: 0.2 }),
    ]);
    const [front, back] = drawn(stage);

    press(front?.id ?? '');
    expect(panel().getByRole('button', { name: 'Step forward' })).toHaveProperty('disabled', true);
    expect(panel().getByRole('button', { name: 'Step back' })).toHaveProperty('disabled', false);

    press(back?.id ?? '');
    expect(panel().getByRole('button', { name: 'Step forward' })).toHaveProperty('disabled', false);
    expect(panel().getByRole('button', { name: 'Step back' })).toHaveProperty('disabled', true);
  });

  it('hides a prop until it is shown, and hangs it from the roof', async () => {
    const { stage, fetchMock, objectsPath } = await openBuilder(({ well }) => [saved(well.id)]);
    press(drawn(stage)[0]?.id ?? '');

    fireEvent.click(panel().getByRole('button', { name: 'Hidden at first' }));
    fireEvent.click(panel().getByRole('button', { name: 'Hangs from the roof' }));

    // A hidden prop is still drawn while building, see-through.
    expect(drawn(stage)).toEqual([expect.objectContaining({ faded: true, mount: 'hang' })]);
    expect(
      within(panel().getByRole('region', { name: 'In this scene' })).getByRole('button')
        .textContent,
    ).toBe('Stone Wellhidden prop');
    expect(await lastSave(fetchMock, objectsPath)).toEqual([
      expect.objectContaining({ shown: false, mount: 'hang' }),
    ]);

    fireEvent.click(panel().getByRole('button', { name: 'Hidden at first' }));
    fireEvent.click(panel().getByRole('button', { name: 'Hangs from the roof' }));
    expect(drawn(stage)).toEqual([expect.objectContaining({ faded: false, mount: 'stand' })]);
  });

  it('adds an NPC as a puppet on a stick, once, saved without prop settings', async () => {
    const { keeper, stage, fetchMock, objectsPath } = await openBuilder();

    fireEvent.click(await tray().findByRole('button', { name: 'Add Gull Whisperer' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Suggested for Fish Market' })).getByRole(
        'button',
        { name: 'Add Old Keeper' },
      ),
    );

    // While building, a puppet stands where it will rise to.
    expect(drawn(stage)[1]).toMatchObject({ mount: 'stick', lowered: false, faded: false });
    expect(panel().getByText(/it waits below the scene until you raise it/)).toBeDefined();
    expect(panel().queryByRole('button', { name: 'Hidden at first' })).toBeNull();
    expect(panel().queryByRole('button', { name: 'Hangs from the roof' })).toBeNull();
    // An NPC is in a scene once.
    for (const button of tray().getAllByRole('button', { name: 'Add Old Keeper' })) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.textContent).toContain('In the scene');
      // And a click on it adds nothing.
      fireEvent.click(button);
    }

    expect(drawn(stage)).toHaveLength(2);
    const objects = await lastSave(fetchMock, objectsPath);
    expect(objects[1]).toMatchObject({ recordId: keeper.id });
    expect(objects[1]).not.toHaveProperty('shown');
    expect(objects[1]).not.toHaveProperty('mount');
  });

  it('removes the selected object', async () => {
    const { pendant, stage, fetchMock, objectsPath } = await openBuilder(({ well, pendant }) => [
      saved(well.id),
      saved(pendant.id, { across: 0.2 }),
    ]);
    press(drawn(stage)[0]?.id ?? '');

    fireEvent.click(panel().getByRole('button', { name: 'Remove from scene' }));

    expect(drawn(stage)).toHaveLength(1);
    expect(stage.dataset['selected']).toBe('');
    expect(panel().getByText(/Select something in the theater/)).toBeDefined();
    expect(await lastSave(fetchMock, objectsPath)).toEqual([
      expect.objectContaining({ recordId: pendant.id }),
    ]);
  });

  it('selects from the theater and from the list, and lets go again', async () => {
    const { stage } = await openBuilder(({ well, pendant }) => [
      saved(well.id),
      saved(pendant.id, { across: 0.2 }),
    ]);
    const [first, second] = drawn(stage);
    const list = () => within(panel().getByRole('region', { name: 'In this scene' }));

    press(second?.id ?? '');
    expect(stage.dataset['selected']).toBe(second?.id);
    expect(panel().getByRole('heading', { name: 'Tide Pendant' })).toBeDefined();

    fireEvent.click(list().getByRole('button', { name: /Stone Well/ }));
    expect(stage.dataset['selected']).toBe(first?.id);
    expect(
      list()
        .getByRole('button', { name: /Stone Well/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    // A press beside every cutout lets go.
    press(null);
    expect(stage.dataset['selected']).toBe('');
    expect(panel().queryByRole('heading', { name: 'Stone Well' })).toBeNull();
  });

  it('shows the scene as players first see it in Preview', async () => {
    const { stage } = await openBuilder(({ well, pendant, keeper }) => [
      saved(well.id),
      saved(pendant.id, { across: 0.2, shown: false }),
      saved(keeper.id, { across: 0.8, up: 0.2 }),
    ]);
    expect(drawn(stage).map((cutout) => [cutout.faded, cutout.lowered])).toEqual([
      [false, false],
      [true, false],
      [false, false],
    ]);
    press(drawn(stage)[0]?.id ?? '');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    // The hidden pendant is gone and the keeper waits below.
    expect(drawn(stage).map((cutout) => [cutout.mount, cutout.lowered])).toEqual([
      ['stand', false],
      ['stick', true],
    ]);
    expect(stage.dataset['selected']).toBe('');
    expect(screen.getByText(/This is the scene as players first see it/)).toBeDefined();
    expect(screen.queryByRole('complementary', { name: 'Tray' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Scene objects' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(drawn(stage)).toHaveLength(3);
    expect(screen.getByRole('complementary', { name: 'Tray' })).toBeDefined();
  });

  it('stops adding once the scene is full', async () => {
    await openBuilder(({ well }) =>
      Array.from({ length: SCENE_MAX_OBJECTS }, (_unused, index) =>
        saved(well.id, { across: index / SCENE_MAX_OBJECTS }),
      ),
    );

    expect(placedCount()).toBe(
      `${String(SCENE_MAX_OBJECTS)} of ${String(SCENE_MAX_OBJECTS)} placed`,
    );
    const add = await tray().findByRole('button', { name: 'Add Tide Pendant' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('draggable')).toBe('false');
    expect(add.textContent).toContain('The scene is full');
    fireEvent.click(add);
    expect(placedCount()).toBe(
      `${String(SCENE_MAX_OBJECTS)} of ${String(SCENE_MAX_OBJECTS)} placed`,
    );
  });

  it('changes the backdrop to another Spot, or to a bare wall', async () => {
    const { cellar, coast, stage, sceneId, fetchMock } = await openBuilder(({ well }) => [
      saved(well.id),
    ]);
    const backdrop = screen.getByLabelText<HTMLSelectElement>('Backdrop');
    await within(backdrop).findByRole('option', {
      name: 'Bare Cellar (Saltmarsh) (no backdrop yet)',
    });

    fireEvent.change(backdrop, { target: { value: cellar.id } });

    // The cellar has no image yet: a bare wall, and a way to get one.
    expect(await screen.findByText(/Bare Cellar has no backdrop yet/)).toBeDefined();
    expect(stage.dataset['backdrop']).toBe('');
    expect(screen.getByRole('link', { name: 'Open Bare Cellar' }).getAttribute('href')).toBe(
      `/campaigns/${coast.id}/records/${cellar.id}`,
    );
    expect(await screen.findByRole('region', { name: 'Suggested for Bare Cellar' })).toBeDefined();
    // What is placed stays where it was.
    expect(drawn(stage)).toHaveLength(1);

    fireEvent.change(backdrop, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.queryByText(/has no backdrop yet/)).toBeNull();
    });
    expect(screen.queryByRole('region', { name: /Suggested for/ })).toBeNull();
    expect(bodiesTo(fetchMock, `/scenes/${sceneId}`, 'PATCH')).toEqual([
      { spotId: cellar.id },
      { spotId: null },
    ]);
  });

  it('renames the scene', async () => {
    const { sceneId, fetchMock } = await openBuilder();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Scene name'), { target: { value: 'Market at dusk' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByRole('heading', { name: 'Market at dusk' })).toBeDefined();
    expect(bodiesTo(fetchMock, `/scenes/${sceneId}`, 'PATCH')).toEqual([
      { name: 'Market at dusk' },
    ]);
  });

  it('says when a save fails, and saves everything on Retry', async () => {
    const { stage, fetchMock, objectsPath } = await openBuilder(({ well }) => [saved(well.id)]);
    press(drawn(stage)[0]?.id ?? '');
    const restore = failRequests(fetchMock, 'PUT', 500, 'The server is having a moment');

    fireEvent.change(panel().getByLabelText('Height'), { target: { value: '0.4' } });

    const alert = await screen.findByRole('alert', undefined, { timeout: 3000 });
    expect(alert.textContent).toContain("Couldn't save: The server is having a moment");

    restore();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await lastSave(fetchMock, objectsPath)).toEqual([expect.objectContaining({ up: 0.4 })]);
  });

  it('opens a saved scene as it was left', async () => {
    const { stage, well, keeper } = await openBuilder(({ well, keeper }) => [
      saved(well.id, {
        across: 0.1,
        up: 0.7,
        depthTick: 8,
        scale: 2,
        flipped: true,
        mount: 'hang',
      }),
      saved(keeper.id, { across: 0.9, up: 0.3, depthTick: 1 }),
    ]);

    expect(drawn(stage)).toEqual([
      expect.objectContaining({
        across: 0.1,
        up: 0.7,
        depthTick: 8,
        scale: 2,
        flipped: true,
        mount: 'hang',
        url: expect.stringContaining(well.visualAssetId ?? 'none') as string,
      }),
      expect.objectContaining({
        across: 0.9,
        up: 0.3,
        depthTick: 1,
        mount: 'stick',
        url: expect.stringContaining(keeper.visualAssetId ?? 'none') as string,
      }),
    ]);
    expect(placedCount()).toBe(`2 of ${String(SCENE_MAX_OBJECTS)} placed`);
  });

  it('opens records in a new tab, so the builder stays open behind them', async () => {
    const { stage } = await openBuilder(({ well }) => [saved(well.id)]);
    press(drawn(stage)[0]?.id ?? '');

    for (const link of [
      tray().getByRole('link', { name: 'Open Coil of Rope' }),
      panel().getByRole('link', { name: 'Open record' }),
    ]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
    }
  });

  it('opens a Spot with no backdrop in a new tab too', async () => {
    await openBuilder(() => [], { spot: 'cellar' });

    const link = screen.getByRole('link', { name: 'Open Bare Cellar' });
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('moves a cutout that is dragged in the theater, and saves where it was left', async () => {
    const { stage, fetchMock, objectsPath } = await openBuilder(({ well, pendant }) => [
      saved(well.id, { depthTick: 7 }),
      saved(pendant.id, { across: 0.2 }),
    ]);
    const [well] = drawn(stage);
    expect(stage.dataset['editable']).toBe('true');

    // The theater reports the drag as it goes.
    press(well?.id ?? '');
    act(() => {
      canvasProps?.onMove(well?.id ?? '', { across: 0.6, up: 0.1 });
      canvasProps?.onMove(well?.id ?? '', { across: 0.72, up: 0.33 });
    });

    expect(drawn(stage)).toEqual([
      expect.objectContaining({ id: well?.id, across: 0.72, up: 0.33, depthTick: 7 }),
      expect.objectContaining({ across: 0.2, up: 0 }),
    ]);
    expect(panel().getByLabelText<HTMLInputElement>('Left to right').value).toBe('0.72');
    // One save, of where the drag ended.
    expect(await lastSave(fetchMock, objectsPath)).toEqual([
      expect.objectContaining({ id: well?.id, across: 0.72, up: 0.33 }),
      expect.objectContaining({ across: 0.2 }),
    ]);
    expect(bodiesTo(fetchMock, objectsPath, 'PUT')).toHaveLength(1);
  });

  it('keeps a dragged cutout inside the opening', async () => {
    const { stage } = await openBuilder(({ well }) => [saved(well.id)]);
    const [well] = drawn(stage);

    act(() => {
      canvasProps?.onMove(well?.id ?? '', { across: 1.4, up: -0.3 });
    });

    expect(drawn(stage)).toEqual([expect.objectContaining({ across: 1, up: 0 })]);
  });

  it('drops a record dragged from the tray where the pointer let go of it', async () => {
    const { pendant, keeper, stage, fetchMock, objectsPath } = await openBuilder();
    const row = await tray().findByRole('button', { name: 'Add Tide Pendant' });
    expect(row.getAttribute('draggable')).toBe('true');

    // The row carries its record's id as it is dragged.
    const setData = vi.fn();
    fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: 'none' } });
    expect(setData).toHaveBeenCalledWith('application/x-stagehand-record', pendant.id);

    act(() => {
      canvasProps?.onDropRecord(pendant.id, { across: 0.3, up: 0.45 });
      // A puppet from the Spot's suggestions, dropped too.
      canvasProps?.onDropRecord(keeper.id, { across: 0.8, up: 0.2 });
    });

    expect(drawn(stage)).toEqual([
      expect.objectContaining({ across: 0.3, up: 0.45, depthTick: 5, mount: 'stand' }),
      expect.objectContaining({ across: 0.8, up: 0.2, depthTick: 5, mount: 'stick' }),
    ]);
    // The last one dropped is selected.
    expect(panel().getByRole('heading', { name: 'Old Keeper' })).toBeDefined();
    expect(await lastSave(fetchMock, objectsPath)).toEqual([
      expect.objectContaining({ recordId: pendant.id, across: 0.3, up: 0.45 }),
      expect.objectContaining({ recordId: keeper.id, across: 0.8, up: 0.2 }),
    ]);
  });

  it('puts a dropped record at the usual place when the theater cannot say where', async () => {
    const { pendant, keeper, rope, stage } = await openBuilder(({ keeper }) => [saved(keeper.id)]);
    await tray().findByRole('button', { name: 'Add Tide Pendant' });

    act(() => {
      canvasProps?.onDropRecord(pendant.id, null);
      // Refused like a click would be: a puppet already placed, a record with no image, and
      // an id that is no record of the tray.
      canvasProps?.onDropRecord(keeper.id, { across: 0.1, up: 0.1 });
      canvasProps?.onDropRecord(rope.id, { across: 0.1, up: 0.1 });
      canvasProps?.onDropRecord(uuid(), { across: 0.1, up: 0.1 });
    });

    expect(drawn(stage)).toHaveLength(2);
    expect(drawn(stage)[1]).toMatchObject({ up: 0, depthTick: 5, mount: 'stand' });
  });

  it('nudges, steps, removes and lets go of the selected object with keys', async () => {
    const { stage, fetchMock, objectsPath } = await openBuilder(({ well, pendant }) => [
      saved(well.id, { across: 0.5, up: 0.5 }),
      saved(pendant.id, { across: 0.2 }),
    ]);
    const [well, pendant] = drawn(stage);
    const key = (name: string, init: KeyboardEventInit = {}) =>
      fireEvent.keyDown(document.body, { key: name, ...init });

    // With nothing selected, keys do nothing.
    key('ArrowRight');
    expect(drawn(stage)[0]).toMatchObject({ across: 0.5 });

    press(well?.id ?? '');
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowLeft', { shiftKey: true });
    key('ArrowUp');
    key('ArrowDown', { shiftKey: true });
    key(']');
    key(']');
    key('[');
    expect(drawn(stage)[0]).toMatchObject({ across: 0.47, up: 0.46, depthTick: 6 });
    // A browser shortcut is left alone.
    key('ArrowRight', { ctrlKey: true });
    expect(drawn(stage)[0]).toMatchObject({ across: 0.47 });

    // Typing in the tray's search moves nothing.
    const search = tray().getByLabelText('Search the tray');
    fireEvent.keyDown(search, { key: 'ArrowLeft' });
    fireEvent.keyDown(search, { key: 'Backspace' });
    expect(drawn(stage)).toHaveLength(2);
    expect(drawn(stage)[0]).toMatchObject({ across: 0.47 });

    key('Escape');
    expect(stage.dataset['selected']).toBe('');

    press(pendant?.id ?? '');
    key('Delete');
    expect(drawn(stage)).toEqual([expect.objectContaining({ id: well?.id })]);
    expect(stage.dataset['selected']).toBe('');
    expect(await lastSave(fetchMock, objectsPath)).toEqual([
      expect.objectContaining({ id: well?.id, across: 0.47, up: 0.46, depthTick: 6 }),
    ]);
  });

  it("lights the selected object's depth tick, and follows it as it steps", async () => {
    const { stage } = await openBuilder(({ well }) => [saved(well.id, { depthTick: 3 })]);
    expect(stage.dataset['guideTick']).toBe('');

    press(drawn(stage)[0]?.id ?? '');
    expect(stage.dataset['guideTick']).toBe('3');

    fireEvent.click(panel().getByRole('button', { name: 'Step back' }));
    expect(stage.dataset['guideTick']).toBe('4');

    // No guides in the players' view.
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(stage.dataset['guideTick']).toBe('');
  });

  it('looks around with the editing camera, but previews from the players’ locked seat', async () => {
    const { stage } = await openBuilder(({ well }) => [saved(well.id)]);
    const lookAround = screen.getByRole('button', { name: 'Look around' });
    expect(stage.dataset['lookAround']).toBe('false');

    fireEvent.click(lookAround);
    expect(stage.dataset['lookAround']).toBe('true');
    expect(lookAround.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(stage.dataset['lookAround']).toBe('false');
    expect(stage.dataset['editable']).toBe('false');
    expect(lookAround).toHaveProperty('disabled', true);

    // Back to building: still looking around.
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(stage.dataset['lookAround']).toBe('true');
    expect(stage.dataset['editable']).toBe('true');

    fireEvent.click(lookAround);
    expect(stage.dataset['lookAround']).toBe('false');
  });

  it('is read-only while the campaign is archived', async () => {
    const { stage } = await openBuilder(({ well }) => [saved(well.id)], {
      overrides: { archivedAt: '2026-11-14T09:00:00.000Z' },
    });

    expect(screen.getByText(/This campaign is archived, so this scene is read-only/)).toBeDefined();
    expect(screen.queryByRole('complementary', { name: 'Tray' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.getByLabelText('Backdrop')).toHaveProperty('disabled', true);
    expect(stage.dataset['editable']).toBe('false');

    press(drawn(stage)[0]?.id ?? '');
    expect(panel().getByLabelText('Height')).toHaveProperty('disabled', true);
    expect(panel().getByRole('button', { name: 'Remove from scene' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('keeps players out, and says when a scene is gone', async () => {
    const sceneId = uuid();
    const player = world({
      scenes: () => [{ id: sceneId, name: 'Secret' }],
      overrides: { role: 'player' },
    });
    renderAt(sceneUrl(player.coast, sceneId));
    expect(await screen.findByText(/Only the GM builds scenes/)).toBeDefined();
    expect(screen.queryByTestId('scene-canvas')).toBeNull();
  });

  it('says when the scene is not found', async () => {
    const { coast } = world();
    renderAt(sceneUrl(coast, uuid()));

    expect(await screen.findByRole('heading', { name: 'Scene not found' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Back to scenes' }).getAttribute('href')).toBe(
      scenesUrl(coast),
    );
  });
});

describe('Likely next scenes (F5.2)', () => {
  /** The Docks, opened in the builder, and seven other scenes it could lead to. */
  async function openDocks(nextOf: (ids: string[]) => string[] = () => []) {
    const docks = uuid();
    const others = [
      'Warehouse fire',
      'Harbour master',
      'Lighthouse',
      'Smugglers cave',
      'Tavern',
      'Old pier',
      'Chapel',
    ].map((name) => ({ id: uuid(), name }));
    const built = world({
      scenes: () => [
        { id: docks, name: 'The Docks', nextSceneIds: nextOf(others.map((scene) => scene.id)) },
        ...others,
      ],
    });
    renderAt(sceneUrl(built.coast, docks));
    await canvas();
    return { ...built, docks, others };
  }

  const dialog = () => within(screen.getByRole('dialog'));
  const listed = () =>
    dialog()
      .queryAllByRole('listitem')
      .map((item) => item.textContent);
  const options = () =>
    [...dialog().getByLabelText<HTMLSelectElement>('Add a scene').options]
      .map((option) => option.textContent)
      .slice(1);

  it('adds scenes in order, never the scene itself or one already listed', async () => {
    const { docks, fetchMock } = await openDocks();
    fireEvent.click(screen.getByRole('button', { name: 'Likely next (0)' }));
    expect(await dialog().findByText('None yet.')).toBeDefined();
    await waitFor(() => {
      expect(options()).toHaveLength(7);
    });
    expect(options()).not.toContain('The Docks');

    const add = (name: string) => {
      const select = dialog().getByLabelText<HTMLSelectElement>('Add a scene');
      const option = [...select.options].find((entry) => entry.textContent === name);
      fireEvent.change(select, { target: { value: option?.value } });
    };
    add('Warehouse fire');
    await waitFor(() => {
      expect(listed()).toHaveLength(1);
    });
    add('Lighthouse');
    await waitFor(() => {
      expect(listed()).toHaveLength(2);
    });
    expect(listed()[0]).toContain('Warehouse fire');
    expect(listed()[1]).toContain('Lighthouse');
    expect(options()).not.toContain('Warehouse fire');
    fireEvent.click(dialog().getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: 'Likely next (2)' })).toBeDefined();

    const bodies = bodiesTo(fetchMock, `/scenes/${docks}`, 'PATCH') as { nextSceneIds: string[] }[];
    expect(bodies.map((body) => body.nextSceneIds.length)).toEqual([1, 2]);
  });

  it('moves a scene up and down, and removes one', async () => {
    const { docks, others, fetchMock } = await openDocks((ids) => ids.slice(0, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Likely next (3)' }));
    const [fire, master, light] = others;

    expect(dialog().getByRole('button', { name: 'Move Warehouse fire up' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(dialog().getByRole('button', { name: 'Move Lighthouse down' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(dialog().getByRole('button', { name: 'Move Lighthouse up' }));
    await waitFor(() => {
      expect(listed()[1]).toContain('Lighthouse');
    });
    fireEvent.click(dialog().getByRole('button', { name: 'Move Warehouse fire down' }));
    await waitFor(() => {
      expect(listed()[0]).toContain('Lighthouse');
    });
    fireEvent.click(dialog().getByRole('button', { name: 'Remove Harbour master' }));
    await waitFor(() => {
      expect(listed()).toHaveLength(2);
    });

    expect(bodiesTo(fetchMock, `/scenes/${docks}`, 'PATCH')).toEqual([
      { nextSceneIds: [fire?.id, light?.id, master?.id] },
      { nextSceneIds: [light?.id, fire?.id, master?.id] },
      { nextSceneIds: [light?.id, fire?.id] },
    ]);
  });

  it('stops adding at six', async () => {
    await openDocks((ids) => ids.slice(0, 6));
    fireEvent.click(screen.getByRole('button', { name: 'Likely next (6)' }));
    const select = dialog().getByLabelText<HTMLSelectElement>('Add a scene');
    expect(select.disabled).toBe(true);
    expect(select.options[0]?.textContent).toBe('6 of 6: remove one to add another');
  });

  it('shows the list but no changes while the campaign is archived', async () => {
    const docks = uuid();
    const fire = uuid();
    const built = world({
      scenes: () => [
        { id: docks, name: 'The Docks', nextSceneIds: [fire] },
        { id: fire, name: 'Warehouse fire' },
      ],
      overrides: { archivedAt: '2026-11-14T09:00:00.000Z' },
    });
    renderAt(sceneUrl(built.coast, docks));
    await canvas();
    fireEvent.click(screen.getByRole('button', { name: 'Likely next (1)' }));
    expect(listed()[0]).toContain('Warehouse fire');
    expect(dialog().queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(dialog().queryByLabelText('Add a scene')).toBeNull();
  });
});
