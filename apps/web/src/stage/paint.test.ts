import { PAINT_SIZES, type Stroke } from '@stagehand/shared';
import { describe, expect, it } from 'vitest';

import {
  drawStrokes,
  MAT_BORDER_PX,
  MAT_PX_PER_SQUARE,
  matTexturePx,
  nextPoint,
  PAINT_HEX,
  PAINT_SPACING,
  pointOnMat,
  type PaintContext,
} from './paint';
import { BATTLE_MAT, squareCenter } from './table-layout';

/** A 2D context that writes down what it is told to draw. */
function recordingContext() {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((arg) => String(arg)).join(',')})`);
    };
  const context = new Proxy(state, {
    get: (target, key: string) => (key in target ? target[key] : record(key)),
    set: (target, key: string, value) => {
      target[key] = value;
      calls.push(`${key}=${String(value)}`);
      return true;
    },
  }) as unknown as PaintContext;
  return { context, calls };
}

const stroke = (overrides: Partial<Stroke>): Stroke => ({
  id: '00000000-0000-4000-8000-000000000001',
  tool: 'paint',
  color: 'red',
  size: 'medium',
  points: [1, 1, 2, 2],
  ...overrides,
});

describe('where paint lands on the mat (F5.6)', () => {
  it('measures a point of the table in squares from the grid’s far left corner', () => {
    const [x, , z] = squareCenter('medium', { column: 3, row: 7 });
    expect(pointOnMat('medium', x, z)).toEqual([3.5, 7.5]);
  });

  it('keeps a point on the border to the grid’s edge, and finds none off the cloth', () => {
    const [x, , z] = squareCenter('small', { column: 0, row: 0 });
    const half = BATTLE_MAT.square / 2;
    expect(pointOnMat('small', x - half - BATTLE_MAT.border / 2, z)).toEqual([0, 0.5]);
    expect(pointOnMat('small', x - half - BATTLE_MAT.border * 2, z)).toBeNull();
    const [farX, , farZ] = squareCenter('small', { column: 5, row: 5 });
    expect(pointOnMat('small', farX, farZ + half + BATTLE_MAT.border * 2)).toBeNull();
  });

  it('adds a point only once the pointer has moved on from the last', () => {
    expect(nextPoint([], 1, 1)).toEqual([1, 1]);
    expect(nextPoint([1, 1], 1 + PAINT_SPACING / 2, 1)).toEqual([]);
    expect(nextPoint([1, 1], 1 + PAINT_SPACING * 2, 1)).toEqual([1 + PAINT_SPACING * 2, 1]);
  });

  it('draws on a canvas the size of the mat’s cloth', () => {
    expect(matTexturePx('small')).toBe(6 * MAT_PX_PER_SQUARE + 2 * MAT_BORDER_PX);
  });
});

describe('drawing the paint (F5.6)', () => {
  const at = (value: number) => MAT_BORDER_PX + value * MAT_PX_PER_SQUARE;

  it('clears the layer, then draws each stroke as a line of its brush’s width and color', () => {
    const { context, calls } = recordingContext();
    drawStrokes(context, [stroke({})], 400);

    expect(calls[0]).toBe('clearRect(0,0,400,400)');
    expect(calls).toContain(`strokeStyle=${PAINT_HEX.red}`);
    expect(calls).toContain(`lineWidth=${String(PAINT_SIZES.medium * MAT_PX_PER_SQUARE)}`);
    expect(calls).toContain('lineCap=round');
    expect(calls).toContain(`moveTo(${String(at(1))},${String(at(1))})`);
    expect(calls).toContain(`lineTo(${String(at(2))},${String(at(2))})`);
    expect(calls).toContain('stroke()');
  });

  it('rubs paint out with an erase, and draws a single point as a dot', () => {
    const { context, calls } = recordingContext();
    drawStrokes(context, [stroke({ tool: 'erase', color: null, points: [3, 4] })], 400);

    expect(calls).toContain('globalCompositeOperation=destination-out');
    expect(calls.some((call) => call.startsWith(`arc(${String(at(3))},${String(at(4))},`))).toBe(
      true,
    );
    expect(calls).toContain('fill()');
  });

  it('draws in order, each stroke with its own settings', () => {
    const { context, calls } = recordingContext();
    drawStrokes(
      context,
      [stroke({ color: 'blue' }), stroke({ color: 'black', size: 'fine' })],
      400,
    );
    const colors = calls.filter((call) => call.startsWith('strokeStyle='));
    expect(colors).toEqual([`strokeStyle=${PAINT_HEX.blue}`, `strokeStyle=${PAINT_HEX.black}`]);
    expect(calls.filter((call) => call === 'save()')).toHaveLength(2);
    expect(calls.filter((call) => call === 'restore()')).toHaveLength(2);
  });
});
