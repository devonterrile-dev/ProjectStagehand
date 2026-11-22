import {
  buildSheet,
  creationCardProblem,
  defaultGearProblem,
  followsCreationSpread,
  isEmptyRichText,
  rulesetFor,
  startingItems,
  traitLabel,
  traitsProblem,
  type BuildCharacterRequest,
  type Campaign,
  type ClassRecord,
  type PlayerCharacterSheet,
  type Ruleset,
  type SheetRecords,
  type StartingGear,
  type WeaponRecord,
  type ArmorRecord,
} from '@stagehand/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { FieldError } from '@/components/FieldError';
import { Button } from '@/components/ui/button';
import {
  useArmorList,
  useBuildCharacter,
  useClass,
  useClasses,
  useDomainCards,
  useSpecies,
  useSpeciesList,
  useStartingGear,
  useWeapons,
} from '@/lib/queries';
import { characterPath } from '@/lib/records';
import { goldLabel } from '@/lib/starting-gear';

import {
  ancestryFeatures,
  clearDraft,
  loadDraft,
  newDraft,
  saveDraft,
  type GuideDraft,
} from './draft';
import {
  CardsStep,
  ClassStep,
  EquipmentStep,
  NameStep,
  SpeciesStep,
  TraitsStep,
} from './GuideSteps';

/** An id no query asks for: what `useClass` and `useSpecies` get before a pick. */
const NO_CLASS = '00000000-0000-4000-8000-000000000000';

const STEPS = [
  'Class',
  'Species',
  'Traits',
  'Equipment',
  'Domain cards',
  'Name',
  'Review',
] as const;

/** The suggestions of a class that fit the guide: tier 1 gear in the right slots (§9). */
function suggestedGear(cls: ClassRecord, weapons: WeaponRecord[], armor: ArmorRecord[]) {
  const primary = weapons.find(
    (one) => one.id === cls.suggestedPrimaryWeapon?.id && one.slot === 'primary' && one.tier === 1,
  );
  const secondary = weapons.find(
    (one) =>
      one.id === cls.suggestedSecondaryWeapon?.id && one.slot === 'secondary' && one.tier === 1,
  );
  const piece = armor.find((one) => one.id === cls.suggestedArmor?.id && one.tier === 1);
  return {
    primaryWeaponId: primary?.id ?? null,
    secondaryWeaponId: primary?.burden === 'two_handed' ? null : (secondary?.id ?? null),
    armorId: piece?.id ?? null,
  };
}

/**
 * The character creation guide (F4.8, governance §9 "Character creation", D-66): the steps in
 * order with Back and Next, Next held until a step is complete, and Finish on the review. The
 * picks are kept in this browser until Finish sends them, once.
 */
export function CreationGuide({
  campaign,
  sheet,
}: {
  campaign: Campaign;
  sheet: Pick<PlayerCharacterSheet, 'id' | 'name' | 'publicDescription'>;
}) {
  const ruleset = rulesetFor(campaign.rulesetVersion);
  const view = campaign.role === 'gm' ? 'gm' : 'player';
  const navigate = useNavigate();
  const [draft, setDraft] = useState<GuideDraft>(() => loadDraft(sheet.id) ?? newDraft(sheet));
  const change = (patch: Partial<GuideDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  useEffect(() => {
    saveDraft(sheet.id, draft);
  }, [sheet.id, draft]);

  const classes = useClasses(campaign.id).data;
  const cls = useClass(campaign.id, draft.classId ?? NO_CLASS).data;
  const chosen = cls?.id === draft.classId ? cls : null;
  const species = useSpeciesList(campaign.id).data;
  const firstSpecies = useSpecies(campaign.id, draft.speciesIds[0] ?? NO_CLASS).data;
  const secondSpecies = useSpecies(campaign.id, draft.speciesIds[1] ?? NO_CLASS).data;
  const features = ancestryFeatures(
    firstSpecies?.id === draft.speciesIds[0] ? firstSpecies : null,
    draft.mixed && secondSpecies?.id === draft.speciesIds[1] ? secondSpecies : null,
  );
  const weapons = useWeapons(campaign.id).data;
  const armor = useArmorList(campaign.id).data;
  const gear = useStartingGear(campaign.id).data;
  const allCards = useDomainCards(campaign.id).data;
  const build = useBuildCharacter(campaign.id, sheet.id, view);

  // A newly picked class fills in its suggested traits and gear once, worked out while
  // rendering (the documented way to follow what a query answers).
  if (
    chosen !== null &&
    draft.prefilledFor !== chosen.id &&
    weapons !== undefined &&
    armor !== undefined
  ) {
    setDraft({
      ...draft,
      prefilledFor: chosen.id,
      ...(followsCreationSpread(chosen.suggestedTraits, ruleset)
        ? { traits: { ...chosen.suggestedTraits } }
        : {}),
      ...suggestedGear(chosen, weapons, armor),
    });
  }

  const domainIds = chosen?.domains.map((domain) => domain?.id ?? null) ?? [];
  const candidates = allCards
    ?.filter((card) => card.level === 1 && domainIds.includes(card.domainId))
    .sort((a, b) => a.domainName.localeCompare(b.domainName) || a.name.localeCompare(b.name));
  const pickedCards = draft.cardIds.flatMap((cardId) => {
    const card = allCards?.find((one) => one.id === cardId);
    return card === undefined ? [] : [card];
  });
  const traits = Object.fromEntries(
    ruleset.traits.map((trait) => [trait.id, draft.traits[trait.id] ?? Number.NaN]),
  );
  const weapon = (weaponId: string | null) => weapons?.find((one) => one.id === weaponId) ?? null;
  const pickedArmor = armor?.find((one) => one.id === draft.armorId) ?? null;
  const count = ruleset.domainCards?.atCreation ?? 2;

  const gearProblem = (): string | null => {
    if (gear === undefined) return 'Loading the starting gear…';
    if (gear.mode !== 'default') return null;
    return (
      defaultGearProblem({
        primary: weapon(draft.primaryWeaponId),
        secondary: weapon(draft.secondaryWeaponId),
        armor: pickedArmor,
      }) ?? (draft.potion === null ? 'Pick a potion' : null)
    );
  };
  const problems: (string | null)[] = [
    draft.classId === null ? 'Pick a class' : draft.subclassId === null ? 'Pick a subclass' : null,
    draft.speciesIds[0] === null
      ? 'Pick a species'
      : draft.mixed && draft.speciesIds[1] === null
        ? 'Pick the second species, or turn off mixed ancestry'
        : null,
    traitsProblem(traits, ruleset),
    gearProblem(),
    creationCardProblem(pickedCards, domainIds, ruleset),
    draft.name.trim() === '' ? 'Name your character' : null,
    null,
  ];
  const step = Math.min(draft.step, STEPS.length - 1);
  const problem = problems[step] ?? null;
  const firstOpen = problems.findIndex((one) => one !== null);

  const request = (): BuildCharacterRequest | null => {
    const [first, second] = draft.speciesIds;
    if (draft.classId === null || draft.subclassId === null || first === null) return null;
    return {
      name: draft.name.trim(),
      publicDescription: draft.description,
      classId: draft.classId,
      subclassId: draft.subclassId,
      speciesIds: [first, draft.mixed ? second : null],
      traits,
      gear:
        gear?.mode === 'default' && draft.potion !== null
          ? {
              primaryWeaponId: draft.primaryWeaponId,
              secondaryWeaponId: draft.secondaryWeaponId,
              armorId: draft.armorId,
              potion: draft.potion,
            }
          : null,
      cardIds: draft.cardIds,
    };
  };

  async function finish() {
    const input = request();
    if (input === null) return;
    try {
      await build.mutateAsync(input);
      clearDraft(sheet.id);
      void navigate(characterPath(campaign.id, sheet.id));
    } catch {
      // The refusal shows below the review.
    }
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((name, index) => {
            const reachable = firstOpen === -1 || index <= firstOpen;
            return (
              <li key={name}>
                <Button
                  size="sm"
                  variant={index === step ? 'default' : 'outline'}
                  aria-current={index === step ? 'step' : undefined}
                  disabled={!reachable}
                  onClick={() => {
                    change({ step: index });
                  }}
                >
                  {index + 1}. {name}
                </Button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="guide-step" className="space-y-4">
        <h2 id="guide-step" className="text-xl font-semibold">
          {STEPS[step]}
        </h2>
        {step === 0 && (
          <ClassStep
            campaignId={campaign.id}
            draft={draft}
            change={change}
            classes={classes}
            cls={chosen}
            ruleset={ruleset}
          />
        )}
        {step === 1 && (
          <SpeciesStep draft={draft} change={change} species={species} features={features} />
        )}
        {step === 2 && <TraitsStep draft={draft} change={change} ruleset={ruleset} />}
        {step === 3 && (
          <EquipmentStep
            draft={draft}
            change={change}
            gear={gear}
            weapons={weapons}
            armor={armor}
            ruleset={ruleset}
          />
        )}
        {step === 4 && (
          <CardsStep
            campaignId={campaign.id}
            draft={draft}
            change={change}
            candidates={chosen === null ? undefined : candidates}
            count={count}
          />
        )}
        {step === 5 && <NameStep draft={draft} change={change} />}
        {step === 6 && (
          <Review
            ruleset={ruleset}
            draft={draft}
            cls={chosen}
            gear={gear}
            records={{
              class:
                chosen === null
                  ? null
                  : {
                      id: chosen.id,
                      name: chosen.name,
                      domainIds,
                      hopeFeature: chosen.hopeFeature,
                      classFeatures: chosen.classFeatures,
                    },
              subclass: null,
              species: [null, null],
              primary:
                gear?.mode === 'set'
                  ? weapon(gear.kit.primaryWeaponId)
                  : weapon(draft.primaryWeaponId),
              secondary:
                gear?.mode === 'set'
                  ? weapon(gear.kit.secondaryWeaponId)
                  : weapon(draft.secondaryWeaponId),
              armor:
                gear?.mode === 'set'
                  ? (armor?.find((one) => one.id === gear.kit.armorId) ?? null)
                  : gear?.mode === 'none'
                    ? null
                    : pickedArmor,
              spares: [],
              cards: [],
            }}
            names={{
              subclass: chosen?.subclasses.find((sub) => sub.id === draft.subclassId)?.name ?? '',
              species: [draft.speciesIds[0], draft.mixed ? draft.speciesIds[1] : null]
                .map((id) => species?.find((one) => one.id === id)?.name)
                .filter((name) => name !== undefined)
                .join(' and '),
              features: features.map((feature) => feature.name),
              cards: pickedCards.map((card) => card.name),
            }}
          />
        )}
      </section>

      {problem !== null && <p className="text-sm text-muted-foreground">{problem}</p>}
      {step === STEPS.length - 1 && firstOpen !== -1 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {STEPS[firstOpen]} isn&apos;t finished: {problems[firstOpen]}.
        </p>
      )}
      <FieldError message={build.error?.message ?? null} />

      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={step === 0}
          onClick={() => {
            change({ step: step - 1 });
          }}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            disabled={problem !== null}
            onClick={() => {
              change({ step: step + 1 });
            }}
          >
            Next
          </Button>
        ) : (
          <Button disabled={firstOpen !== -1 || build.isPending} onClick={() => void finish()}>
            {build.isPending ? 'Finishing…' : 'Finish'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Step 7: every pick, and the numbers the sheet will show, worked out as the server will. */
function Review({
  draft,
  cls,
  gear,
  records,
  names,
  ruleset,
}: {
  draft: GuideDraft;
  cls: ClassRecord | null;
  gear: StartingGear | undefined;
  records: SheetRecords;
  names: { subclass: string; species: string; features: string[]; cards: string[] };
  ruleset: Ruleset;
}) {
  if (cls === null || gear === undefined) return <p className="text-muted-foreground">Loading…</p>;
  const traits = Object.fromEntries(
    ruleset.traits.map((trait) => [trait.id, draft.traits[trait.id] ?? 0]),
  );
  const { built } = buildSheet(
    {
      name: draft.name,
      level: 1,
      className: '',
      traits,
      evasion: cls.startingEvasion,
      armorScore: 0,
      armorSlotsMax: 0,
      minorThreshold: 0,
      majorThreshold: 0,
      severeThreshold: 0,
      proficiency: ruleset.proficiency?.start ?? 1,
      weapons: { primary: null, secondary: null, inventory: [] },
      armor: null,
      builtAt: 'now',
    },
    { subclassCards: 1 },
    records,
    ruleset,
  );
  const { items, gold } = startingItems(gear.mode, gear.kit, draft.potion);
  const weapons = [built.weapons.primary, built.weapons.secondary].filter((one) => one !== null);
  const rows: [string, string][] = [
    ['Name', draft.name.trim()],
    ['Class', `${cls.name}, ${names.subclass}`],
    ['Ancestry', names.species],
    ['Ancestry features', names.features.join(', ')],
    [
      'Traits',
      ruleset.traits
        .map((trait) => {
          const value = built.traits[trait.id] ?? 0;
          return `${traitLabel(ruleset, trait.id)} ${value > 0 ? '+' : value < 0 ? '−' : ''}${String(Math.abs(value))}`;
        })
        .join(', '),
    ],
    ['Evasion', String(built.evasion)],
    ['HP', String(cls.startingHp)],
    ['Stress', String(ruleset.start?.stressSlots ?? 6)],
    ['Armor', built.armorName ?? 'None'],
    ['Armor score', String(built.armorScore)],
    [
      'Thresholds (major / severe)',
      `${String(built.thresholds.major)} / ${String(built.thresholds.severe)}`,
    ],
    [
      'Weapons',
      weapons.length === 0
        ? 'None'
        : weapons.map((one) => `${one.name} (${one.damage} ${one.damageType})`).join(', '),
    ],
    [
      'Items',
      [...items.map((item) => item.name), goldLabel(gold)].filter((one) => one !== '').join(', ') ||
        'None',
    ],
    ['Domain cards', names.cards.join(', ')],
    ['Description', isEmptyRichText(draft.description) ? 'None yet' : 'Written'],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
