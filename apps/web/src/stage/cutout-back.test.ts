import { ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';

import { outlineOnly, outlineOnlyKey } from './cutout-back';

describe('the back of a puppet’s card', () => {
  it('takes only the outline from the picture, and its own color', () => {
    const shader = { fragmentShader: ShaderLib.basic.fragmentShader };
    expect(shader.fragmentShader).toContain('#include <map_fragment>');

    outlineOnly(shader);

    expect(shader.fragmentShader).toContain(
      '#include <map_fragment>\n\tdiffuseColor.rgb = diffuse;',
    );
    // Still cut out where the picture is see-through.
    expect(shader.fragmentShader).toContain('#include <alphatest_fragment>');
    expect(outlineOnlyKey()).toBe('stagehand-cutout-back');
  });
});
