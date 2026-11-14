import { emptyRichText, type RichText } from '@stagehand/shared';
import { loadStyleBible } from '@stagehand/style-bible';
import { describe, expect, it } from 'vitest';

import { SUBJECT_LINE_MAX, subjectLinesFor, visualPrompt } from './prompt';

const BIBLE = loadStyleBible();

function doc(...paragraphs: string[]): RichText {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

describe('subjectLinesFor', () => {
  it('reads the same lines, in the same order, as the image test set', () => {
    expect(
      subjectLinesFor({
        subject: 'npc',
        name: 'Bramble',
        publicDescription: doc('Runs the store'),
        fields: { appearance: 'A round gnome', secrets: 'never sent' },
      }),
    ).toEqual([
      ['Appearance', 'A round gnome'],
      ['Description', 'Runs the store'],
    ]);
    expect(
      subjectLinesFor({
        subject: 'item',
        name: 'Lantern',
        publicDescription: doc('Glows'),
        fields: { kind: 'Light source', appearance: 'Brass' },
      }),
    ).toEqual([
      ['Kind', 'Light source'],
      ['Appearance', 'Brass'],
      ['Description', 'Glows'],
    ]);
    expect(
      subjectLinesFor({
        subject: 'pc',
        name: 'Wren',
        publicDescription: doc('Freckles'),
        className: 'Ranger',
      }),
    ).toEqual([
      ['Class or role', 'Ranger'],
      ['Description', 'Freckles'],
    ]);
  });

  it("gives a Spot its Area's description, or the Area's name when that is empty", () => {
    const spot = {
      subject: 'spot' as const,
      name: 'Market',
      publicDescription: doc('Not used for backdrops'),
      fields: { backdropNotes: 'Stalls at dusk' },
    };
    expect(
      subjectLinesFor({ ...spot, area: { name: 'Saltreach', publicDescription: doc('Stilts') } }),
    ).toEqual([
      ['Backdrop notes', 'Stalls at dusk'],
      ['Area', 'Stilts'],
    ]);
    expect(
      subjectLinesFor({ ...spot, area: { name: 'Saltreach', publicDescription: emptyRichText() } }),
    ).toContainEqual(['Area', 'Saltreach']);
    expect(subjectLinesFor({ ...spot, area: null })).toContainEqual(['Area', null]);
  });
});

describe('visualPrompt', () => {
  it("is the base style plus the kind's template, without empty lines", () => {
    const prompt = visualPrompt(BIBLE, 'prop', {
      subject: 'prop',
      name: 'Village   Well',
      publicDescription: emptyRichText(),
      fields: { appearance: 'Round stone\nwith a roof' },
    });
    expect(prompt.startsWith(`${BIBLE.base}\n\n`)).toBe(true);
    expect(prompt).toContain('Village Well');
    expect(prompt).toContain('Appearance: Round stone with a roof');
    expect(prompt).not.toContain('Description:');
    expect(prompt).toContain('magenta (#FF00FF)');
  });

  it('caps a long field', () => {
    const prompt = visualPrompt(BIBLE, 'character', {
      subject: 'npc',
      name: 'Talker',
      publicDescription: doc('x'.repeat(5000)),
      fields: {},
    });
    const line = prompt.split('\n').find((text) => text.startsWith('Description: '));
    expect(line).toHaveLength('Description: '.length + SUBJECT_LINE_MAX);
    expect(line?.endsWith('…')).toBe(true);
  });

  it('leaves the key color out of a backdrop', () => {
    const prompt = visualPrompt(BIBLE, 'backdrop', {
      subject: 'spot',
      name: 'Dock',
      publicDescription: emptyRichText(),
      fields: { backdropNotes: 'Wide dock' },
    });
    expect(prompt).not.toContain('#FF00FF');
    expect(prompt).toContain('Backdrop notes: Wide dock');
  });
});
