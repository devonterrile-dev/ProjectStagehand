/**
 * The room around the table (F3.1): a plain room drawn as an equirectangular picture, the 2:1
 * format that wraps onto a sphere. The stage blurs it, so only its big shapes matter: walls,
 * floor, ceiling, a window with daylight, a bookshelf, a door.
 *
 * The room is a box seen from the middle, at eye height. Directions follow the stage's sphere
 * (`apps/web/src/stage/Room.tsx`): column u looks toward (cos 2πu, sin 2πu) in x and z, so
 * u = 0.75 is the wall behind the theater (-z), u = 0.5 the left wall, u = 0.25 the wall
 * behind the players, and the picture's side edges meet in the middle of the right wall.
 */

/** The room, in meters from the eye: half its width, to each end wall, up and down. */
const ROOM = { halfWidth: 4.5, back: 5, front: 5, up: 1.7, down: 1.3, skirting: 0.12 } as const;

const COLORS = {
  ceiling: '#e9e0d0',
  floor: '#7a5434',
  skirting: '#efe7d8',
  back: '#a9b8b4',
  left: '#9dada9',
  right: '#b3c1bd',
  front: '#a4b3af',
} as const;

const BOOKS = ['#b3232d', '#2f6f8f', '#d9a441', '#3f7d4e', '#7a4b8f', '#e0d7c5'] as const;

type Point = readonly [x: number, y: number, z: number];

/** Where a direction from the eye lands in the picture, as shares of its width and height. */
export function project([x, y, z]: Point): { u: number; v: number } {
  const turn = Math.atan2(z, x) / (2 * Math.PI);
  const rise = Math.atan2(y, Math.hypot(x, z));
  return { u: (turn + 1) % 1, v: 0.5 - rise / Math.PI };
}

/**
 * A flat four-cornered shape in the room, as an SVG polygon. Straight edges bend in this
 * picture format, so each edge is drawn as many short steps.
 */
function quad(corners: readonly [Point, Point, Point, Point], width: number, height: number) {
  const STEPS = 12;
  const points: string[] = [];
  corners.forEach((from, index) => {
    const to = corners[(index + 1) % corners.length] ?? from;
    for (let step = 0; step < STEPS; step += 1) {
      const t = step / STEPS;
      const { u, v } = project([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ]);
      points.push(`${(u * width).toFixed(1)},${(v * height).toFixed(1)}`);
    }
  });
  return points.join(' ');
}

/** A rectangle on the back wall, from x0 to x1 across and y0 to y1 up (meters from the eye). */
function onBackWall(x0: number, x1: number, y0: number, y1: number, lift = 0) {
  const z = -ROOM.back + lift;
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ] as const;
}

/** A rectangle on the left wall, from z0 to z1 along it and y0 to y1 up. */
function onLeftWall(z0: number, z1: number, y0: number, y1: number) {
  const x = -ROOM.halfWidth;
  return [
    [x, y0, z0],
    [x, y0, z1],
    [x, y1, z1],
    [x, y1, z0],
  ] as const;
}

/** The room as an SVG, `width` by `height` pixels (2:1). Not blurred yet. */
export function roomSvg(width: number, height: number): string {
  const parts: string[] = [];
  const shape = (corners: readonly [Point, Point, Point, Point], fill: string) => {
    parts.push(`<polygon points="${quad(corners, width, height)}" fill="${fill}"/>`);
  };
  const glow = (at: Point, radius: number, color: string, strength: number) => {
    const { u, v } = project(at);
    const id = `glow${String(parts.length)}`;
    parts.push(
      `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${String(strength)}"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` +
        `<circle cx="${(u * width).toFixed(1)}" cy="${(v * height).toFixed(1)}" r="${(radius * width).toFixed(1)}" fill="url(#${id})"/>`,
    );
  };

  // Walls, ceiling and floor, one thin column at a time: for each direction, how far away the
  // wall is decides how high its top and bottom edges appear.
  const COLUMNS = 512;
  const columnWidth = width / COLUMNS;
  for (let column = 0; column < COLUMNS; column += 1) {
    const angle = ((column + 0.5) / COLUMNS) * 2 * Math.PI;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const toSide = ROOM.halfWidth / Math.abs(dx);
    const toEnd = (dz < 0 ? ROOM.back : ROOM.front) / Math.abs(dz);
    const distance = Math.min(toSide, toEnd);
    const wall =
      toSide < toEnd ? (dx > 0 ? COLORS.right : COLORS.left) : dz < 0 ? COLORS.back : COLORS.front;

    const top = (0.5 - Math.atan(ROOM.up / distance) / Math.PI) * height;
    const skirting = (0.5 + Math.atan((ROOM.down - ROOM.skirting) / distance) / Math.PI) * height;
    const bottom = (0.5 + Math.atan(ROOM.down / distance) / Math.PI) * height;
    const x = (column * columnWidth).toFixed(2);
    // A hair wider than a column, so no gaps show between them.
    const w = (columnWidth + 0.6).toFixed(2);
    const band = (from: number, to: number, fill: string) => {
      parts.push(
        `<rect x="${x}" y="${from.toFixed(2)}" width="${w}" height="${(to - from + 0.6).toFixed(2)}" fill="${fill}"/>`,
      );
    };
    band(0, top, COLORS.ceiling);
    band(top, skirting, wall);
    band(skirting, bottom, COLORS.skirting);
    band(bottom, height, COLORS.floor);
  }

  // Back wall, left of the theater: a window with daylight, and its curtains.
  shape(onBackWall(-4.25, -3.75, -0.6, 1.45, 0.02), '#b5654a');
  shape(onBackWall(-1.55, -1.05, -0.6, 1.45, 0.02), '#b5654a');
  shape(onBackWall(-3.75, -1.55, -0.35, 1.3, 0.01), '#f3ead8');
  shape(onBackWall(-3.65, -1.65, -0.25, 1.2, 0.02), '#d6ecf8');
  shape(onBackWall(-2.69, -2.61, -0.25, 1.2, 0.03), '#f3ead8');
  shape(onBackWall(-3.65, -1.65, 0.44, 0.52, 0.03), '#f3ead8');

  // Back wall, behind the theater: a framed picture.
  shape(onBackWall(-0.7, 0.7, 0.45, 1.3, 0.01), '#4b3524');
  shape(onBackWall(-0.6, 0.6, 0.55, 1.2, 0.02), '#d9b77a');

  // Back wall, right of the theater: a bookshelf.
  shape(onBackWall(1.6, 3.6, -1.3, 1.05, 0.02), '#4f3320');
  const rows = [-1.15, -0.6, -0.05, 0.5] as const;
  rows.forEach((bottom, row) => {
    for (let book = 0; book < 9; book += 1) {
      const left = 1.72 + book * 0.2;
      const color = BOOKS[(book * 5 + row * 2) % BOOKS.length] ?? BOOKS[0];
      // Books of slightly different heights, so a shelf isn't one flat bar.
      const tall = 0.34 + 0.08 * ((book * 7 + row * 3) % 3);
      shape(onBackWall(left, left + 0.17, bottom, bottom + tall, 0.03), color);
    }
  });

  // Left wall: a door.
  shape(onLeftWall(-2.6, -1.3, -1.3, 0.95), '#e6dcc8');
  shape(onLeftWall(-2.5, -1.4, -1.3, 0.85), '#8a5a34');

  // Daylight spilling from the window, and a warm lamp by the bookshelf.
  glow([-2.65, 0.5, -ROOM.back], 0.085, '#ffffff', 0.4);
  glow([4.1, 0.3, -ROOM.back + 0.2], 0.05, '#ffd9a0', 0.55);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" ` +
    `viewBox="0 0 ${String(width)} ${String(height)}">${parts.join('')}</svg>`
  );
}
