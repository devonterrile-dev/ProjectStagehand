import type { Square, StageTravel, Stroke } from '@stagehand/shared';
import { memo, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';

import type { StageCutout } from '@/lib/scenes';
import type { StrokeBrush } from '@/play/room';
import type { BattleView } from '@/play/stage';

import { BattleMat } from './BattleMat';
import { BattleTokens } from './BattleTokens';
import type { StageView } from './camera';
import { MatPaint, type MatBrush } from './MatPaint';
import type { Place } from './placement';
import { PuppetMenu } from './PuppetMenu';
import { SceneObjects, type StageMotion } from './SceneObjects';
import { StageCanvas } from './StageCanvas';
import {
  Dice,
  FearBowl,
  FreeDice,
  SheetPage,
  type DiceRoll,
  type FreeDiceRoll,
  type SheetSideCards,
} from './RollPieces';
import { BINDER_PAD, INSPECT_PAD } from './table-layout';
import { Binder, InspectStage, StickyPad, type InspectImage } from './TablePieces';
import { anchorTravel, type TravelAnchor } from './travel';

/**
 * The table around the theater (F3.5b): where the camera rests, and what is out on it. The
 * HTML pieces are made by the page; each is null while it isn't in view.
 */
export interface TableScene {
  view: StageView;
  inspect: {
    image: InspectImage | null;
    /** The paper sign with the record's name. */
    title: ReactNode;
    /** The paper card with its public description. */
    card: ReactNode;
  } | null;
  /** The sticky note being written on the pad in front of the inspect stage. */
  inspectNote: ReactNode | null;
  /** The binder's open page; null while it is closed. */
  binderPage: ReactNode | null;
  /** The sticky note being written on the pad beside the binder. */
  binderNote: ReactNode | null;
  /** The closed binder was picked up. */
  onOpenBinder: () => void;
  /** A press on the table that hit nothing: put down what is being looked at. */
  onPutDown: () => void;
  /**
   * The player's sheet page (F3.6): its HTML while it is looked at, and whether a roll called
   * for their PC waits. Null for the GM, and for a player without a PC.
   */
  sheet: { page: ReactNode | null; cards: SheetSideCards | null; waiting: boolean } | null;
  onOpenSheet: () => void;
  /** The last roll's dice (F3.6); null before the session's first. */
  dice: DiceRoll | null;
  /** The last free roll's dice (F4.2); null before the session's first. */
  freeDice: FreeDiceRoll | null;
  /** The GM's Fear (F3.6): the count, and the last spend. */
  fear: { count: number; spendId: string | null };
}

export interface PlayCanvasProps {
  /** The backdrop on the back wall; null leaves the wall bare. */
  backdropUrl: string | null;
  /** What is in sight, in list order. */
  objects: readonly StageCutout[];
  curtainOpen: boolean;
  /** The GM's theater (F3.4): the object picked on the desk, framed. */
  selectedId?: string | null;
  /** The GM's theater: a cutout was pressed, or (null) the empty theater was. */
  onSelect?: (id: string | null) => void;
  /** The GM's theater: a pressed cutout is being dragged across and up its depth tick. */
  onMove?: (id: string, place: Place) => void;
  /** A player's theater (F3.5b): a cutout of a revealed record was pressed, to inspect it. */
  onInspect?: (recordId: string) => void;
  /** The table around the theater (F3.5b). */
  table?: TableScene;
  /** Who is talking and the emotes played (F3.7), for every puppet in sight. */
  motion?: StageMotion;
  /** A player's own puppet (F3.7): pressing it opens their emote card beside it. */
  own?: OwnPuppet;
  /**
   * The loaded transition scene's travel (F5.4), as the stage last sent it: the backdrop scrolls
   * and passers move by from it. Null or left out for a static scene.
   */
  travel?: StageTravel | null;
  /**
   * The battle on the table (F5.5): the mat and its tokens; null or left out when there is
   * none. The camera's Stage view becomes the Battle view meanwhile.
   */
  battle?: BattleView | null;
  /** The GM's table (F5.5): a token was dropped on a square, or (null) off the mat. */
  onMoveToken?: (id: string, square: Square | null) => void;
  /**
   * The GM's brush on the mat (F5.6): with Paint or Erase in hand a drag on the mat lays a stroke
   * (`onPaint`) instead of moving a token.
   */
  brush?: MatBrush;
  onPaint?: (stroke: StrokeBrush, points: number[]) => void;
}

const NOTHING: readonly StageCutout[] = [];
const NO_STROKES: readonly Stroke[] = [];

/** A player's own PC's puppet and its emote card (F3.7). */
export interface OwnPuppet {
  characterId: string;
  /** Their puppet was pressed. */
  onPress: (objectId: string) => void;
  /** The emote card, open beside that puppet; null while it is closed. */
  menu: { objectId: string; card: ReactNode } | null;
  /** Something else was pressed: the card closes. */
  onClose: () => void;
}

/** How long a lowered puppet is still drawn, sinking into the void, once it has left the stage. */
export const LEAVING_MS = 700;

/** How long the curtain takes to close (`Curtain.tsx`), with a little to spare. */
const CURTAIN_CLOSED_MS = 1200;

/**
 * Whether the theater is out of sight behind a closed curtain during a battle (F5.5): the
 * stage's cutouts aren't drawn meanwhile, so the tokens stand in for them in the draw budget
 * (§12). True only once the curtain has had time to close; false again at once.
 */
function useStageHidden(hidden: boolean): boolean {
  const [closed, setClosed] = useState(false);
  // Worked out while rendering: opened again, it shows at once, and closing starts afresh.
  if (!hidden && closed) setClosed(false);
  useEffect(() => {
    if (!hidden) return;
    const timer = window.setTimeout(() => {
      setClosed(true);
    }, CURTAIN_CLOSED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [hidden]);
  return hidden && closed;
}

/**
 * Puppets that have just left `objects` (lowered, or taken off the stage), kept a moment longer
 * and drawn lowered, so they sink out of sight instead of vanishing. Props simply go, except a
 * passer in a transition scene (F5.4), which leaves the same way, down or up, as it slides on.
 */
function useLeaving(objects: readonly StageCutout[]): readonly StageCutout[] {
  const [previous, setPrevious] = useState(objects);
  const [leaving, setLeaving] = useState<readonly StageCutout[]>([]);

  // Worked out while rendering, from the list before: the documented way to follow a prop.
  if (objects !== previous) {
    const present = new Set(objects.map((object) => object.id));
    const gone = previous.filter(
      (object) =>
        !present.has(object.id) &&
        !object.lowered &&
        (object.mount === 'stick' || (object.passFrom ?? null) !== null),
    );
    setPrevious(objects);
    setLeaving((current) => [
      ...current.filter((object) => !present.has(object.id)),
      ...gone.map((object) => ({ ...object, lowered: true })),
    ]);
  }

  useEffect(() => {
    if (leaving.length === 0) return;
    const timer = window.setTimeout(() => {
      setLeaving([]);
    }, LEAVING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving]);

  return leaving.length === 0 ? objects : [...objects, ...leaving];
}

/**
 * The theater during a live session (F3.3, F3.4): the locked player camera for everyone, the GM
 * included. Cutouts glide when they move, and puppets rise out of the void and sink back into
 * it. In the GM's theater a cutout can be picked and dragged; in a player's, a revealed record's
 * cutout can be pressed to inspect it. Around it is the table (F3.5b): the inspect stage, the
 * sticky pads and the binder, and the camera turns to whichever is in use; and (F3.6) the
 * player's sheet page, the dice and the GM's Fear bowl; and (F3.7) puppets that sway, talk and
 * emote, with the emote card beside a player's own puppet. Everything it takes
 * is plain data or finished HTML, so the page around it never touches Three.js, and tests can
 * put a stand-in in its place. Memoized: the desk beside it re-rendering must not re-render the
 * scene.
 */
export const PlayCanvas = memo(function PlayCanvas({
  backdropUrl,
  objects,
  curtainOpen,
  selectedId = null,
  onSelect,
  onMove,
  onInspect,
  table,
  motion,
  own,
  travel = null,
  battle = null,
  onMoveToken,
  brush,
  onPaint,
}: PlayCanvasProps) {
  const drawn = useLeaving(objects);
  // The GM's hand on the mat (F5.6): painting or rubbing out takes the press from the tokens.
  const painting = brush !== undefined && brush.tool !== 'move';
  const stageHidden = useStageHidden(battle !== null && !curtainOpen);
  const [dragging, setDragging] = useState(false);

  // The travel anchored to when this stage arrived (F5.4); the canvas reads it each frame.
  const anchor = useRef<TravelAnchor | null>(null);
  useEffect(() => {
    anchor.current = anchorTravel(travel, performance.now());
  }, [travel]);

  // The papers on the table are laid out once the camera has arrived where they are: HTML on
  // the table flickers while the camera moves past it.
  const view = table?.view ?? (battle === null ? 'stage' : 'battle');
  const [arrivedAt, setArrivedAt] = useState<StageView | null>('stage');
  const [headingTo, setHeadingTo] = useState(view);
  if (view !== headingTo) {
    setHeadingTo(view);
    setArrivedAt(null);
  }
  const settled = arrivedAt === view;

  // A press on a cutout: the GM picks it; a player opens the emote card on their own puppet
  // (F3.7), or inspects the record a cutout shows, if any.
  const press =
    onSelect ??
    (onInspect === undefined
      ? undefined
      : (id: string | null) => {
          const pressed = drawn.find((object) => object.id === id);
          if (own !== undefined && pressed !== undefined) {
            if (pressed.characterId === own.characterId) {
              own.onPress(pressed.id);
              return;
            }
            own.onClose();
          }
          const recordId = pressed?.recordId;
          if (recordId !== undefined && recordId !== null) onInspect(recordId);
        });

  // The card stays beside the puppet while it is in sight, and only on the stage view.
  const menuAt =
    own?.menu == null || view !== 'stage'
      ? -1
      : objects.findIndex((object) => object.id === own.menu?.objectId);
  const menuFor = menuAt === -1 ? undefined : objects[menuAt];

  return (
    <StageCanvas
      backdropUrl={backdropUrl}
      curtainOpen={curtainOpen}
      view={view}
      battle={battle?.size ?? null}
      travel={anchor}
      onCameraSettle={setArrivedAt}
      onPointerMissed={() => {
        onSelect?.(null);
        own?.onClose();
        // A click away puts down what is being looked at, once it is in view.
        if (table !== undefined && view !== 'stage' && settled) table.onPutDown();
      }}
    >
      <SceneObjects
        objects={stageHidden ? NOTHING : drawn}
        selectedId={selectedId}
        glide
        snapId={dragging ? selectedId : null}
        {...(press === undefined ? {} : { onSelect: press })}
        // A player inspects on a whole click: the camera turns away as soon as it counts.
        {...(onInspect !== undefined && onSelect === undefined
          ? { pressOn: 'click' as const }
          : {})}
        {...(onMove === undefined ? {} : { onMove, onDragChange: setDragging })}
        {...(motion === undefined ? {} : { motion })}
      />
      {menuFor !== undefined && own?.menu != null && (
        <PuppetMenu cutout={menuFor} index={menuAt}>
          {own.menu.card}
        </PuppetMenu>
      )}
      {table !== undefined && (
        <Suspense fallback={null}>
          <InspectStage
            active={table.inspect !== null}
            papers={settled}
            image={table.inspect?.image ?? null}
            title={table.inspect?.title ?? null}
            card={table.inspect?.card ?? null}
          />
          <StickyPad pad={INSPECT_PAD} note={settled ? table.inspectNote : null} />
          <Binder
            open={table.binderPage !== null}
            page={settled ? table.binderPage : null}
            onOpen={table.onOpenBinder}
          />
          <StickyPad pad={BINDER_PAD} note={settled ? table.binderNote : null} />
          {table.sheet !== null && (
            <SheetPage
              page={settled ? table.sheet.page : null}
              cards={table.sheet.cards}
              waiting={table.sheet.waiting}
              onOpen={table.onOpenSheet}
              slid={battle !== null}
            />
          )}
          <Dice roll={table.dice} />
          <FreeDice roll={table.freeDice} />
          <FearBowl fear={table.fear.count} spendId={table.fear.spendId} />
        </Suspense>
      )}
      <BattleMat size={battle?.size ?? null} strokes={battle?.strokes ?? NO_STROKES} />
      <BattleTokens
        battle={battle}
        {...(onMoveToken === undefined || painting ? {} : { onMoveToken })}
      />
      {battle !== null && brush !== undefined && painting && onPaint !== undefined && (
        <MatPaint size={battle.size} brush={brush} onPaint={onPaint} />
      )}
    </StageCanvas>
  );
});
