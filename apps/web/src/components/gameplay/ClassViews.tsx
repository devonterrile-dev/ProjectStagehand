import {
  traitLabel,
  type ClassRecord,
  type FeatureRow,
  type Ruleset,
  type SpeciesRecord,
  type SubclassRecord,
} from '@stagehand/shared';

import { Facts, GearCard } from './GearViews';
import { domainsLabel, hopeFeatureLabel, suggestedTraitsLabel } from './labels';

/**
 * Classes and subclasses (F4.5) and species (F4.6) drawn as cards: what players read on the
 * gameplay pages, and what F4.7 lays beside the sheet page. Feature text is read by the table,
 * never run (§8).
 */

/** A list of features under a heading; "None yet." when empty. */
export function FeatureList({ title, features }: { title: string; features: FeatureRow[] }) {
  return (
    <section aria-label={title} className="space-y-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      {features.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="space-y-1">
          {features.map((feature, index) => (
            <li key={index} className="text-sm whitespace-pre-line">
              <strong>{feature.name}</strong>
              {feature.text !== '' && `: ${feature.text}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ClassView({ cls, ruleset }: { cls: ClassRecord; ruleset: Ruleset }) {
  const hope = cls.hopeFeature;
  const gear = [cls.suggestedPrimaryWeapon, cls.suggestedSecondaryWeapon, cls.suggestedArmor]
    .filter((ref) => ref !== null)
    .map((ref) => ref.name);
  const traits = suggestedTraitsLabel(cls.suggestedTraits, ruleset);
  return (
    <GearCard label={`${cls.name}, a class`} corner="Class" name={cls.name}>
      {cls.description !== '' && (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{cls.description}</p>
      )}
      <Facts
        facts={[
          ['Domains', domainsLabel(cls.domains)],
          ['Starting evasion', String(cls.startingEvasion)],
          ['Starting HP', String(cls.startingHp)],
        ]}
      />
      <section aria-label="Hope feature" className="space-y-1">
        <h2 className="text-sm font-semibold">Hope feature</h2>
        {hope.name === '' && hope.text === '' ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <p className="text-sm whitespace-pre-line">
            <strong>{hopeFeatureLabel(hope)}</strong>
            {hope.text !== '' && `: ${hope.text}`}
          </p>
        )}
      </section>
      <FeatureList title="Class features" features={cls.classFeatures} />
      {(traits !== '' || gear.length > 0) && (
        <section aria-label="Suggested to start" className="space-y-1">
          <h2 className="text-sm font-semibold">Suggested to start</h2>
          {traits !== '' && <p className="text-sm">{traits}</p>}
          {gear.length > 0 && <p className="text-sm">{gear.join(', ')}</p>}
        </section>
      )}
    </GearCard>
  );
}

export function SubclassView({
  subclass,
  ruleset,
}: {
  subclass: SubclassRecord;
  ruleset: Ruleset;
}) {
  return (
    <GearCard
      label={`${subclass.name}, a ${subclass.className} subclass`}
      corner={`${subclass.className} subclass`}
      name={subclass.name}
    >
      {subclass.description !== '' && (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{subclass.description}</p>
      )}
      <Facts
        facts={[
          [
            'Spellcast trait',
            subclass.spellcastTrait === null
              ? 'None'
              : traitLabel(ruleset, subclass.spellcastTrait),
          ],
        ]}
      />
      <FeatureList title="Foundation" features={subclass.foundation} />
      <FeatureList title="Specialization" features={subclass.specialization} />
      <FeatureList title="Mastery" features={subclass.mastery} />
    </GearCard>
  );
}

export function SpeciesView({ species }: { species: SpeciesRecord }) {
  return (
    <GearCard label={`${species.name}, a species`} corner="Species" name={species.name}>
      {species.description !== '' && (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{species.description}</p>
      )}
      <FeatureList title="Features" features={species.features} />
    </GearCard>
  );
}
