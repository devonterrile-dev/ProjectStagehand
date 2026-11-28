import { PLAY_SOCKET, type LiveStage } from '@stagehand/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakePlaySocket, type FakePlaySocket } from '@/test/fake-play-socket';
import { gmStage, playerStage, present, stageImage } from '@/test/play-fixtures';

import {
  createPlayRoom,
  CURTAIN_CLOSE_MS,
  MOVE_GAP_MS,
  NO_ANSWER,
  RETRY_MS,
  SPEAKING_GAP_MS,
  type PlayRoom,
} from './room';

const CAMPAIGN = 'campaign-1';
const urlOf = (n: number) => `/api/campaigns/${CAMPAIGN}/assets/${stageImage(n).assetId}/image?p=3`;

/** Image loads the test finishes by hand, to stand at each point of a scene change. */
function manualPreload() {
  const loads: { urls: readonly string[]; finish: () => void }[] = [];
  const preload = (urls: readonly string[]) =>
    new Promise<void>((resolve) => {
      loads.push({ urls, finish: resolve });
    });
  return { loads, preload };
}

describe('the live room, from the browser', () => {
  let socket: FakePlaySocket;
  let images: ReturnType<typeof manualPreload>;
  let room: PlayRoom;

  const state = () => room.store.getState();
  /** Lets answered requests and finished image loads take effect. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    socket = fakePlaySocket();
    images = manualPreload();
    room = createPlayRoom(CAMPAIGN, { socket, preload: images.preload });
  });

  afterEach(() => {
    room.close();
    vi.useRealTimers();
  });

  /** Opens the room, connects, and answers the join. */
  async function joinWith(answer: unknown) {
    room.open();
    socket.receive('connect');
    socket.last(PLAY_SOCKET.join).answer(answer);
    await settle();
  }

  /** In the session, with the first stage's images loaded and the curtain as it says. */
  async function joined(stage: LiveStage = playerStage(), presence = [present(1, 'Mira')]) {
    await joinWith({ status: 'joined', stage, presence });
    images.loads.at(-1)?.finish();
    await settle();
  }

  describe('joining', () => {
    it('connects only when opened, then asks to join its campaign', () => {
      expect(socket.connects).toBe(0);
      expect(state()).toMatchObject({ phase: 'connecting', connected: false });

      room.open();
      room.open();
      expect(socket.connects).toBe(1);

      socket.receive('connect');
      expect(state().connected).toBe(true);
      expect(socket.requests).toHaveLength(1);
      expect(socket.requests[0]).toMatchObject({
        event: PLAY_SOCKET.join,
        payload: { campaignId: CAMPAIGN },
      });
    });

    it('holds the theater shut until the first stage’s images have loaded', async () => {
      const stage = playerStage();
      await joinWith({ status: 'joined', stage, presence: [present(1, 'Mira')] });

      expect(state()).toMatchObject({ phase: 'joined', stage, view: null });
      expect(state().presence).toEqual([present(1, 'Mira')]);
      expect([...(images.loads[0]?.urls ?? [])].sort()).toEqual([urlOf(0), urlOf(1)].sort());

      images.loads[0]?.finish();
      await settle();
      expect(state().view).toEqual({ stage, curtainOpen: true });
    });

    it.each([
      ['no-session', 'waiting'],
      ['full', 'full'],
      ['not-found', 'not-found'],
    ] as const)('shows a %s answer as %s', async (status, phase) => {
      await joinWith({ status });

      expect(state()).toMatchObject({ phase, stage: null, view: null, presence: [] });
    });

    it('joins by itself when the session it was waiting for starts', async () => {
      await joinWith({ status: 'no-session' });

      socket.receive(PLAY_SOCKET.started);
      expect(socket.requests).toHaveLength(2);
      socket.last(PLAY_SOCKET.join).answer({
        status: 'joined',
        stage: playerStage({ sceneLoad: 0, curtainOpen: false, backdrop: null, objects: [] }),
        presence: [],
      });
      await settle();

      expect(state().phase).toBe('joined');
    });

    it('asks again when told to, after the session was full', async () => {
      await joinWith({ status: 'full' });

      room.join();

      expect(socket.requests).toHaveLength(2);
    });

    it('asks again after a join that got no answer, or a garbled one', async () => {
      room.open();
      socket.receive('connect');
      socket.last(PLAY_SOCKET.join).fail();
      await settle();
      expect(socket.requests).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(socket.requests).toHaveLength(2);

      socket.last(PLAY_SOCKET.join).answer({ status: 'joined', stage: 'nonsense' });
      await settle();
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(socket.requests).toHaveLength(3);
      expect(state().phase).toBe('connecting');
    });

    it('uses only the newest join’s answer', async () => {
      room.open();
      socket.receive('connect');
      const first = socket.last(PLAY_SOCKET.join);
      socket.receive(PLAY_SOCKET.started);
      const second = socket.last(PLAY_SOCKET.join);

      second.answer({ status: 'full' });
      first.answer({ status: 'not-found' });
      await settle();

      expect(state().phase).toBe('full');
    });
  });

  describe('while joined', () => {
    it('shows a curtain move and a change on stage at once', async () => {
      await joined();

      const closed = playerStage({ curtainOpen: false });
      socket.receive(PLAY_SOCKET.stage, closed);
      expect(state().view).toEqual({ stage: closed, curtainOpen: false });

      const emptied = playerStage({ objects: [] });
      socket.receive(PLAY_SOCKET.stage, emptied);
      expect(state()).toMatchObject({
        stage: emptied,
        view: { stage: emptied, curtainOpen: true },
      });
      expect(images.loads).toHaveLength(1);
    });

    it('changes scene behind the curtain: close, load, swap, open', async () => {
      const market = playerStage();
      await joined(market);
      const cellar = playerStage({ sceneLoad: 2, backdrop: stageImage(7), objects: [] });

      socket.receive(PLAY_SOCKET.stage, cellar);
      // The desk already describes the new stage; the theater still shows the old one, closing.
      expect(state().stage).toEqual(cellar);
      expect(state().view).toEqual({ stage: market, curtainOpen: false });
      expect(images.loads).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(CURTAIN_CLOSE_MS - 1);
      expect(images.loads).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(images.loads).toHaveLength(2);
      expect(images.loads[1]?.urls).toEqual([urlOf(7)]);
      expect(state().view).toEqual({ stage: market, curtainOpen: false });

      images.loads[1]?.finish();
      await settle();
      expect(state().view).toEqual({ stage: cellar, curtainOpen: true });
    });

    it('opens on the newest scene when a second one is loaded mid-change', async () => {
      await joined();
      const cellar = playerStage({ sceneLoad: 2, backdrop: stageImage(7), objects: [] });
      const attic = playerStage({ sceneLoad: 3, backdrop: stageImage(8), objects: [] });

      socket.receive(PLAY_SOCKET.stage, cellar);
      await vi.advanceTimersByTimeAsync(CURTAIN_CLOSE_MS);
      socket.receive(PLAY_SOCKET.stage, attic);
      expect(images.loads[2]?.urls).toEqual([urlOf(8)]);

      // The first scene's images arrive late: they are no longer what is waited for.
      images.loads[1]?.finish();
      await settle();
      expect(state().view?.stage.sceneLoad).toBe(1);

      images.loads[2]?.finish();
      await settle();
      expect(state().view).toEqual({ stage: attic, curtainOpen: true });
    });

    it('keeps the list of who is here up to date', async () => {
      await joined();

      socket.receive(PLAY_SOCKET.presence, [present(1, 'Mira'), present(2, 'Sam')]);
      expect(state().presence.map((person) => person.displayName)).toEqual(['Mira', 'Sam']);

      socket.receive(PLAY_SOCKET.presence, [{ displayName: 'no id' }]);
      expect(state().presence).toHaveLength(2);
    });

    it('ignores a stage that is not one', async () => {
      const stage = playerStage();
      await joined(stage);

      socket.receive(PLAY_SOCKET.stage, { role: 'player', objects: 'everything' });

      expect(state().stage).toEqual(stage);
    });

    it('empties the theater when the GM ends the session, and comes back for the next', async () => {
      await joined();

      socket.receive(PLAY_SOCKET.ended);
      expect(state()).toMatchObject({ phase: 'ended', stage: null, view: null, presence: [] });

      socket.receive(PLAY_SOCKET.started);
      socket.last(PLAY_SOCKET.join).answer({
        status: 'joined',
        stage: playerStage(),
        presence: [],
      });
      await settle();
      expect(state().phase).toBe('joined');
    });

    it('drops a scene change in progress when the session ends', async () => {
      await joined();
      socket.receive(PLAY_SOCKET.stage, playerStage({ sceneLoad: 2 }));

      socket.receive(PLAY_SOCKET.ended);
      await vi.advanceTimersByTimeAsync(CURTAIN_CLOSE_MS);
      for (const load of images.loads) load.finish();
      await settle();

      expect(state()).toMatchObject({ phase: 'ended', view: null });
      expect(images.loads).toHaveLength(1);
    });
  });

  describe('the journal (F3.5b)', () => {
    it('counts each time the journal may have changed: a join, and the server saying so', async () => {
      socket.receive(PLAY_SOCKET.journalChanged);
      expect(state().journal).toBe(0);

      await joined();
      expect(state().journal).toBe(1);
      socket.receive(PLAY_SOCKET.journalChanged);
      socket.receive(PLAY_SOCKET.journalChanged);
      expect(state().journal).toBe(3);
    });
  });

  describe('rolls, Hope and Fear (F3.6)', () => {
    it('counts sheet changes with the PC they were for, and log changes', async () => {
      const vex = '00000000-0000-4000-8000-000000000101';
      socket.receive(PLAY_SOCKET.sheetChanged, { characterId: vex });
      expect(state().sheet).toBe(0);

      await joined();
      // A join may have missed a change to any sheet.
      expect(state()).toMatchObject({ sheet: 1, sheetChanged: null, log: 1 });
      socket.receive(PLAY_SOCKET.sheetChanged, { characterId: vex });
      expect(state()).toMatchObject({ sheet: 2, sheetChanged: vex });
      socket.receive(PLAY_SOCKET.sheetChanged, 'nonsense');
      expect(state().sheet).toBe(2);
      socket.receive(PLAY_SOCKET.logChanged);
      expect(state().log).toBe(2);
    });

    it('sends the rolls and corrections, and a player’s roll', async () => {
      await joined(gmStage());

      const calling = room.callRolls({
        characterIds: ['pc-1', 'pc-2'],
        trait: 'agility',
        difficulty: 12,
        hidden: true,
        edge: 'advantage',
      });
      expect(socket.last(PLAY_SOCKET.callRoll).payload).toEqual({
        characterIds: ['pc-1', 'pc-2'],
        trait: 'agility',
        difficulty: 12,
        hidden: true,
        edge: 'advantage',
      });
      socket.last(PLAY_SOCKET.callRoll).answer({ ok: true });
      expect(await calling).toEqual({ ok: true });

      void room.cancelRoll('call-1');
      expect(socket.last(PLAY_SOCKET.cancelRoll).payload).toEqual({ callId: 'call-1' });
      void room.revealRoll('roll-1');
      expect(socket.last(PLAY_SOCKET.revealRoll).payload).toEqual({ rollId: 'roll-1' });
      void room.makeRoll('call-2', true);
      expect(socket.last(PLAY_SOCKET.makeRoll).payload).toEqual({
        callId: 'call-2',
        spendHope: true,
      });
      void room.spendFear(2, 'The bridge gives way');
      expect(socket.last(PLAY_SOCKET.spendFear).payload).toEqual({
        amount: 2,
        reason: 'The bridge gives way',
      });
      void room.spendFear(1);
      expect(socket.last(PLAY_SOCKET.spendFear).payload).toEqual({ amount: 1 });
      void room.setFear(5);
      expect(socket.last(PLAY_SOCKET.setFear).payload).toEqual({ fear: 5 });
      void room.setHope('pc-1', 4);
      expect(socket.last(PLAY_SOCKET.setHope).payload).toEqual({ characterId: 'pc-1', hope: 4 });
      void room.setRest(true);
      expect(socket.last(PLAY_SOCKET.setRest).payload).toEqual({ rest: true });
    });
  });

  describe('losing the connection', () => {
    it('keeps the stage on screen, then takes the fresh one after rejoining', async () => {
      const before = playerStage();
      await joined(before);

      socket.receive('disconnect', 'transport close');
      expect(state()).toMatchObject({ connected: false, phase: 'joined' });
      expect(state().view).toEqual({ stage: before, curtainOpen: true });
      expect(socket.connects).toBe(1);

      // Socket.IO reconnects by itself; the room joins again.
      socket.receive('connect');
      const after = playerStage({ curtainOpen: false });
      socket.last(PLAY_SOCKET.join).answer({ status: 'joined', stage: after, presence: [] });
      await settle();

      expect(state()).toMatchObject({ connected: true, phase: 'joined', stage: after });
      expect(state().view).toEqual({ stage: after, curtainOpen: false });
    });

    it('ignores the answer to a join sent before the drop', async () => {
      room.open();
      socket.receive('connect');
      const stale = socket.last(PLAY_SOCKET.join);

      socket.receive('disconnect', 'transport close');
      stale.answer({ status: 'joined', stage: playerStage(), presence: [] });
      await settle();

      expect(state()).toMatchObject({ phase: 'connecting', stage: null });
    });

    it('comes back when the server hung up on it, and takes the answer it gets', async () => {
      await joined();

      socket.receive('disconnect', 'io server disconnect');
      expect(socket.connects).toBe(1);
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(socket.connects).toBe(2);

      socket.receive('connect');
      socket.last(PLAY_SOCKET.join).answer({ status: 'not-found' });
      await settle();
      expect(state()).toMatchObject({ phase: 'not-found', view: null });
    });

    it('says so when the sign-in has run out, and stops trying', async () => {
      socket.willRetry = false;
      room.open();

      socket.receive('connect_error', new Error('unauthorized'));
      await vi.advanceTimersByTimeAsync(RETRY_MS * 3);

      expect(state().phase).toBe('signed-out');
      expect(socket.connects).toBe(1);
    });

    it('tries again after a refusal that is not about sign-in', async () => {
      socket.willRetry = false;
      room.open();

      socket.receive('connect_error', new Error('server error'));
      await vi.advanceTimersByTimeAsync(RETRY_MS);

      expect(state().phase).toBe('connecting');
      expect(socket.connects).toBe(2);
    });

    it('leaves it to Socket.IO when it is already trying again', async () => {
      room.open();

      socket.receive('connect_error', new Error('xhr poll error'));
      await vi.advanceTimersByTimeAsync(RETRY_MS * 3);

      expect(socket.connects).toBe(1);
    });
  });

  describe('the GM’s actions', () => {
    it('sends a scene to load and the curtain’s moves, and passes on the answer', async () => {
      await joined(gmStage());

      const loading = room.loadScene('scene-9');
      expect(socket.last(PLAY_SOCKET.loadScene).payload).toEqual({ sceneId: 'scene-9' });
      socket.last(PLAY_SOCKET.loadScene).answer({ ok: true });
      expect(await loading).toEqual({ ok: true });

      const closing = room.setCurtain(false);
      socket
        .last(PLAY_SOCKET.closeCurtain)
        .answer({ ok: false, message: 'Only the GM can do that' });
      expect(await closing).toEqual({ ok: false, message: 'Only the GM can do that' });

      const opening = room.setCurtain(true);
      socket.last(PLAY_SOCKET.openCurtain).answer({ ok: true });
      expect(await opening).toEqual({ ok: true });
    });

    it('says the server did not answer when it didn’t, or answered nonsense', async () => {
      await joined(gmStage());

      const lost = room.setCurtain(true);
      socket.last(PLAY_SOCKET.openCurtain).fail();
      expect(await lost).toEqual({ ok: false, message: NO_ANSWER });

      const garbled = room.loadScene('scene-9');
      socket.last(PLAY_SOCKET.loadScene).answer('fine');
      expect(await garbled).toEqual({ ok: false, message: NO_ANSWER });
    });

    it('sends the desk’s actions (F3.4)', async () => {
      const stage = gmStage();
      await joined(stage);
      const [well, , marta] = stage.objects;

      void room.addObject({ id: 'new-1', characterId: 'pc-1' });
      expect(socket.last(PLAY_SOCKET.addObject).payload).toEqual({
        id: 'new-1',
        characterId: 'pc-1',
      });
      void room.removeObject(well?.id ?? '');
      expect(socket.last(PLAY_SOCKET.removeObject).payload).toEqual({ id: well?.id });
      for (const [object, shown, event] of [
        [well, false, PLAY_SOCKET.hideProp],
        [well, true, PLAY_SOCKET.showProp],
        [marta, true, PLAY_SOCKET.raisePuppet],
        [marta, false, PLAY_SOCKET.lowerPuppet],
      ] as const) {
        if (object === undefined) throw new Error('missing fixture');
        void room.setShown(object, shown);
        expect(socket.last(event).payload).toEqual({ id: object.id });
      }
    });

    describe('moves', () => {
      const moves = () =>
        socket.requests.filter((request) => request.event === PLAY_SOCKET.moveObject);

      it('shows a move at once, and sends what piles up meanwhile as one, after the gap', async () => {
        const stage = gmStage();
        await joined(stage);
        const id = stage.objects[0]?.id ?? '';

        const first = room.moveObject(id, { across: 0.2 });
        expect(state().pending).toEqual({ [id]: { across: 0.2 } });
        expect(moves().map((move) => move.payload)).toEqual([{ id, across: 0.2 }]);

        const second = room.moveObject(id, { across: 0.3 });
        const third = room.moveObject(id, { up: 0.4 });
        expect(state().pending).toEqual({ [id]: { across: 0.3, up: 0.4 } });
        expect(moves()).toHaveLength(1);

        moves()[0]?.answer({ ok: true });
        expect(await first).toEqual({ ok: true });
        await vi.advanceTimersByTimeAsync(MOVE_GAP_MS - 1);
        expect(moves()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(moves()[1]?.payload).toEqual({ id, across: 0.3, up: 0.4 });

        moves()[1]?.answer({ ok: true });
        expect(await second).toEqual({ ok: true });
        expect(await third).toEqual({ ok: true });
      });

      it('keeps a move on show until the stage has it, then lets the stage draw it', async () => {
        const stage = gmStage();
        await joined(stage);
        const [well, ...rest] = stage.objects;
        if (well === undefined) throw new Error('missing fixture');

        const moving = room.moveObject(well.id, { across: 0.9 });
        moves()[0]?.answer({ ok: true });
        await moving;
        // Answered, but the stage that has it has not come yet.
        expect(state().pending).toEqual({ [well.id]: { across: 0.9 } });

        socket.receive(PLAY_SOCKET.stage, {
          ...stage,
          objects: [{ ...well, across: 0.9 }, ...rest],
        });
        expect(state().pending).toEqual({});
      });

      it('drops a refused move, so the stage as the server has it is drawn', async () => {
        const stage = gmStage();
        await joined(stage);
        const id = stage.objects[0]?.id ?? '';

        const moving = room.moveObject(id, { depthTick: 9 });
        moves()[0]?.answer({ ok: false, message: 'That is no longer on the stage' });

        expect(await moving).toEqual({ ok: false, message: 'That is no longer on the stage' });
        expect(state().pending).toEqual({});
      });
    });

    describe('battle mode (F5.5)', () => {
      const marta = gmStage().objects[2]?.id ?? '';
      const battleStage = (square: { column: number; row: number } | null) =>
        gmStage({
          battle: { size: 'small', strokes: [], tokens: [{ id: marta, side: 'npc', square }] },
        });

      it('lays out a mat and rolls it up', async () => {
        await joined(gmStage());

        const starting = room.startBattle('medium');
        expect(socket.last(PLAY_SOCKET.startBattle).payload).toEqual({ size: 'medium' });
        socket.last(PLAY_SOCKET.startBattle).answer({ ok: true });
        expect(await starting).toEqual({ ok: true });

        void room.endBattle();
        expect(socket.last(PLAY_SOCKET.endBattle).payload).toEqual({});
      });

      it('shows a token move at once, until the stage has it', async () => {
        await joined(battleStage(null));

        const moving = room.moveToken(marta, { column: 2, row: 3 });
        expect(socket.last(PLAY_SOCKET.moveToken).payload).toEqual({
          id: marta,
          square: { column: 2, row: 3 },
        });
        expect(state().pendingTokens).toEqual({ [marta]: { column: 2, row: 3 } });

        socket.last(PLAY_SOCKET.moveToken).answer({ ok: true });
        await moving;
        // Answered, but the stage that has it has not come yet.
        expect(state().pendingTokens).toEqual({ [marta]: { column: 2, row: 3 } });

        socket.receive(PLAY_SOCKET.stage, battleStage({ column: 2, row: 3 }));
        expect(state().pendingTokens).toEqual({});
      });

      it('drops a refused token move, so the token goes back', async () => {
        await joined(battleStage(null));

        const moving = room.moveToken(marta, { column: 1, row: 1 });
        socket.last(PLAY_SOCKET.moveToken).answer({ ok: false, message: 'That square is taken' });

        expect(await moving).toEqual({ ok: false, message: 'That square is taken' });
        expect(state().pendingTokens).toEqual({});
      });
    });
  });

  describe('closing', () => {
    it('disconnects, forgets everything, and can be opened again', async () => {
      await joined();

      room.close();
      expect(socket.disconnects).toBe(1);
      expect(state()).toEqual({
        phase: 'connecting',
        connected: false,
        stage: null,
        view: null,
        presence: [],
        pending: {},
        pendingTokens: {},
        journal: 0,
        sheet: 0,
        sheetChanged: null,
        log: 0,
        emotes: {},
        lastFreeRoll: null,
      });

      // Nothing that arrives late changes a closed room.
      socket.receive(PLAY_SOCKET.stage, playerStage());
      socket.receive('connect');
      expect(state().phase).toBe('connecting');
      expect(socket.requests).toHaveLength(1);

      room.open();
      expect(socket.connects).toBe(2);
      socket.receive('connect');
      expect(socket.requests).toHaveLength(2);
    });
  });

  describe('free rolls (F4.2)', () => {
    const freeRoll = (n: number) => ({
      id: `00000000-0000-4000-a000-00000000080${String(n)}`,
      userId: '00000000-0000-4000-a000-000000000301',
      rollerName: 'Vex',
      die: 6,
      results: [5, 3],
      total: 8,
      private: false,
      at: '2026-11-20T12:00:00.000Z',
    });

    it('keeps the last free roll, ignores nonsense, and forgets it when the session ends', async () => {
      await joined();
      socket.receive(PLAY_SOCKET.freeRoll, freeRoll(1));
      socket.receive(PLAY_SOCKET.freeRoll, freeRoll(2));
      socket.receive(PLAY_SOCKET.freeRoll, { ...freeRoll(3), die: 7 });
      expect(state().lastFreeRoll).toEqual(freeRoll(2));
      socket.receive(PLAY_SOCKET.ended);
      expect(state().lastFreeRoll).toBeNull();
    });

    it('asks the server to roll, and gives back its answer', async () => {
      await joined();
      const answer = room.freeRoll(100, 3, true);
      expect(socket.last(PLAY_SOCKET.freeRoll).payload).toEqual({
        die: 100,
        count: 3,
        private: true,
      });
      socket.last(PLAY_SOCKET.freeRoll).answer({ ok: true });
      expect(await answer).toEqual({ ok: true });
    });
  });

  describe('puppet motion (F3.7)', () => {
    const PUPPET = '00000000-0000-4000-a000-000000000203';
    const played = (n: number, emote = 'wave') => ({
      id: `00000000-0000-4000-a000-00000000090${String(n)}`,
      objectId: PUPPET,
      emote,
    });

    it('keeps the last emote played on each object, and ignores nonsense', async () => {
      await joined();

      socket.receive(PLAY_SOCKET.emote, played(1));
      socket.receive(PLAY_SOCKET.emote, played(2, 'bow'));
      socket.receive(PLAY_SOCKET.emote, { objectId: PUPPET, emote: 'moonwalk' });
      expect(state().emotes).toEqual({ [PUPPET]: played(2, 'bow') });
    });

    it('forgets emotes when the session ends', async () => {
      await joined();
      socket.receive(PLAY_SOCKET.emote, played(1));
      socket.receive(PLAY_SOCKET.ended);
      expect(state().emotes).toEqual({});
    });

    it('asks the server to play an emote, and gives back its answer', async () => {
      await joined();

      const answer = room.emote(PUPPET, 'hop');
      expect(socket.last(PLAY_SOCKET.emote).payload).toEqual({ id: PUPPET, emote: 'hop' });
      socket.last(PLAY_SOCKET.emote).answer({ ok: false, message: 'Too quick: wait a moment' });
      expect(await answer).toEqual({ ok: false, message: 'Too quick: wait a moment' });
    });

    it('asks to voice an NPC and to give the voice back (F3.8)', async () => {
      await joined();

      const takeOver = room.takeOverNpc(PUPPET);
      expect(socket.last(PLAY_SOCKET.takeOverNpc).payload).toEqual({ id: PUPPET });
      socket.last(PLAY_SOCKET.takeOverNpc).answer({ ok: true });
      expect(await takeOver).toEqual({ ok: true });

      const release = room.releaseNpc();
      expect(socket.last(PLAY_SOCKET.releaseNpc).payload).toEqual({});
      socket.last(PLAY_SOCKET.releaseNpc).answer({ ok: true });
      expect(await release).toEqual({ ok: true });
    });

    const spoken = () =>
      socket.emitted
        .filter((sent) => sent.event === PLAY_SOCKET.speaking)
        .map((sent) => (sent.payload as { speaking: boolean }).speaking);

    it('tells the server when talking starts and stops, only changes, spaced out', async () => {
      await joined();

      room.setSpeaking(true);
      room.setSpeaking(true);
      expect(spoken()).toEqual([true]);

      // A quick stop and start again: only where it ends up is sent, after the gap.
      room.setSpeaking(false);
      room.setSpeaking(true);
      room.setSpeaking(false);
      expect(spoken()).toEqual([true]);
      await vi.advanceTimersByTimeAsync(SPEAKING_GAP_MS);
      expect(spoken()).toEqual([true, false]);
    });

    it('waits until it is in the session, and says it again after a reconnect', async () => {
      room.open();
      room.setSpeaking(true);
      expect(spoken()).toEqual([]);

      socket.receive('connect');
      socket.last(PLAY_SOCKET.join).answer({
        status: 'joined',
        stage: playerStage(),
        presence: [present(1, 'Mira')],
      });
      await settle();
      expect(spoken()).toEqual([true]);

      socket.receive('disconnect', 'transport close');
      socket.receive('connect');
      socket.last(PLAY_SOCKET.join).answer({
        status: 'joined',
        stage: playerStage(),
        presence: [present(1, 'Mira')],
      });
      await vi.advanceTimersByTimeAsync(SPEAKING_GAP_MS);
      expect(spoken()).toEqual([true, true]);
    });

    it('stops talking when the table is left', async () => {
      await joined();
      room.setSpeaking(true);
      room.close();
      expect(spoken()).toEqual([true, false]);
    });
  });
});
