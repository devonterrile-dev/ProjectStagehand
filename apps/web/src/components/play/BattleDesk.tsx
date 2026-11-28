import {
  BATTLE_SIZE_NAMES,
  battleSquares,
  squareName,
  type ActionResult,
  type BattleSide,
  type BattleSize,
  type GmStage,
} from '@stagehand/shared';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import type { PlayRoom } from '@/play/room';

import { Section } from './DeskSection';

export type BattleRoom = Pick<PlayRoom, 'startBattle' | 'endBattle' | 'moveToken'>;

const SIZE_LABELS: Record<BattleSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

/** A token's side, in the GM's words: its clip's color. */
const SIDE_LABELS: Record<BattleSide, string> = {
  pc: 'PC, blue',
  npc: 'NPC, green',
  monster: 'Monster, red',
};

/**
 * The desk's Battle section (F5.5, governance §12 "Battle mode"). With no battle on: a mat size
 * to lay out. During one: every token, on its square or waiting beside the mat, each placed by
 * dragging it in the theater and taken off here; and End battle, which asks first, since the
 * tokens' places go with the mat.
 */
export function BattleSection({
  stage,
  room,
  idle,
  send,
}: {
  stage: GmStage;
  room: BattleRoom;
  idle: boolean;
  send: (action: () => Promise<ActionResult>) => Promise<void>;
}) {
  const [ending, setEnding] = useState(false);
  const { battle } = stage;

  if (battle === null) {
    return (
      <Section title="Battle">
        <p className="text-xs text-muted-foreground">
          Lay out a battle mat: the curtain closes and every puppet on the stage gets a token beside
          the mat.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {BATTLE_SIZE_NAMES.map((size) => {
            const squares = String(battleSquares(size));
            return (
              <Button
                key={size}
                size="xs"
                variant="secondary"
                disabled={!idle}
                aria-label={`Battle: ${SIZE_LABELS[size]}, ${squares} × ${squares}`}
                onClick={() => void send(() => room.startBattle(size))}
              >
                <span className="flex flex-col leading-tight">
                  <span>{SIZE_LABELS[size]}</span>
                  <span className="text-[0.65rem] text-muted-foreground">
                    {squares} × {squares}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </Section>
    );
  }

  const squares = String(battleSquares(battle.size));
  const names = new Map(stage.objects.map((object) => [object.id, object.subject.name]));
  return (
    <Section title="Battle">
      <p role="status" className="text-xs text-muted-foreground">
        {SIZE_LABELS[battle.size]} mat, {squares} × {squares}. Drag a token onto a square; players
        see only the tokens on the mat. Placing an NPC reveals it.
      </p>
      {battle.tokens.length === 0 ? (
        <p className="text-muted-foreground">No puppets on the stage, so no tokens.</p>
      ) : (
        <ul aria-label="Tokens" className="space-y-1.5">
          {battle.tokens.map((token) => {
            const name = names.get(token.id) ?? 'A puppet';
            return (
              <li key={token.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {SIDE_LABELS[token.side]} ·{' '}
                    {token.square === null ? 'Beside the mat' : `On ${squareName(token.square)}`}
                  </span>
                </span>
                {token.square !== null && (
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={!idle}
                    aria-label={`Take off: ${name}`}
                    onClick={() => void send(() => room.moveToken(token.id, null))}
                  >
                    Take off
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        disabled={!idle}
        onClick={() => {
          setEnding(true);
        }}
      >
        End battle
      </Button>
      <ConfirmDialog
        open={ending}
        onOpenChange={setEnding}
        title="End the battle?"
        description="The mat rolls up with its tokens, and everyone looks back at the stage. The curtain stays closed, so you can tidy the stage before opening it."
        confirmLabel="End battle"
        onConfirm={() => send(() => room.endBattle())}
      />
    </Section>
  );
}
