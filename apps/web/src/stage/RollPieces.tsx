/**
 * What rolls put on the table (F3.6, governance §9 and §12, D-54): the player's sheet page, the
 * two d12s tossed in front of the theater, the dice of a free roll (F4.2), and the GM's Fear as
 * beads in a bowl. Everyone sees
 * the dice and the bowl from the Stage view; the sheet page is each player's own.
 *
 * Nothing here decides anything: the dice land on the numbers the server rolled, and the bowl
 * holds the Fear the server says. A roll or a Fear spend that was already there when the table
 * was drawn is shown at rest; only what happens while a player watches is played.
 */
import { useFrame } from '@react-three/fiber';
import type { FreeDie } from '@stagehand/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  type Group,
  type InstancedMesh,
  type MeshBasicMaterial,
} from 'three';

import { STAGE_COLORS } from './colors';
import {
  DIE_SHAPES,
  freeDiceTimeline,
  freeDieAt,
  REROLL_FROM,
  TOSS_SECONDS,
  tossedAs,
  tossPose,
  type DieShape,
} from './dice';
import type { Point3 } from './dimensions';
import { DICE, FEAR_BOWL, FREE_DICE, SHEET, SHEET_CARDS } from './table-layout';
import { Paper } from './TablePieces';

/** Keeps a click on a piece from counting as a click on nothing. */
const stop = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

/** The HTML of the cards beside the sheet page (F4.7); null for a card the PC doesn't have. */
export interface SheetSideCards {
  piles: { loadout: ReactNode; vault: ReactNode };
  subclass: ReactNode | null;
  ancestry: ReactNode | null;
}

/** One card or pile beside the sheet page: paper on the table, its HTML on it while looked at. */
function SideCard({
  at,
  size,
  thickness,
  html,
}: {
  at: Point3;
  size: { width: number; depth: number; widthPx: number; heightPx: number };
  thickness: number;
  /** Its HTML; null while the player isn't looking. */
  html: ReactNode | null;
}) {
  const [x, y, z] = at;
  return (
    <>
      <mesh position={[x, y + thickness / 2, z]}>
        <boxGeometry args={[size.width, thickness, size.depth]} />
        <meshLambertMaterial color={STAGE_COLORS.paper} />
      </mesh>
      {html !== null && (
        <Paper
          position={[x, y + thickness + 0.002, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          units={SHEET_CARDS.units}
          widthPx={size.widthPx}
          heightPx={size.heightPx}
        >
          {html}
        </Paper>
      )}
    </>
  );
}

/**
 * The player's sheet page (§12 "The sheet page"): a sheet of paper on the table in front of
 * them. Its HTML is laid on it while they look down at it; its edge glows while a roll called
 * for their PC waits. Beside it (F4.7) lie the loadout and vault piles, to its left, and the
 * subclass and ancestry cards, to its right.
 */
export function SheetPage({
  page,
  cards,
  waiting,
  onOpen,
}: {
  /** The sheet's HTML; null while the player isn't looking at it. */
  page: ReactNode | null;
  /** The cards beside it; their HTML is laid on them only while the page's is. */
  cards: SheetSideCards | null;
  waiting: boolean;
  onOpen: () => void;
}) {
  const looking = page !== null;
  const html = (node: ReactNode | null | undefined) => (looking ? (node ?? null) : null);
  const [x, y, z] = SHEET.center;
  const glow = useRef<MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (glow.current === null) return;
    glow.current.opacity = waiting ? 0.55 + 0.35 * Math.sin(clock.elapsedTime * 3) : 0;
  });

  return (
    <group
      onClick={(event) => {
        stop(event);
        if (page === null) onOpen();
      }}
    >
      <mesh position={[x, y + 0.001, z]}>
        <boxGeometry args={[SHEET.width + 0.04, 0.002, SHEET.depth + 0.04]} />
        <meshBasicMaterial ref={glow} color={STAGE_COLORS.callGlow} transparent opacity={0} />
      </mesh>
      <mesh position={[x, y + 0.003, z]}>
        <boxGeometry args={[SHEET.width, 0.004, SHEET.depth]} />
        <meshLambertMaterial color={STAGE_COLORS.paper} />
      </mesh>
      {page !== null && (
        <Paper
          position={[x, y + 0.006, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          units={SHEET.width / SHEET.widthPx}
          widthPx={SHEET.widthPx}
          heightPx={SHEET.heightPx}
        >
          {page}
        </Paper>
      )}
      <SideCard
        at={SHEET_CARDS.loadout}
        size={SHEET_CARDS.pile}
        thickness={0.006}
        html={html(cards?.piles.loadout)}
      />
      <SideCard
        at={SHEET_CARDS.vault}
        size={SHEET_CARDS.pile}
        thickness={0.006}
        html={html(cards?.piles.vault)}
      />
      {cards?.subclass != null && (
        <SideCard
          at={SHEET_CARDS.subclass}
          size={SHEET_CARDS.card}
          thickness={0.004}
          html={html(cards.subclass)}
        />
      )}
      {cards?.ancestry != null && (
        <SideCard
          at={SHEET_CARDS.ancestry}
          size={SHEET_CARDS.card}
          thickness={0.004}
          html={html(cards.ancestry)}
        />
      )}
    </group>
  );
}

/** A die's labels drawn in a grid, 4 across for up to 12, 5 across for more (the d20). */
function labelAtlas(
  labels: readonly string[],
  ink: string,
): { texture: CanvasTexture; columns: number; rows: number } {
  const cell = 128;
  const columns = labels.length <= 12 ? 4 : 5;
  const rows = Math.ceil(labels.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = cell * columns;
  canvas.height = cell * rows;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.fillStyle = ink;
    context.strokeStyle = ink;
    context.lineWidth = 7;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    labels.forEach((label, index) => {
      // A font every browser has: nothing is loaded from elsewhere (§13, Discord's policy).
      context.font = `bold ${label.length > 1 ? '64' : '84'}px Georgia, "Times New Roman", serif`;
      const cx = (index % columns) * cell + cell / 2;
      const cy = Math.floor(index / columns) * cell + cell / 2;
      context.fillText(label, cx, cy + 4);
      // 6 and 9 are underlined, so they can't be mistaken for each other.
      if (label === '6' || label === '9') {
        context.beginPath();
        context.moveTo(cx - 22, cy + 42);
        context.lineTo(cx + 22, cy + 42);
        context.stroke();
      }
    });
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, columns, rows };
}

/** A small square for each of a die's printed labels, showing it from the atlas. */
function labelQuads(
  shape: DieShape,
  radius: number,
  columns: number,
  rows: number,
): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const corners = [new Vector2(-1, -1), new Vector2(1, -1), new Vector2(1, 1), new Vector2(-1, 1)];
  for (const spot of shape.spots) {
    const across = new Vector3().crossVectors(spot.upward, spot.normal).normalize();
    const center = spot.center.clone().multiplyScalar(radius);
    const half = spot.half * radius;
    const base = positions.length / 3;
    const col = spot.reading % columns;
    const row = Math.floor(spot.reading / columns);
    for (const corner of corners) {
      const point = center
        .clone()
        .addScaledVector(across, corner.x * half)
        .addScaledVector(spot.upward, corner.y * half);
      positions.push(point.x, point.y, point.z);
      uvs.push((col + (corner.x + 1) / 2) / columns, 1 - (row + (1 - corner.y) / 2) / rows);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

interface DieProps {
  shape: DieShape;
  /** Its radius, to its corners. */
  size: number;
  /** The reading it ends on, counted from 1. */
  face: number;
  /** A new seed throws it again. */
  seed: string;
  landing: Point3;
  /** Where it leaves the hand, relative to `landing`. */
  from: Point3;
  /** How long the throw takes. */
  seconds: number;
  color: string;
  ink: string;
  /** Play the toss; otherwise it lies still from the start. */
  toss: boolean;
}

function Die({ shape, size, face, seed, landing, from, seconds, color, ink, toss }: DieProps) {
  const group = useRef<Group>(null);
  const started = useRef<number | null>(null);
  /** The throw being played: a new seed starts another. */
  const playing = useRef(seed);
  /** Lying still at its final pose: nothing left to move. */
  const still = useRef(false);
  const body = useMemo(() => shape.geometry(size), [shape, size]);
  const atlas = useMemo(
    () =>
      labelAtlas(
        shape.readings.map((reading) => reading.label),
        ink,
      ),
    [shape, ink],
  );
  const labels = useMemo(
    () => labelQuads(shape, size, atlas.columns, atlas.rows),
    [shape, size, atlas],
  );
  const rest = shape.rest * size;
  useEffect(
    () => () => {
      body.dispose();
      labels.dispose();
      atlas.texture.dispose();
    },
    [body, labels, atlas],
  );

  useFrame(({ clock }) => {
    const die = group.current;
    if (die === null) return;
    if (playing.current !== seed) {
      playing.current = seed;
      started.current = null;
      still.current = false;
    }
    started.current ??= clock.elapsedTime;
    const elapsed = toss ? clock.elapsedTime - started.current : seconds;
    if (still.current) return;
    const pose = tossPose({ landing, rest, from, face, seed, shape, seconds }, elapsed);
    die.position.set(...pose.position);
    die.quaternion.copy(pose.rotation);
    still.current = elapsed >= seconds;
  });

  return (
    <group ref={group} position={[landing[0], landing[1] + rest, landing[2]]}>
      <mesh geometry={body}>
        <meshLambertMaterial color={color} flatShading />
      </mesh>
      <mesh geometry={labels}>
        <meshBasicMaterial
          map={atlas.texture}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>
    </group>
  );
}

/** The last roll's dice, as the stage carries it. */
export interface DiceRoll {
  id: string;
  hope: number;
  fear: number;
}

/**
 * The Hope die and the Fear die (§9, 19.12): tossed onto the table in front of the theater when
 * a roll lands, the same throw for everyone, and left lying there until the next.
 */
export function Dice({ roll }: { roll: DiceRoll | null }) {
  // A roll that was there before this table was: lying still, not thrown again.
  const [atStart] = useState(roll?.id ?? null);
  if (roll === null) return null;
  const toss = roll.id !== atStart;
  const common = {
    shape: DIE_SHAPES.d12,
    size: DICE.size,
    from: DICE.from,
    seconds: TOSS_SECONDS,
    toss,
  };
  return (
    <group key={roll.id}>
      <Die
        {...common}
        face={roll.hope}
        seed={`${roll.id}:hope`}
        landing={DICE.hope}
        color={STAGE_COLORS.hopeDie}
        ink={STAGE_COLORS.hopeDieInk}
      />
      <Die
        {...common}
        face={roll.fear}
        seed={`${roll.id}:fear`}
        landing={DICE.fear}
        color={STAGE_COLORS.fearDie}
        ink={STAGE_COLORS.fearDieInk}
      />
    </group>
  );
}

/** The last free roll's dice (F4.2), as the tray's roll carries them. */
export interface FreeDiceRoll {
  id: string;
  die: FreeDie;
  results: readonly number[];
}

/**
 * A free roll from the dice tray (F4.2, D-60): one die tossed onto the table, then tossed again
 * for each further result as soon as it lands, the same throws for everyone; a d% roll is two
 * d10s, tens and ones. The last lies there until the next free roll.
 */
export function FreeDice({ roll }: { roll: FreeDiceRoll | null }) {
  // A roll that was there before this table was: lying still, not thrown again.
  const [atStart] = useState(roll?.id ?? null);
  if (roll === null) return null;
  return <FreeDiceRun key={roll.id} roll={roll} play={roll.id !== atStart} />;
}

function FreeDiceRun({ roll, play }: { roll: FreeDiceRoll; play: boolean }) {
  const count = roll.results.length;
  const [step, setStep] = useState(play ? 0 : count - 1);
  const started = useRef<number | null>(null);

  useFrame(({ clock }) => {
    if (!play) return;
    started.current ??= clock.elapsedTime;
    const next = freeDieAt(count, clock.elapsedTime - started.current);
    if (next !== step) setStep(next);
  });

  const timing = freeDiceTimeline(count)[step];
  const result = roll.results[step];
  if (timing === undefined || result === undefined) return null;
  return (
    <>
      {tossedAs(roll.die, result).map((die, index) => (
        <Die
          key={index}
          shape={die.shape}
          size={FREE_DICE.size}
          face={die.reading + 1}
          seed={`${roll.id}:${String(step)}:${String(index)}`}
          landing={index === 0 ? FREE_DICE.landing : FREE_DICE.second}
          from={step === 0 ? FREE_DICE.from : REROLL_FROM}
          seconds={timing.seconds}
          color={STAGE_COLORS.freeDie}
          ink={STAGE_COLORS.freeDieInk}
          toss={play}
        />
      ))}
    </>
  );
}

/** Most beads the bowl can show: the ruleset's Fear cap (§9). */
const BEAD_SLOTS = 12;

/** Where each bead lies in the bowl, from the middle out and then a second layer. */
const SLOTS: readonly Point3[] = Array.from({ length: BEAD_SLOTS }, (_, i) => {
  const { radius: r, bead: b } = FEAR_BOWL;
  if (i === 0) return [0, b, 0];
  if (i <= 6) {
    const angle = ((i - 1) / 6) * Math.PI * 2;
    return [Math.cos(angle) * r * 0.42, b * 1.15, Math.sin(angle) * r * 0.42];
  }
  const angle = ((i - 7) / 5) * Math.PI * 2 + 0.6;
  return [Math.cos(angle) * r * 0.3, b * 2.4, Math.sin(angle) * r * 0.3];
});

interface BeadMove {
  kind: 'in' | 'out' | 'toss';
  start: number | null;
}
const BEAD_SECONDS = { in: 0.45, out: 0.3, toss: 0.9 } as const;

/** Worked on each frame by every bowl; never kept between frames. */
const scratch = {
  matrix: new Matrix4(),
  place: new Vector3(),
  size: new Vector3(),
  still: new Quaternion(),
};

/**
 * The GM's Fear (§9 "Fear"): one bead in the bowl for each, with no number: players judge it by
 * the beads, and the GM's desk has the count (the designer's choice). A gain drops a bead in; a
 * spend tosses beads out and away; a correction just adds or takes.
 */
export function FearBowl({
  fear,
  spendId,
}: {
  fear: number;
  /** The last Fear spend: a new one tosses the beads it took. */
  spendId: string | null;
}) {
  const beads = useRef<InstancedMesh>(null);
  const shown = useRef(Math.min(fear, BEAD_SLOTS));
  const lastSpend = useRef(spendId);
  const moves = useRef<(BeadMove | null)[]>(Array.from({ length: BEAD_SLOTS }, () => null));
  const bowl = useMemo(() => {
    const { radius: r, height: h } = FEAR_BOWL;
    const profile = [
      new Vector2(0, 0),
      new Vector2(r * 0.55, 0),
      new Vector2(r * 0.85, h * 0.35),
      new Vector2(r, h),
      new Vector2(r * 0.94, h),
      new Vector2(r * 0.8, h * 0.4),
      new Vector2(r * 0.5, 0.008),
      new Vector2(0, 0.008),
    ];
    return new LatheGeometry(profile, 28);
  }, []);
  const bead = useMemo(() => new SphereGeometry(FEAR_BOWL.bead, 12, 8), []);
  useEffect(
    () => () => {
      bowl.dispose();
      bead.dispose();
    },
    [bowl, bead],
  );

  // Worked out when the count or the last spend changes, played from the next frame.
  useEffect(() => {
    const before = shown.current;
    const now = Math.min(fear, BEAD_SLOTS);
    const tossed = spendId !== null && spendId !== lastSpend.current;
    lastSpend.current = spendId;
    for (let i = now; i < before; i += 1)
      moves.current[i] = { kind: tossed ? 'toss' : 'out', start: null };
    for (let i = before; i < now; i += 1) moves.current[i] = { kind: 'in', start: null };
    shown.current = now;
  }, [fear, spendId]);

  useFrame(({ clock }) => {
    const mesh = beads.current;
    if (mesh === null) return;
    for (let i = 0; i < BEAD_SLOTS; i += 1) {
      const [sx, sy, sz] = SLOTS[i] ?? [0, 0, 0];
      const { matrix, place, size, still } = scratch;
      place.set(sx, sy, sz);
      let scale = i < shown.current ? 1 : 0;
      const move = moves.current[i];
      if (move !== undefined && move !== null) {
        move.start ??= clock.elapsedTime;
        const p = Math.min(1, (clock.elapsedTime - move.start) / BEAD_SECONDS[move.kind]);
        if (move.kind === 'in') {
          place.y += (1 - (1 - (1 - p) ** 3)) * 0.4;
          scale = 1;
        } else if (move.kind === 'out') {
          scale = 1 - p;
        } else {
          const angle = (i / BEAD_SLOTS) * Math.PI * 2;
          place.x += Math.cos(angle) * 0.35 * p;
          place.z += Math.sin(angle) * 0.2 * p + 0.25 * p;
          place.y += Math.sin(Math.PI * p) * 0.35;
          scale = 1 - p * p;
        }
        if (p >= 1) moves.current[i] = null;
      }
      size.setScalar(Math.max(scale, 0.0001));
      matrix.compose(place, still, size);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  const [x, y, z] = FEAR_BOWL.center;
  return (
    <group onClick={stop}>
      <group position={[x, y, z]}>
        <mesh geometry={bowl}>
          <meshLambertMaterial color={STAGE_COLORS.bowl} side={DoubleSide} />
        </mesh>
        <instancedMesh ref={beads} args={[bead, undefined, BEAD_SLOTS]}>
          <meshLambertMaterial color={STAGE_COLORS.fearBead} />
        </instancedMesh>
      </group>
    </group>
  );
}
