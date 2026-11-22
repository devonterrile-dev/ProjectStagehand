import {
  POTION_ITEMS,
  POTIONS,
  type ArmorRecord,
  type ClassRecord,
  type ClassSummary,
  type DomainCardSummary,
  type Ruleset,
  type FeatureRow,
  type SpeciesSummary,
  type StartingGear,
  type WeaponRecord,
} from '@stagehand/shared';
import type { ReactNode } from 'react';

import { ClassView, FeatureList, SubclassView } from '@/components/gameplay/ClassViews';
import { DomainCardView } from '@/components/gameplay/DomainCardView';
import { ArmorView, WeaponView } from '@/components/gameplay/GearViews';
import { RichTextEditor } from '@/components/records/RichTextEditor';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useDomainCard, useSubclass } from '@/lib/queries';
import { defaultItemsLabel, goldLabel } from '@/lib/starting-gear';

import type { GuideDraft } from './draft';

/**
 * The creation guide's steps (F4.8, governance §9 "Character creation"). Each shows what the
 * player picks from, drawn with the Gameplay section's own views, and changes the draft.
 */

type Change = (patch: Partial<GuideDraft>) => void;

const ASK_GM = 'Ask your GM to add some first.';

function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm ${checked ? 'border-primary bg-muted' : ''}`}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/** Step 1: a class, then one of its subclasses. */
export function ClassStep({
  campaignId,
  draft,
  change,
  classes,
  cls,
  ruleset,
}: {
  campaignId: string;
  draft: GuideDraft;
  change: Change;
  classes: ClassSummary[] | undefined;
  cls: ClassRecord | null | undefined;
  ruleset: Ruleset;
}) {
  if (classes === undefined) return <p className="text-muted-foreground">Loading classes…</p>;
  if (classes.length === 0) {
    return <p className="text-muted-foreground">This campaign has no classes yet. {ASK_GM}</p>;
  }
  return (
    <div className="space-y-4">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Class</legend>
        {classes.map((one) => (
          <Choice
            key={one.id}
            name="guide-class"
            value={one.id}
            checked={draft.classId === one.id}
            onChange={() => {
              // A new class clears what depends on it; its suggestions are filled in again.
              change({
                classId: one.id,
                subclassId: null,
                prefilledFor: null,
                cardIds: [],
              });
            }}
          >
            <span className="font-medium">{one.name}</span>
            <span className="block text-muted-foreground">
              {one.domains
                .filter((domain) => domain !== null)
                .map((domain) => domain.name)
                .join(' and ')}
              {` · Evasion ${String(one.startingEvasion)} · HP ${String(one.startingHp)}`}
            </span>
          </Choice>
        ))}
      </fieldset>

      {cls != null && (
        <>
          <ClassView cls={cls} ruleset={ruleset} />
          {cls.subclasses.length === 0 ? (
            <p className="text-muted-foreground">
              {cls.name} has no subclasses yet. {ASK_GM}
            </p>
          ) : (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-2 font-medium">Subclass</legend>
              {cls.subclasses.map((sub) => (
                <Choice
                  key={sub.id}
                  name="guide-subclass"
                  value={sub.id}
                  checked={draft.subclassId === sub.id}
                  onChange={() => {
                    change({ subclassId: sub.id });
                  }}
                >
                  <span className="font-medium">{sub.name}</span>
                </Choice>
              ))}
            </fieldset>
          )}
          {draft.subclassId !== null && (
            <SubclassPreview
              campaignId={campaignId}
              subclassId={draft.subclassId}
              ruleset={ruleset}
            />
          )}
        </>
      )}
    </div>
  );
}

function SubclassPreview({
  campaignId,
  subclassId,
  ruleset,
}: {
  campaignId: string;
  subclassId: string;
  ruleset: Ruleset;
}) {
  const sub = useSubclass(campaignId, subclassId).data;
  if (sub == null) return null;
  return <SubclassView subclass={sub} ruleset={ruleset} />;
}

/** Step 2: a species, or a mixed ancestry of two. */
export function SpeciesStep({
  draft,
  change,
  species,
  features,
}: {
  draft: GuideDraft;
  change: Change;
  species: SpeciesSummary[] | undefined;
  /** The features the picks give (`ancestryFeatures`). */
  features: FeatureRow[];
}) {
  if (species === undefined) return <p className="text-muted-foreground">Loading species…</p>;
  if (species.length === 0) {
    return <p className="text-muted-foreground">This campaign has no species yet. {ASK_GM}</p>;
  }
  const [first, second] = draft.speciesIds;
  return (
    <div className="space-y-4">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Species</legend>
        {species.map((one) => (
          <Choice
            key={one.id}
            name="guide-species"
            value={one.id}
            checked={first === one.id}
            onChange={() => {
              change({ speciesIds: [one.id, second === one.id ? null : second] });
            }}
          >
            <span className="font-medium">{one.name}</span>
            {one.description !== '' && (
              <span className="block text-muted-foreground">{one.description}</span>
            )}
          </Choice>
        ))}
      </fieldset>

      {species.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.mixed}
            onChange={(event) => {
              change({
                mixed: event.target.checked,
                speciesIds: [first, event.target.checked ? second : null],
              });
            }}
          />
          Mixed ancestry: the first feature of this species and the second of another
        </label>
      )}
      {draft.mixed && (
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="guide-species-2">Second species</Label>
          <NativeSelect
            id="guide-species-2"
            value={second ?? ''}
            onChange={(event) => {
              change({
                speciesIds: [first, event.target.value === '' ? null : event.target.value],
              });
            }}
          >
            <option value="">Pick one</option>
            {species
              .filter((one) => one.id !== first)
              .map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
          </NativeSelect>
        </div>
      )}
      {first !== null && (
        <section aria-label="Your ancestry's features" className="rounded-md border px-4 py-3">
          <FeatureList title="Your features" features={features} />
        </section>
      )}
    </div>
  );
}

/** Step 3: the creation spread, one value to each trait. */
export function TraitsStep({
  draft,
  change,
  ruleset,
}: {
  draft: GuideDraft;
  change: Change;
  ruleset: Ruleset;
}) {
  const spread = [...(ruleset.creationTraitSpread ?? [])].sort((a, b) => b - a);
  const values = [...new Set(spread)];
  // What is left to place: the spread with each placed value taken out once.
  const left = [...spread];
  for (const trait of ruleset.traits) {
    const value = draft.traits[trait.id];
    const at = value == null ? -1 : left.indexOf(value);
    if (at >= 0) left.splice(at, 1);
  }
  const words = (list: number[]) =>
    list.map((value) => (value > 0 ? `+${String(value)}` : value < 0 ? `−${String(-value)}` : '0'));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Give your traits {words(spread).join(', ')}: one value to each.{' '}
        {left.length === 0 ? 'All placed.' : `Still to place: ${words(left).join(', ')}.`}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {ruleset.traits.map((trait) => (
          <div key={trait.id} className="space-y-1.5">
            <Label htmlFor={`guide-trait-${trait.id}`}>{trait.label}</Label>
            <NativeSelect
              id={`guide-trait-${trait.id}`}
              value={draft.traits[trait.id] == null ? '' : String(draft.traits[trait.id])}
              onChange={(event) => {
                const raw = event.target.value;
                change({
                  traits: { ...draft.traits, [trait.id]: raw === '' ? null : Number(raw) },
                });
              }}
            >
              <option value="">Pick</option>
              {values.map((value) => (
                <option key={value} value={value}>
                  {words([value])[0]}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 4: the starting gear, as the campaign's mode says. */
export function EquipmentStep({
  draft,
  change,
  gear,
  weapons,
  armor,
  ruleset,
}: {
  draft: GuideDraft;
  change: Change;
  gear: StartingGear | undefined;
  weapons: WeaponRecord[] | undefined;
  armor: ArmorRecord[] | undefined;
  ruleset: Ruleset;
}) {
  if (gear === undefined || weapons === undefined || armor === undefined) {
    return <p className="text-muted-foreground">Loading gear…</p>;
  }
  if (gear.mode === 'none') {
    return <p>Your GM hands out gear in play, so there is nothing to pick here.</p>;
  }
  if (gear.mode === 'set') {
    const { kit } = gear;
    const names = [
      weapons.find((one) => one.id === kit.primaryWeaponId)?.name,
      weapons.find((one) => one.id === kit.secondaryWeaponId)?.name,
      armor.find((one) => one.id === kit.armorId)?.name,
      ...kit.items.map((item) => item.name),
      goldLabel(kit.gold),
    ].filter((name) => name !== undefined && name !== '');
    return (
      <div className="space-y-2">
        <p>Your GM has set the starting gear. You start with:</p>
        <ul aria-label="Starting gear" className="list-disc pl-6">
          {names.map((name, index) => (
            <li key={index}>{name}</li>
          ))}
        </ul>
      </div>
    );
  }

  const primaries = weapons.filter((one) => one.slot === 'primary' && one.tier === 1);
  const secondaries = weapons.filter((one) => one.slot === 'secondary' && one.tier === 1);
  const tier1Armor = armor.filter((one) => one.tier === 1);
  const primary = weapons.find((one) => one.id === draft.primaryWeaponId) ?? null;
  const secondary = weapons.find((one) => one.id === draft.secondaryWeaponId) ?? null;
  const picked = armor.find((one) => one.id === draft.armorId) ?? null;
  const twoHanded = primary?.burden === 'two_handed';
  const select = (
    id: string,
    label: string,
    value: string | null,
    options: { id: string; name: string }[],
    onChange: (next: string | null) => void,
    disabled = false,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value === '' ? null : event.target.value);
        }}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick a tier 1 primary weapon, and a secondary weapon if your primary is one-handed; tier 1
        armor; and a potion. You also get: {defaultItemsLabel()}.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {select('guide-primary', 'Primary weapon', draft.primaryWeaponId, primaries, (next) => {
          const two = weapons.find((one) => one.id === next)?.burden === 'two_handed';
          change({ primaryWeaponId: next, ...(two ? { secondaryWeaponId: null } : {}) });
        })}
        {select(
          'guide-secondary',
          'Secondary weapon (optional)',
          draft.secondaryWeaponId,
          secondaries,
          (next) => {
            change({ secondaryWeaponId: next });
          },
          twoHanded,
        )}
        {select('guide-armor', 'Armor', draft.armorId, tier1Armor, (next) => {
          change({ armorId: next });
        })}
      </div>
      {twoHanded && (
        <p className="text-sm text-muted-foreground">
          {primary.name} is two-handed, so there is no hand for a secondary weapon.
        </p>
      )}
      {(primaries.length === 0 || tier1Armor.length === 0) && (
        <p className="text-sm text-muted-foreground">
          This campaign is missing tier 1 {primaries.length === 0 ? 'primary weapons' : 'armor'}.{' '}
          {ASK_GM}
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="font-medium">Potion</legend>
        {POTIONS.map((potion) => (
          <label key={potion} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="guide-potion"
              value={potion}
              checked={draft.potion === potion}
              onChange={() => {
                change({ potion });
              }}
            />
            {POTION_ITEMS[potion].name}
            <span className="text-muted-foreground">({POTION_ITEMS[potion].detail})</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 md:grid-cols-3">
        {primary !== null && <WeaponView weapon={primary} ruleset={ruleset} />}
        {secondary !== null && <WeaponView weapon={secondary} ruleset={ruleset} />}
        {picked !== null && <ArmorView armor={picked} ruleset={ruleset} />}
      </div>
    </div>
  );
}

/** Step 5: two level-1 cards from the class's domains. */
export function CardsStep({
  campaignId,
  draft,
  change,
  candidates,
  count,
}: {
  campaignId: string;
  draft: GuideDraft;
  change: Change;
  /** The level-1 cards of the class's domains; undefined while they load. */
  candidates: DomainCardSummary[] | undefined;
  count: number;
}) {
  if (draft.classId === null) return <p>Pick a class first: its domains give the cards.</p>;
  if (candidates === undefined) return <p className="text-muted-foreground">Loading cards…</p>;
  if (candidates.length < count) {
    return (
      <p className="text-muted-foreground">
        Your class&apos;s domains don&apos;t have {count} level 1 cards yet. {ASK_GM}
      </p>
    );
  }
  const full = draft.cardIds.length >= count;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick {count} level 1 cards from your class&apos;s domains. Both go in your loadout.{' '}
        {draft.cardIds.length} of {count} picked.
      </p>
      <ul className="grid gap-4 md:grid-cols-2">
        {candidates.map((card) => {
          const checked = draft.cardIds.includes(card.id);
          return (
            <li key={card.id} className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => {
                    change({
                      cardIds: checked
                        ? draft.cardIds.filter((cardId) => cardId !== card.id)
                        : [...draft.cardIds, card.id],
                    });
                  }}
                />
                Take {card.name}
              </label>
              <CardPreview campaignId={campaignId} card={card} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CardPreview({ campaignId, card }: { campaignId: string; card: DomainCardSummary }) {
  const full = useDomainCard(campaignId, card.id).data;
  if (full == null) {
    return (
      <p className="text-sm text-muted-foreground">
        {card.domainName} · level {card.level}
      </p>
    );
  }
  return <DomainCardView card={full} />;
}

/** Step 6: the name, and how they look and who they are. */
export function NameStep({ draft, change }: { draft: GuideDraft; change: Change }) {
  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="guide-name">Name</Label>
        <Input
          id="guide-name"
          value={draft.name}
          maxLength={80}
          onChange={(event) => {
            change({ name: event.target.value });
          }}
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Description</p>
        <p className="text-sm text-muted-foreground">
          How they look and who they are. Your GM&apos;s picture of them is drawn from this.
        </p>
        <RichTextEditor
          id="guide-description"
          label="Description"
          value={draft.description}
          editable
          onChange={(description) => {
            change({ description });
          }}
        />
      </div>
    </div>
  );
}
