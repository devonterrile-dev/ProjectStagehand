import { describe, expect, it } from 'vitest';

import {
  AT_STAGE,
  back,
  cameraView,
  inspect,
  noteSubjectOf,
  openBinder,
  openPage,
  openSheet,
  replacePage,
  startWriting,
  turnTo,
} from './table';

const LAMP = '00000000-0000-4000-8000-000000000001';
const MAP = '00000000-0000-4000-8000-000000000002';

describe('the inspect stage', () => {
  it('turns to it, picks up a sticky note, and backs out one step at a time', () => {
    const looking = inspect(LAMP);
    expect(cameraView(looking)).toBe('inspect');
    expect(noteSubjectOf(looking)).toEqual({ recordId: LAMP });

    const writing = startWriting(looking);
    expect(cameraView(writing)).toBe('note');

    expect(back(writing)).toEqual(looking);
    expect(back(looking)).toEqual(AT_STAGE);
    expect(back(AT_STAGE)).toBe(AT_STAGE);
  });
});

describe('the binder', () => {
  it('opens at the key, turns pages, and goes back one page at a time', () => {
    let state = openBinder();
    expect(openPage(state)).toEqual({ kind: 'key' });
    expect(cameraView(state)).toBe('binder');

    state = turnTo(state, { kind: 'records', type: 'npc' });
    state = turnTo(state, { kind: 'record', recordId: LAMP });
    expect(openPage(state)).toEqual({ kind: 'record', recordId: LAMP });

    state = back(state);
    expect(openPage(state)).toEqual({ kind: 'records', type: 'npc' });
    state = back(state);
    expect(openPage(state)).toEqual({ kind: 'key' });
    expect(back(state)).toEqual(AT_STAGE);
  });

  it('writes a note only on a record or entry page, and stays in the binder', () => {
    const key = openBinder();
    expect(noteSubjectOf(key)).toBeNull();
    expect(startWriting(key)).toBe(key);

    const entry = turnTo(turnTo(key, { kind: 'entries' }), { kind: 'entry', entryId: MAP });
    expect(noteSubjectOf(entry)).toEqual({ entryId: MAP });
    const writing = startWriting(entry);
    expect(writing).toMatchObject({ writing: true });
    expect(cameraView(writing)).toBe('binder');
    // Turning a page puts the note down.
    expect(turnTo(writing, { kind: 'key' })).toMatchObject({ writing: false });
    expect(back(writing)).toEqual(entry);
  });

  it('replaces a new entry’s blank page with the entry, so Back skips the blank', () => {
    let state = turnTo(turnTo(openBinder(), { kind: 'entries' }), { kind: 'new-entry' });
    state = replacePage(state, { kind: 'entry', entryId: MAP });
    expect(openPage(state)).toEqual({ kind: 'entry', entryId: MAP });
    expect(openPage(back(state))).toEqual({ kind: 'entries' });
  });

  it('ignores page turns while closed', () => {
    expect(turnTo(AT_STAGE, { kind: 'key' })).toBe(AT_STAGE);
    expect(replacePage(inspect(LAMP), { kind: 'key' })).toEqual(inspect(LAMP));
    expect(openPage(AT_STAGE)).toBeNull();
  });
});

describe('the sheet page (F3.6)', () => {
  it('looks down at it, writes no note on it, and steps straight back to the theater', () => {
    const sheet = openSheet();
    expect(cameraView(sheet)).toBe('sheet');
    expect(noteSubjectOf(sheet)).toBeNull();
    expect(startWriting(sheet)).toBe(sheet);
    expect(back(sheet)).toEqual(AT_STAGE);
  });
});

describe('a battle (F5.5)', () => {
  it('looks at the mat instead of the theater, and steps back to it from the sheet and binder', () => {
    expect(cameraView(AT_STAGE, true)).toBe('battle');
    expect(cameraView(AT_STAGE, false)).toBe('stage');
    expect(cameraView(openSheet(), true)).toBe('sheet');
    expect(cameraView(back(openSheet()), true)).toBe('battle');
    expect(cameraView(back(openBinder()), true)).toBe('battle');
  });
});
