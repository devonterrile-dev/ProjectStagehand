import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  fillPrompt,
  IMPORT_PROMPT_VERSION,
  loadPrompt,
  PromptError,
  promptPath,
  slotsOf,
} from './index';

const temp = mkdtempSync(join(tmpdir(), 'stagehand-prompts-'));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

function writePrompt(version: number, text: string): void {
  mkdirSync(join(temp, 'import'), { recursive: true });
  writeFileSync(promptPath('import', version, temp), text);
}

describe('loadPrompt', () => {
  it('loads the pinned import prompt from this package', () => {
    const prompt = loadPrompt('import', IMPORT_PROMPT_VERSION);
    expect(prompt.startsWith('You turn a game master')).toBe(true);
    // The note for people at the top of the file is not sent to the model.
    expect(prompt).not.toContain('<!--');
    expect(prompt).not.toContain('IMPORT_PROMPT_VERSION');
  });

  it('has one field slot per record type', () => {
    expect(slotsOf(loadPrompt('import', IMPORT_PROMPT_VERSION))).toEqual([
      'fields_npc',
      'fields_area',
      'fields_spot',
      'fields_prop',
      'fields_faction',
      'fields_lore',
      'fields_story_beat',
      'fields_item',
      'fields_session_notes',
    ]);
  });

  it('reads another folder, strips the leading note and normalises line endings', () => {
    writePrompt(7, '<!-- note\r\nfor people -->\r\n\r\nLine one.\r\nLine two.\r\n');
    expect(loadPrompt('import', 7, temp)).toBe('Line one.\nLine two.');
  });

  it('keeps a comment that is not at the top', () => {
    writePrompt(8, 'Start.\n<!-- kept -->\nEnd.');
    expect(loadPrompt('import', 8, temp)).toContain('<!-- kept -->');
  });

  it('fails clearly on a missing or empty file', () => {
    expect(() => loadPrompt('import', 99, temp)).toThrow(PromptError);
    expect(() => loadPrompt('import', 99, temp)).toThrow(/v99\.md/);
    writePrompt(9, '<!-- only a note -->\n');
    expect(() => loadPrompt('import', 9, temp)).toThrow(/empty/);
  });
});

describe('fillPrompt', () => {
  it('fills every slot, each as often as it appears', () => {
    expect(fillPrompt('{{a}} and {{b}}, then {{a}}.', { a: 'one', b: 'two' })).toBe(
      'one and two, then one.',
    );
  });

  it('leaves replacement text alone, dollar signs included', () => {
    expect(fillPrompt('{{a}}', { a: 'costs $1 and {{b}}' })).toBe('costs $1 and {{b}}');
  });

  it('refuses a slot with no value and a value with no slot', () => {
    expect(() => fillPrompt('{{a}} {{b}}', { a: 'x' })).toThrow(/No value for prompt slot\(s\): b/);
    expect(() => fillPrompt('{{a}}', { a: 'x', c: 'y' })).toThrow(/no slot for: c/);
  });
});
