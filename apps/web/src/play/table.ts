/**
 * Where a player is at the table (F3.5b, governance §12 "Views and camera"): looking at the
 * theater, inspecting a record on the inspect stage, reading the binder, or looking down at their
 * sheet page (F3.6), and whether they are writing a sticky note. Each browser keeps its own; nothing here is sent anywhere. Pure.
 */
import type { RecordType } from '@stagehand/shared';

import type { NoteSubjectRef } from '@/lib/api';
import type { StageView } from '@/stage/camera';

/** A page of the binder. */
export type BinderPage =
  /** The first page: a key to the record types, Player entries first. */
  | { kind: 'key' }
  /** Every revealed record of one type. */
  | { kind: 'records'; type: RecordType }
  /** Every player entry. */
  | { kind: 'entries' }
  | { kind: 'record'; recordId: string }
  | { kind: 'entry'; entryId: string }
  /** A blank page to write a new entry on. */
  | { kind: 'new-entry' };

export type TableState =
  | { at: 'stage' }
  | { at: 'inspect'; recordId: string; writing: boolean }
  /** `pages` is never empty: the last one is open, and Back turns to the one before. */
  | { at: 'binder'; pages: readonly BinderPage[]; writing: boolean }
  /** Looking down at their own sheet page (F3.6). */
  | { at: 'sheet' };

export const AT_STAGE: TableState = { at: 'stage' };

/** A stable name for a binder page, so a page turned to plays the turn and starts fresh. */
export function pageKey(page: BinderPage): string {
  switch (page.kind) {
    case 'records':
      return `records:${page.type}`;
    case 'record':
      return `record:${page.recordId}`;
    case 'entry':
      return `entry:${page.entryId}`;
    default:
      return page.kind;
  }
}

/** Turns to the inspect stage with this record on it. */
export function inspect(recordId: string): TableState {
  return { at: 'inspect', recordId, writing: false };
}

/** Opens the binder at its key. */
export function openBinder(): TableState {
  return { at: 'binder', pages: [{ kind: 'key' }], writing: false };
}

/** Looks down at the sheet page. */
export function openSheet(): TableState {
  return { at: 'sheet' };
}

/** Turns the binder to a page; Back returns to the one open now. */
export function turnTo(state: TableState, page: BinderPage): TableState {
  if (state.at !== 'binder') return state;
  return { ...state, pages: [...state.pages, page], writing: false };
}

/** Turns the binder to a page in place of the open one: a new entry's page once it is written. */
export function replacePage(state: TableState, page: BinderPage): TableState {
  if (state.at !== 'binder') return state;
  return { ...state, pages: [...state.pages.slice(0, -1), page], writing: false };
}

/** The binder's open page, or null when it is closed. */
export function openPage(state: TableState): BinderPage | null {
  return state.at === 'binder' ? (state.pages.at(-1) ?? null) : null;
}

/** Picks up a sticky note, for what is open now: the inspected record or the binder's page. */
export function startWriting(state: TableState): TableState {
  if (noteSubjectOf(state) === null || state.at === 'stage' || state.at === 'sheet') return state;
  return { ...state, writing: true };
}

/**
 * One step back (Back, or Escape): from a sticky note to what it is on, from a binder page to
 * the one before it, and from the inspect stage, the binder's key or the sheet to the theater.
 */
export function back(state: TableState): TableState {
  if (state.at === 'stage') return state;
  if (state.at === 'sheet') return AT_STAGE;
  if (state.writing) return { ...state, writing: false };
  if (state.at === 'binder' && state.pages.length > 1) {
    return { ...state, pages: state.pages.slice(0, -1) };
  }
  return AT_STAGE;
}

/** What a sticky note written now would be on: the record or entry open, or nothing. */
export function noteSubjectOf(state: TableState): NoteSubjectRef | null {
  if (state.at === 'inspect') return { recordId: state.recordId };
  const page = openPage(state);
  if (page?.kind === 'record') return { recordId: page.recordId };
  if (page?.kind === 'entry') return { entryId: page.entryId };
  return null;
}

/** Where the camera rests. */
export function cameraView(state: TableState): StageView {
  if (state.at === 'inspect') return state.writing ? 'note' : 'inspect';
  if (state.at === 'binder') return 'binder';
  if (state.at === 'sheet') return 'sheet';
  return 'stage';
}
