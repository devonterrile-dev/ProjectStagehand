import { describe, expect, it } from 'vitest';

import { anySource, holdKeySource, type SpeakingSource } from './speaking';

function press(type: 'keydown' | 'keyup', key: string, init: KeyboardEventInit = {}, on?: Element) {
  const event = new KeyboardEvent(type, { key, bubbles: true, ...init });
  (on ?? window).dispatchEvent(event);
}

function listen() {
  const changes: boolean[] = [];
  const stop = holdKeySource().start((speaking) => changes.push(speaking));
  return { changes, stop };
}

describe('holding T to talk', () => {
  it('talks while the key is down, once however long it repeats', () => {
    const { changes, stop } = listen();
    press('keydown', 't');
    press('keydown', 't', { repeat: true });
    press('keydown', 'T');
    press('keyup', 't');
    expect(changes).toEqual([true, false]);
    stop();
  });

  it('ignores other keys, and T with Ctrl, Alt or Meta', () => {
    const { changes, stop } = listen();
    press('keydown', 'r');
    press('keydown', 't', { ctrlKey: true });
    press('keydown', 't', { altKey: true });
    press('keydown', 't', { metaKey: true });
    expect(changes).toEqual([]);
    stop();
  });

  it('ignores T typed into a note or a field', () => {
    const { changes, stop } = listen();
    for (const tag of ['textarea', 'input']) {
      const field = document.createElement(tag);
      document.body.append(field);
      press('keydown', 't', {}, field);
      field.remove();
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(editable);
    press('keydown', 't', {}, editable);
    editable.remove();
    expect(changes).toEqual([]);
    stop();
  });

  it('stops when the window loses focus, or the source is stopped', () => {
    const { changes, stop } = listen();
    press('keydown', 't');
    window.dispatchEvent(new Event('blur'));
    press('keydown', 't');
    stop();
    // Stopped: nothing more is heard.
    press('keydown', 't');
    expect(changes).toEqual([true, false, true, false]);
  });
});

/** A source a test switches by hand. */
function switched() {
  let say: ((speaking: boolean) => void) | null = null;
  let stopped = 0;
  const source: SpeakingSource = {
    start(onChange) {
      say = onChange;
      return () => {
        stopped += 1;
        say?.(false);
      };
    },
  };
  return {
    source,
    say: (speaking: boolean) => say?.(speaking),
    stopped: () => stopped,
  };
}

describe('anySource (F3.9)', () => {
  it('talks while any source talks, and says each change once', () => {
    const mic = switched();
    const key = switched();
    const changes: boolean[] = [];
    const stop = anySource([mic.source, key.source]).start((speaking) => changes.push(speaking));

    mic.say(true);
    key.say(true);
    mic.say(false);
    expect(changes).toEqual([true]);
    key.say(false);
    expect(changes).toEqual([true, false]);

    key.say(true);
    stop();
    expect(changes).toEqual([true, false, true, false]);
    expect([mic.stopped(), key.stopped()]).toEqual([1, 1]);
  });
});
