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
  /** A puppet's stick: pale wood. A prop's stand: darker, so it draws less attention. */
  stick: '#d8b384',
  stand: '#6f5236',
  /** The string a hanging prop is on: dark thread, hard to see against the roof. */
  string: '#2b2622',
  /** The frame around the object being edited in the scene builder (F3.2). */
  selection: '#ffd24a',
  /** The scene builder's depth tick lines, other than the selected object's (F3.2c). */
  guide: '#ffffff',
  /** Paper on the table: the binder's pages (F3.5b), and the sheet page's stand-in. */
  paper: '#f4efe2',
  /** A pad of sticky notes (F3.5b). */
  sticky: '#f6e27a',
  /** The binder's cover and its metal rings (F3.5b). */
  binder: '#2f4a6d',
  ring: '#b8b8b8',
  /** The void: black, so nothing below the scene is seen. */
  void: '#000000',
} as const;
