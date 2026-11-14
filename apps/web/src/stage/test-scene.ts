/**
 * The performance test scene's layout (F3.1, governance §12 "Performance budget"). Pure and
 * repeatable: the same count always gives the same scene, so two devices measure the same
 * thing.
 */
import { DEPTH_TICKS, STAGE_MAX_OBJECTS, type AssetKind } from '@stagehand/shared';

/** What the layout needs to know about an image: its kind and its size in pixels. */
export interface TestSample {
  kind: AssetKind;
  width: number;
  height: number;
}

export interface TestObject {
  id: number;
  /** Which sample image it shows. */
  sampleIndex: number;
  /** A puppet is on a stick; a prop is on a stand. */
  mount: 'stick' | 'stand';
  /** 0 (left edge of the opening) to 1 (right edge). */
  across: number;
  /** 0 (bottom edge of the opening) upward, for the cutout's bottom center. */
  up: number;
  /** Depth tick, 0 (front) to 9 (back). */
  tick: number;
  scale: number;
  flipped: boolean;
  /** Where in its sway the puppet starts, in radians, so they don't all move together. */
  phase: number;
}

/** The open curtain covers the outer eighth of the opening on each side; stay clear of it. */
const ACROSS = { min: 0.16, max: 0.84 } as const;
const GOLDEN = 0.6180339887;

const fraction = (value: number): number => value - Math.floor(value);

/**
 * Up to 30 objects (the §12 budget) spread across the opening and over every depth tick,
 * cycling through the samples: puppets raised a little on sticks, props standing at the
 * bottom edge, some flipped, at different sizes.
 */
export function testSceneObjects(count: number, samples: readonly TestSample[]): TestObject[] {
  const total = Math.min(STAGE_MAX_OBJECTS, Math.max(0, Math.floor(count)));
  const objects: TestObject[] = [];
  for (let id = 0; id < total; id += 1) {
    const sampleIndex = id % samples.length;
    const sample = samples[sampleIndex];
    if (sample === undefined) break;
    const mount = sample.kind === 'prop' ? 'stand' : 'stick';
    objects.push({
      id,
      sampleIndex,
      mount,
      across: ACROSS.min + (ACROSS.max - ACROSS.min) * fraction(id * GOLDEN),
      up: mount === 'stand' ? 0 : 0.04 + 0.16 * fraction(id * 0.37),
      // 7 shares no factor with 10, so the objects step through every tick in turn.
      tick: (id * 7) % DEPTH_TICKS,
      scale: 0.7 + 0.4 * fraction(id * 0.433),
      flipped: id % 3 === 0,
      phase: fraction(id * 0.271) * 2 * Math.PI,
    });
  }
  return objects;
}
