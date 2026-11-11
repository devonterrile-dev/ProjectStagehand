import type { Ability, Armor, Attack, Experience, InventoryItem, Weapon } from '@stagehand/shared';

/** Blank rows for the Add buttons. Damage dice start valid so a new row can save. */
export const blank = {
  experience: (): Experience => ({ name: '', bonus: 1 }),
  ability: (): Ability => ({ name: '', kind: 'action', cost: '', description: '' }),
  attack: (): Attack => ({ name: '', range: '', damageDice: '1d6', damageType: '' }),
  weapon: (): Weapon => ({
    name: '',
    trait: null,
    range: '',
    damageDice: '1d6',
    damageType: '',
    feature: '',
  }),
  armor: (): Armor => ({
    name: '',
    baseMajorThreshold: 0,
    baseSevereThreshold: 0,
    baseScore: 0,
    feature: '',
  }),
  item: (): InventoryItem => ({ name: '', detail: '' }),
  named: () => ({ name: '', description: '' }),
};

/** A row counts once it has a name. */
export const hasName = (row: { name: string }) => row.name.trim() !== '';
