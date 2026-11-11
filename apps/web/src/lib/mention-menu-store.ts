/**
 * The state of one editor's @ menu (F1.5b). The suggestion plugin runs outside React, so it
 * talks to this small store, and the editor reads it with `useSyncExternalStore`.
 */
import type { MentionMenuBridge, MentionMenuState, RecordMentions } from './record-mentions';

export interface MentionMenuSnapshot {
  menu: MentionMenuState | null;
  /** The highlighted match. */
  active: number;
}

export class MentionMenuStore implements MentionMenuBridge {
  private mentions: RecordMentions | null;
  private snapshot: MentionMenuSnapshot = { menu: null, active: 0 };
  private readonly listeners = new Set<() => void>();

  constructor(mentions: RecordMentions | null) {
    this.mentions = mentions;
  }

  /** The records that can be mentioned, read on every keystroke after @. */
  currentMentions = (): RecordMentions | null => this.mentions;

  /** Called by the editor after each render, so the list stays current. */
  setMentions = (mentions: RecordMentions | null): void => {
    this.mentions = mentions;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): MentionMenuSnapshot => this.snapshot;

  private set(next: MentionMenuSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  show = (menu: MentionMenuState): void => {
    const { active } = this.snapshot;
    this.set({ menu, active: active < menu.items.length ? active : 0 });
  };

  hide = (): void => {
    this.set({ menu: null, active: 0 });
  };

  activate = (active: number): void => {
    this.set({ ...this.snapshot, active });
  };

  keyDown = (event: KeyboardEvent): boolean => {
    const { menu, active } = this.snapshot;
    if (menu === null || menu.items.length === 0) return false;
    const count = menu.items.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activate((active + step + count) % count);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const record = menu.items[active];
      if (record !== undefined) menu.pick(record);
      return true;
    }
    return false;
  };
}
