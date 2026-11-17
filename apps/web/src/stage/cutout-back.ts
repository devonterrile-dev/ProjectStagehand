/**
 * The back of a puppet's card (F3.7): plain card in one color, cut to the same outline as the
 * picture on its front. It shows only when a puppet turns its back to the table, as in a spin;
 * without it, the one-sided picture would vanish halfway round.
 *
 * Drawn with three's basic material, changed so that the picture lends only its outline (its
 * transparency, for `alphaTest`) and the color is the material's own.
 */

/** Changes a basic material's shader so a texture gives it only its transparency. */
export function outlineOnly(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    '#include <map_fragment>\n\tdiffuseColor.rgb = diffuse;',
  );
}

/** Kept apart from ordinary basic materials, which must not share the changed shader. */
export function outlineOnlyKey(): string {
  return 'stagehand-cutout-back';
}
