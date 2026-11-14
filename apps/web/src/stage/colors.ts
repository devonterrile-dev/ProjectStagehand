/** The fixed colors of the table, the theater and the room (F3.1). */
export const STAGE_COLORS = {
  /** Shown around the table until the room's picture has loaded. */
  room: '#14100e',
  /** Tints over the wood and cardboard textures; white leaves a texture as drawn. */
  tableTop: '#ffffff',
  frame: '#ffffff',
  /** The apron is a shade darker than the posts and beam, so the opening reads as a frame. */
  apron: '#d8c3a5',
  /** Inside walls and roof, unless a scene tints them (F3.2). */
  walls: '#5b4636',
  curtain: '#b3232d',
  valance: '#8f1b24',
  /** The void: black, so nothing below the scene is seen. */
  void: '#000000',
} as const;
