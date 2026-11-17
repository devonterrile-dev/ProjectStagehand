/**
 * What sits on the table besides the theater (F3.5b, governance §12): the inspect stage, the
 * sticky pads and the three-ring binder. The HTML on them (the papers, the binder's page, the
 * sticky note) is made by the play page and drawn here on the right plane with drei `Html`;
 * it is mounted only while its view is open, so the rest of the time the table costs nothing.
 */
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { MathUtils, type Group } from 'three';

import { STAGE_COLORS } from './colors';
import { Curtain } from './Curtain';
import { Cutout } from './Cutout';
import { OPENING, WORLD_UNITS_PER_PIXEL, type Point3 } from './dimensions';
import {
  BINDER,
  htmlScale,
  INSPECT_CARD,
  INSPECT_STAGE,
  INSPECT_TITLE,
  TABLE_HTML_Z,
  unitsPerPx,
  type BINDER_PAD,
  type INSPECT_PAD,
} from './table-layout';
import { STAGE_TEXTURES } from './textures';
import { TiledBox } from './TiledBox';
import { useTiledTexture } from './use-tiled-texture';

/** How long after the inspect stage is turned to before its curtain opens. */
export const INSPECT_CURTAIN_DELAY_MS = 450;
/** How quickly the binder's cover swings; higher is faster. */
const COVER_SPEED = 6;
/** The binder's cover, a little bigger than its pages. */
const COVER_LIP = 0.015;

/** An image that fails to load leaves the inspect stage empty rather than taking it down. */
class ImageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Keeps an event on the HTML it happened on. */
const stop = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

/** Frames newly laid HTML stays hidden, so drei has put it on its plane before it is drawn. */
const REVEAL_FRAMES = 2;

/**
 * The paper's contents, hidden for their first frames. drei lays them on their plane on the
 * frame after they mount; drawn (or focused) before that, the browser can keep a blank picture
 * of them until something on them changes. Once shown, the field marked `data-autofocus` gets
 * the keyboard, without scrolling the scene's box to it.
 */
function Reveal({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let left = REVEAL_FRAMES;
    let frame = 0;
    const tick = () => {
      left -= 1;
      if (left > 0) frame = window.requestAnimationFrame(tick);
      else setShown(true);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!shown) return;
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, [shown]);

  return (
    // The 3D scene listens for clicks on the box the canvas is in, which this HTML sits in too:
    // a click on paper must stay on the paper, not count as a click on nothing (which puts down
    // what is being looked at).
    <div
      ref={box}
      className="h-full w-full"
      style={{ visibility: shown ? 'visible' : 'hidden' }}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    >
      {children}
    </div>
  );
}

/** HTML laid on a piece: `widthPx` × `heightPx` CSS pixels at `units` world units each. */
function Paper({
  position,
  rotation = [0, 0, 0],
  units,
  widthPx,
  heightPx,
  children,
}: {
  position: Point3;
  rotation?: Point3;
  units: number;
  widthPx: number;
  heightPx?: number;
  children: ReactNode;
}) {
  return (
    <Html
      transform
      position={position}
      rotation={rotation}
      scale={htmlScale(units)}
      zIndexRange={TABLE_HTML_Z}
      style={{ width: widthPx, ...(heightPx === undefined ? {} : { height: heightPx }) }}
    >
      <Reveal>{children}</Reveal>
    </Html>
  );
}

export interface InspectImage {
  url: string;
  width: number;
  height: number;
}

/**
 * The inspect stage (§12 "Inspecting a prop"): a small theater on the table with its own curtain.
 * While a record is inspected its curtain opens on the record's cutout, its name hangs above on
 * a paper sign, and its public description lies on a card in front.
 */
export function InspectStage({
  active,
  papers,
  image,
  title,
  card,
}: {
  /** A record is being inspected. */
  active: boolean;
  /** The camera has arrived: the paper sign and card are laid out. */
  papers: boolean;
  image: InspectImage | null;
  title: ReactNode;
  card: ReactNode;
}) {
  const cardboard = useTiledTexture(STAGE_TEXTURES.cardboard.url);
  const tile = STAGE_TEXTURES.cardboard.tile;
  const { x, z, opening, depth, post, beam, floorY, fill } = INSPECT_STAGE;
  const { width: w, height: h } = opening;

  // The curtain opens once the camera has turned to it, and closes as soon as it turns away or
  // turns to another record.
  const showing = active ? (image?.url ?? '') : null;
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  useEffect(() => {
    if (showing === null) return;
    const timer = window.setTimeout(() => {
      setOpenedOn(showing);
    }, INSPECT_CURTAIN_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [showing]);
  const curtainOpen = showing !== null && openedOn === showing;

  const fit =
    image === null
      ? 1
      : Math.min(
          (fill * h) / (image.height * WORLD_UNITS_PER_PIXEL),
          (fill * w) / (image.width * WORLD_UNITS_PER_PIXEL),
        );

  return (
    // A click on the inspect stage itself is not a click away from it.
    <group onClick={stop}>
      {/* The box: back wall, sides and roof, with a floor the cutout stands on. */}
      <group position={[x, floorY, z]}>
        <mesh position={[0, h / 2, -depth]}>
          <boxGeometry args={[w, h, 0.02]} />
          <meshLambertMaterial color={STAGE_COLORS.walls} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[(side * w) / 2, h / 2, -depth / 2]}>
            <boxGeometry args={[0.02, h, depth]} />
            <meshLambertMaterial color={STAGE_COLORS.walls} />
          </mesh>
        ))}
        <mesh position={[0, h, -depth / 2]}>
          <boxGeometry args={[w, 0.02, depth]} />
          <meshLambertMaterial color={STAGE_COLORS.walls} />
        </mesh>
        <mesh position={[0, 0.005, -depth / 2]}>
          <boxGeometry args={[w, 0.01, depth]} />
          <meshLambertMaterial color={STAGE_COLORS.stand} />
        </mesh>
      </group>
      {/* Its cardboard front: two posts and a beam. */}
      {[-1, 1].map((side) => (
        <TiledBox
          key={side}
          size={[post, h + beam, 0.06]}
          position={[x + side * (w / 2 + post / 2), floorY + (h + beam) / 2, z + 0.03]}
          map={cardboard}
          tile={tile}
        />
      ))}
      <TiledBox
        size={[w + 2 * post, beam, 0.06]}
        position={[x, floorY + h + beam / 2, z + 0.03]}
        map={cardboard}
        tile={tile}
      />
      {/* The main curtain, made to the inspect stage's size. */}
      <group position={[x, floorY, z]} scale={[w / OPENING.width, h / OPENING.height, 1]}>
        <Curtain open={curtainOpen} />
      </group>

      {active && image !== null && (
        <ImageBoundary key={image.url}>
          <Suspense fallback={null}>
            <Cutout
              url={image.url}
              width={image.width}
              height={image.height}
              position={[x, floorY + 0.03, z - depth * 0.45]}
              scale={fit}
              mount="stand"
            />
          </Suspense>
        </ImageBoundary>
      )}

      {active && papers && (
        <>
          <Paper
            position={INSPECT_TITLE.center}
            units={INSPECT_TITLE.unitsPerPx}
            widthPx={INSPECT_TITLE.widthPx}
          >
            {title}
          </Paper>
          <Paper
            position={INSPECT_CARD.center}
            rotation={[INSPECT_CARD.tilt, 0, 0]}
            units={INSPECT_CARD.unitsPerPx}
            widthPx={INSPECT_CARD.widthPx}
            heightPx={INSPECT_CARD.heightPx}
          >
            {card}
          </Paper>
        </>
      )}
    </group>
  );
}

/** A pad of sticky notes on the table; while `note` is given, the top one is written on. */
export function StickyPad({
  pad,
  note,
}: {
  pad: typeof INSPECT_PAD | typeof BINDER_PAD;
  note: ReactNode | null;
}) {
  const [x, y, z] = pad.center;
  return (
    <group>
      <mesh position={[x, y + pad.thickness / 2, z]} rotation={[0, 0.08, 0]}>
        <boxGeometry args={[pad.size, pad.thickness, pad.size]} />
        <meshLambertMaterial color={STAGE_COLORS.sticky} />
      </mesh>
      {note !== null && (
        <Paper
          position={[x, y + pad.thickness + 0.002, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          units={unitsPerPx(pad.size, pad.sizePx)}
          widthPx={pad.sizePx}
          heightPx={pad.sizePx}
        >
          {note}
        </Paper>
      )}
    </group>
  );
}

/**
 * The three-ring binder (§12): closed on the table until it is picked up, then open with its
 * cover swung to the left and the page lying on the right.
 */
export function Binder({
  open,
  page,
  onOpen,
}: {
  open: boolean;
  /** The open page; null until the camera has arrived to read it. */
  page: ReactNode | null;
  onOpen?: () => void;
}) {
  const [x, y, z] = BINDER.center;
  const { width, depth } = BINDER.page;
  const t = BINDER.thickness;
  const cover = useRef<Group>(null);
  const progress = useRef(open ? 1 : 0);

  useFrame((_state, delta) => {
    progress.current = MathUtils.damp(progress.current, open ? 1 : 0, COVER_SPEED, delta);
    // Hinged at the spine, the binder's left edge: closed it lies over the pages, open it lies
    // flat to the left of them.
    if (cover.current !== null) cover.current.rotation.z = progress.current * Math.PI;
  });

  return (
    <group
      position={[x, y, z]}
      onClick={(event) => {
        if (open || onOpen === undefined) return;
        event.stopPropagation();
        onOpen();
      }}
    >
      {/* The pages, and the back cover under them. */}
      <mesh position={[0, t * 0.4, 0]}>
        <boxGeometry args={[width + 2 * COVER_LIP, t * 0.8, depth + 2 * COVER_LIP]} />
        <meshLambertMaterial color={STAGE_COLORS.paper} />
      </mesh>
      {/* The rings, along the spine. */}
      {[-1, 0, 1].map((ring) => (
        <mesh
          key={ring}
          position={[-width / 2 + 0.03, t * 0.8, (ring * depth) / 3.2]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <torusGeometry args={[0.025, 0.006, 6, 16, Math.PI]} />
          <meshLambertMaterial color={STAGE_COLORS.ring} />
        </mesh>
      ))}
      {/* The front cover, hinged at the spine. */}
      <group ref={cover} position={[-width / 2 - COVER_LIP, t * 0.85, 0]}>
        <mesh position={[(width + 2 * COVER_LIP) / 2, 0, 0]}>
          <boxGeometry args={[width + 2 * COVER_LIP, 0.012, depth + 2 * COVER_LIP]} />
          <meshLambertMaterial color={STAGE_COLORS.binder} />
        </mesh>
      </group>
      {open && page !== null && (
        <Paper
          position={[0, t * 0.8 + 0.003, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          units={unitsPerPx(width, BINDER.pageWidthPx)}
          widthPx={BINDER.pageWidthPx}
          heightPx={BINDER.pageHeightPx}
        >
          {page}
        </Paper>
      )}
    </group>
  );
}
