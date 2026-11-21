import type { DomainCardType } from '@stagehand/shared';

const TYPE_LABELS: Record<DomainCardType, string> = {
  ability: 'Ability',
  spell: 'Spell',
  grimoire: 'Grimoire',
};

/** "Ability", "Spell" or "Grimoire" (F4.3). */
export function cardTypeLabel(type: DomainCardType): string {
  return TYPE_LABELS[type];
}
