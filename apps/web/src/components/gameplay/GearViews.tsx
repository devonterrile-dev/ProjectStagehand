import {
  formatDamage,
  traitLabel,
  type ArmorRecord,
  type GearBonuses,
  type Ruleset,
  type WeaponRecord,
} from '@stagehand/shared';
import type { ReactNode } from 'react';

import { bonusesLabel, burdenLabel, damageKindLabel, rangeLabel, slotLabel } from './labels';

/**
 * Weapons and armor drawn as cards (F4.4): what players read on the gameplay pages, and what
 * F4.7 lays beside the sheet page. Read, never run (§8): only the bonuses apply themselves, and
 * only once a sheet equips the gear (19.25).
 */
function GearCard({
  label,
  corner,
  name,
  children,
}: {
  label: string;
  corner: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <article
      aria-label={label}
      className="mx-auto max-w-sm overflow-hidden rounded-xl border-2 bg-card shadow-sm"
    >
      <header className="flex items-center justify-between gap-2 bg-muted px-4 py-2 text-sm font-medium">
        <span>{corner}</span>
      </header>
      <div className="space-y-3 px-4 py-4">
        <h1 className="text-xl font-bold">{name}</h1>
        {children}
      </div>
    </article>
  );
}

function Facts({ facts }: { facts: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {facts.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Feature({
  name,
  text,
  bonuses,
  ruleset,
}: {
  name: string;
  text: string;
  bonuses: GearBonuses;
  ruleset: Ruleset;
}) {
  const applied = bonusesLabel(bonuses, ruleset);
  return (
    <>
      {name === '' && text === '' ? (
        <p className="text-sm text-muted-foreground">No feature.</p>
      ) : (
        <p className="text-sm whitespace-pre-line">
          {name !== '' && <strong>{name}: </strong>}
          {text}
        </p>
      )}
      {applied !== '' && <p className="text-sm text-muted-foreground">While equipped: {applied}</p>}
    </>
  );
}

export function WeaponView({ weapon, ruleset }: { weapon: WeaponRecord; ruleset: Ruleset }) {
  return (
    <GearCard
      label={`${weapon.name}, a tier ${String(weapon.tier)} ${weapon.slot} weapon`}
      corner={`Tier ${String(weapon.tier)} · ${slotLabel(weapon.slot)} weapon`}
      name={weapon.name}
    >
      <Facts
        facts={[
          ['Trait', traitLabel(ruleset, weapon.trait)],
          ['Range', rangeLabel(weapon.range)],
          [
            'Damage',
            `${formatDamage(weapon.damageDie, weapon.damageBonus)} ${damageKindLabel(weapon.kind).toLowerCase()}`,
          ],
          ['Burden', burdenLabel(weapon.burden)],
        ]}
      />
      <Feature
        name={weapon.featureName}
        text={weapon.featureText}
        bonuses={weapon.bonuses}
        ruleset={ruleset}
      />
    </GearCard>
  );
}

export function ArmorView({ armor, ruleset }: { armor: ArmorRecord; ruleset: Ruleset }) {
  return (
    <GearCard
      label={`${armor.name}, tier ${String(armor.tier)} armor`}
      corner={`Tier ${String(armor.tier)} · Armor`}
      name={armor.name}
    >
      <Facts
        facts={[
          [
            'Thresholds',
            `${String(armor.baseMajorThreshold)} / ${String(armor.baseSevereThreshold)}`,
          ],
          ['Armor score', String(armor.baseScore)],
        ]}
      />
      <Feature
        name={armor.featureName}
        text={armor.featureText}
        bonuses={armor.bonuses}
        ruleset={ruleset}
      />
    </GearCard>
  );
}
