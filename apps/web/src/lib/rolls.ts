import { traitLabel, type RollResult, type Ruleset } from '@stagehand/shared';

/** A roll's heading, as the table and the desk say it: "Mira rolled Agility (Climb the wall)". */
export function rollTitle(roll: RollResult, ruleset: Ruleset): string {
  const label = roll.label === null ? '' : ` (${roll.label})`;
  return `${roll.characterName} rolled ${traitLabel(ruleset, roll.trait)}${label}`;
}
