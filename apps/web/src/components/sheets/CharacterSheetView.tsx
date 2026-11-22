import {
  hopeSpendBonusOf,
  isEmptyRichText,
  tierOf,
  type Ability,
  type BuiltWeapon,
  type CharacterTracksRequest,
  type TrackKey,
  type PlayerCharacterSheet,
  type Ruleset,
} from '@stagehand/shared';
import type { ReactNode } from 'react';

import { FeatureList } from '@/components/gameplay/ClassViews';
import { hopeFeatureLabel } from '@/components/gameplay/labels';
import { RichTextView } from '@/components/records/RichTextView';
import { enumLabel } from '@/lib/records';

import { formatModifier } from './format';
import { Group } from './layout';
import { DefenseBadges, Pips, ThresholdStrip } from './Tracks';

/**
 * A player's own sheet, read-only (D-23): the same groups as the GM's editor, shown as
 * text, with empty groups left out. It renders no form controls. From F4.7 it shows the values
 * built from the linked records, in two columns: Health, Defense and Weapons on the left; the
 * traits, Hope and Experiences on the right; the rest below, and the description last. The
 * subclass, ancestry and domain cards lie beside it (`SideCards`), not on it.
 */
export function CharacterSheetView({
  sheet,
  ruleset,
  onTracks,
}: {
  sheet: PlayerCharacterSheet;
  ruleset: Ruleset;
  /** The player marks their own Hope, HP, Stress and armor slots (D-67); read-only without. */
  onTracks?: (patch: CharacterTracksRequest) => Promise<unknown>;
}) {
  const track = (key: TrackKey) =>
    onTracks === undefined ? undefined : (value: number) => onTracks({ [key]: value });
  const built = sheet.built;
  const weapons = [
    ...(built.weapons.primary === null ? [] : [{ slot: 'Primary', weapon: built.weapons.primary }]),
    ...(built.weapons.secondary === null
      ? []
      : [{ slot: 'Secondary', weapon: built.weapons.secondary }]),
    ...built.weapons.spares.map((weapon) => ({ slot: 'Spare', weapon })),
  ];
  const { major, severe, minor } = built.thresholds;
  const tier = tierOf(sheet.level, ruleset);
  const gold = sheet.gold;
  const hasGold = gold.handfuls + gold.bags + gold.chests > 0;
  const linkedClass = sheet.cards.class;
  // Traits raised by a level-up in the PC's tier are marked until the next tier (F4.9).
  const marked = new Set(
    sheet.levelUp.history
      .filter((entry) => tierOf(entry.level, ruleset) === tier)
      .flatMap((entry) => entry.picks.flatMap((pick) => pick.traits ?? [])),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{sheet.name}</h1>
        <p className="text-muted-foreground">
          Level {sheet.level}
          {built.className !== '' && ` ${built.className}`}
          {tier !== null && ` · tier ${String(tier)}`}
        </p>
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-4">
          <Group title="Health">
            <ThresholdStrip minor={minor} major={major} severe={severe} />
            <Pips
              label="HP"
              value={sheet.hpCurrent}
              max={sheet.hpMax}
              tone="hp"
              onSet={track('hpCurrent')}
            />
            <Pips
              label="Stress"
              value={sheet.stressCurrent}
              max={sheet.stressMax}
              tone="stress"
              onSet={track('stressCurrent')}
            />
          </Group>

          <Group title="Defense">
            <DefenseBadges
              evasion={built.evasion}
              armorScore={built.armorScore}
              armorName={built.armorName}
              slotsMarked={sheet.armorSlotsMarked}
              slotsMax={built.armorSlotsMax}
              onSetSlots={track('armorSlotsMarked')}
            />
          </Group>

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
        </div>

        <div className="space-y-4">
          <Group title="Traits">
            <Rows
              items={ruleset.traits.map((trait) => [
                trait.label,
                <>
                  {formatModifier(built.traits[trait.id] ?? 0)}
                  {marked.has(trait.id) && (
                    <span
                      title="Raised this tier: it can't be raised again until the next tier"
                      aria-label="marked"
                      className="ml-1 inline-block size-2 rounded-full bg-stone-700 align-middle"
                    />
                  )}
                </>,
              ])}
            />
          </Group>

          <Group title="Hope and proficiency">
            <Pips
              label="Hope"
              value={sheet.hope}
              max={ruleset.hopeMax}
              tone="hope"
              onSet={track('hope')}
            />
            <Rows
              items={[
                ['Spending Hope adds', `+${String(hopeSpendBonusOf(ruleset, sheet.hopeBonus))}`],
                ['Proficiency', sheet.proficiency],
              ]}
            />
          </Group>

          {sheet.experiences.length > 0 && (
            <Group title="Experiences">
              <Rows
                items={sheet.experiences.map((experience) => [
                  experience.name,
                  formatModifier(experience.bonus),
                ])}
              />
            </Group>
          )}
        </div>
      </div>

      {!built.linked.armor && sheet.armor !== null && (
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

      {linkedClass !== null ? (
        <Group title="Class features">
          <section aria-label="Hope feature" className="space-y-1">
            <h3 className="text-sm font-semibold">Hope feature</h3>
            <p className="text-sm whitespace-pre-line">
              <strong>{hopeFeatureLabel(linkedClass.hopeFeature)}</strong>
              {linkedClass.hopeFeature.text !== '' && `: ${linkedClass.hopeFeature.text}`}
            </p>
          </section>
          <FeatureList title="Class features" features={linkedClass.classFeatures} />
        </Group>
      ) : (
        sheet.classFeature !== null && (
          <Group title="Class features">
            <p className="font-medium">{sheet.classFeature.name}</p>
            <Text value={sheet.classFeature.description} />
          </Group>
        )
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

      {!isEmptyRichText(sheet.publicDescription) && (
        <Group title="Description">
          <RichTextView value={sheet.publicDescription} />
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

/** Label/value pairs, one to a row with the value at the right: the narrow column's list. */
function Rows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="space-y-1">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
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

function WeaponLine({
  slot,
  weapon,
  ruleset,
}: {
  slot: string;
  weapon: BuiltWeapon;
  ruleset: Ruleset;
}) {
  const trait = ruleset.traits.find((t) => t.id === weapon.trait)?.label;
  const details = [
    trait,
    weapon.range,
    `${weapon.damage}${weapon.damageType === '' ? '' : ` ${weapon.damageType}`}`,
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
