import {
  isEmptyRichText,
  type Ability,
  type PlayerCharacterSheet,
  type Ruleset,
  type Weapon,
} from '@stagehand/shared';
import type { ReactNode } from 'react';

import { RichTextView } from '@/components/records/RichTextView';
import { enumLabel } from '@/lib/records';

import { formatModifier } from './format';
import { Group } from './layout';

/**
 * A player's own sheet, read-only (D-23): the same groups as the GM's editor, shown as
 * text, with empty groups left out. It renders no form controls.
 */
export function CharacterSheetView({
  sheet,
  ruleset,
}: {
  sheet: PlayerCharacterSheet;
  ruleset: Ruleset;
}) {
  const weapons = [
    ...(sheet.weapons.primary === null ? [] : [{ slot: 'Primary', weapon: sheet.weapons.primary }]),
    ...(sheet.weapons.secondary === null
      ? []
      : [{ slot: 'Secondary', weapon: sheet.weapons.secondary }]),
    ...sheet.weapons.inventory.map((weapon) => ({ slot: 'Spare', weapon })),
  ];
  const gold = sheet.gold;
  const hasGold = gold.handfuls + gold.bags + gold.chests > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{sheet.name}</h1>
        <p className="text-muted-foreground">
          Level {sheet.level}
          {sheet.className !== '' && ` ${sheet.className}`}
        </p>
      </div>

      {!isEmptyRichText(sheet.publicDescription) && (
        <Group title="Description">
          <RichTextView value={sheet.publicDescription} />
        </Group>
      )}

      <Group title="Traits">
        <Stats
          items={ruleset.traits.map((trait) => [
            trait.label,
            formatModifier(sheet.traits[trait.id] ?? 0),
          ])}
        />
      </Group>

      <Group title="Defense">
        <Stats
          items={[
            ['Evasion', sheet.evasion],
            ['Armor score', sheet.armorScore],
            [
              'Armor slots',
              `${String(sheet.armorSlotsMarked)} of ${String(sheet.armorSlotsMax)} marked`,
            ],
          ]}
        />
      </Group>

      <Group title="Health">
        <Stats
          items={[
            [
              'Thresholds',
              `${String(sheet.minorThreshold)} / ${String(sheet.majorThreshold)} / ${String(sheet.severeThreshold)}`,
            ],
            ['HP', `${String(sheet.hpCurrent)} of ${String(sheet.hpMax)}`],
            ['Stress', `${String(sheet.stressCurrent)} of ${String(sheet.stressMax)}`],
          ]}
        />
      </Group>

      <Group title="Hope and proficiency">
        <Stats
          items={[
            ['Hope', `${String(sheet.hope)} of ${String(ruleset.hopeMax)}`],
            ['Proficiency', sheet.proficiency],
          ]}
        />
      </Group>

      {sheet.experiences.length > 0 && (
        <Group title="Experiences">
          <ul className="space-y-1">
            {sheet.experiences.map((experience, index) => (
              <li key={index}>
                {experience.name}{' '}
                <span className="text-muted-foreground">{formatModifier(experience.bonus)}</span>
              </li>
            ))}
          </ul>
        </Group>
      )}

      {weapons.length > 0 && (
        <Group title="Weapons">
          <ul className="space-y-3">
            {weapons.map(({ slot, weapon }, index) => (
              <li key={index}>
                <WeaponLine slot={slot} weapon={weapon} ruleset={ruleset} />
              </li>
            ))}
          </ul>
        </Group>
      )}

      {sheet.armor !== null && (
        <Group title="Armor">
          <p className="font-medium">{sheet.armor.name}</p>
          <Stats
            items={[
              ['Base score', sheet.armor.baseScore],
              [
                'Base thresholds',
                `${String(sheet.armor.baseMajorThreshold)} / ${String(sheet.armor.baseSevereThreshold)}`,
              ],
            ]}
          />
          <Text value={sheet.armor.feature} />
        </Group>
      )}

      {(sheet.inventory.length > 0 || hasGold) && (
        <Group title="Inventory">
          {sheet.inventory.length > 0 && (
            <ul className="space-y-1">
              {sheet.inventory.map((item, index) => (
                <li key={index}>
                  <span className="font-medium">{item.name}</span>
                  {item.detail !== '' && (
                    <span className="text-muted-foreground"> — {item.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {hasGold && (
            <Stats
              items={[
                ['Handfuls of gold', gold.handfuls],
                ['Bags of gold', gold.bags],
                ['Chests of gold', gold.chests],
              ]}
            />
          )}
        </Group>
      )}

      {sheet.classFeature !== null && (
        <Group title="Class feature">
          <p className="font-medium">{sheet.classFeature.name}</p>
          <Text value={sheet.classFeature.description} />
        </Group>
      )}

      {sheet.combatOptions.length > 0 && (
        <Group title="Combat options">
          <ul className="space-y-3">
            {sheet.combatOptions.map((option, index) => (
              <li key={index}>
                <AbilityLine ability={option} />
              </li>
            ))}
          </ul>
        </Group>
      )}
    </div>
  );
}

/** Label/value pairs as a definition list. */
export function Stats({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Plain text that keeps its line breaks; nothing when empty. */
export function Text({ value }: { value: string }) {
  if (value === '') return null;
  return <p className="text-sm whitespace-pre-line">{value}</p>;
}

function WeaponLine({ slot, weapon, ruleset }: { slot: string; weapon: Weapon; ruleset: Ruleset }) {
  const trait = ruleset.traits.find((t) => t.id === weapon.trait)?.label;
  const details = [
    trait,
    weapon.range,
    `${weapon.damageDice}${weapon.damageType === '' ? '' : ` ${weapon.damageType}`}`,
  ].filter((part) => part !== undefined && part !== '');
  return (
    <>
      <p>
        <span className="font-medium">{weapon.name}</span>{' '}
        <span className="text-sm text-muted-foreground">({slot})</span>
      </p>
      <p className="text-sm">{details.join(' · ')}</p>
      <Text value={weapon.feature} />
    </>
  );
}

export function AbilityLine({ ability }: { ability: Ability }) {
  return (
    <>
      <p>
        <span className="font-medium">{ability.name}</span>{' '}
        <span className="text-sm text-muted-foreground">
          {enumLabel(ability.kind)}
          {ability.cost !== '' && ` · ${ability.cost}`}
        </span>
      </p>
      <Text value={ability.description} />
    </>
  );
}
