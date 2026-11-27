import { traitLabel, type RollEdge, type RollResult, type Ruleset } from '@stagehand/shared';

/** A roll's heading, as the table and the desk say it: "Mira rolled Agility (Climb the wall)". */
export function rollTitle(roll: RollResult, ruleset: Ruleset): string {
  const label = roll.label === null ? '' : ` (${roll.label})`;
  return `${roll.characterName} rolled ${traitLabel(ruleset, roll.trait)}${label}`;
}

/** The desk's choices for a call's edge (F5.1), in order. */
export const EDGE_CHOICES: readonly { edge: RollEdge; label: string }[] = [
  { edge: 'none', label: 'None' },
  { edge: 'advantage', label: 'Roll with advantage' },
  { edge: 'disadvantage', label: 'Roll with disadvantage' },
];

/** " with advantage", " with disadvantage", or nothing: the end of "Vex is rolling Agility…". */
export function withEdge(edge: RollEdge): string {
  return edge === 'none' ? '' : ` with ${edge}`;
}
