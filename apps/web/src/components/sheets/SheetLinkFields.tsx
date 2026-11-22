import {
  SUBCLASS_CARDS_MAX,
  type Campaign,
  type CharacterSheet,
  type SheetLinks,
} from '@stagehand/shared';
import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useArmorList, useClass, useClasses, useSpeciesList, useWeapons } from '@/lib/queries';

/**
 * The GM's pickers for a sheet's links to gameplay records (F4.7, D-65). Each link replaces the
 * typed part it stands for; "Typed" (or "None") unlinks it and the typed part shows again.
 */

type OnLink = (patch: Partial<SheetLinks>) => void;

const SUBCLASS_CARD_LABELS = ['None', 'Foundation', '+ Specialization', '+ Mastery'];

/** Class, subclass (with the cards held) and species, one or two for a mixed ancestry. */
export function ClassLinkFields({
  campaign,
  sheet,
  readOnly,
  onLink,
}: {
  campaign: Campaign;
  sheet: CharacterSheet;
  readOnly: boolean;
  onLink: OnLink;
}) {
  const classes = useClasses(campaign.id).data ?? [];
  const species = useSpeciesList(campaign.id).data ?? [];
  const [classId, setClassId] = useState(sheet.links.classId);
  const [subclassId, setSubclassId] = useState(sheet.links.subclassId);
  const [cardsHeld, setCardsHeld] = useState(sheet.links.subclassCards);
  const [speciesIds, setSpeciesIds] = useState(sheet.links.speciesIds);
  const [multi, setMulti] = useState({
    classId: sheet.links.multiclassClassId,
    domainId: sheet.links.multiclassDomainId,
    subclassId: sheet.links.multiclassSubclassId,
    cards: sheet.links.multiclassSubclassCards,
  });
  const firstDomains =
    classes.find((cls) => cls.id === classId)?.domains.map((domain) => domain?.id ?? null) ?? [];

  const value = (id: string | null) => id ?? '';
  const idOf = (raw: string) => (raw === '' ? null : raw);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="link-class">Class</Label>
          <NativeSelect
            id="link-class"
            value={value(classId)}
            disabled={readOnly}
            onChange={(event) => {
              const next = idOf(event.target.value);
              setClassId(next);
              // The server drops a subclass of another class; so does the picker.
              setSubclassId(null);
              onLink({ classId: next });
            }}
          >
            <option value="">Typed (below)</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {classId !== null && (
          <SubclassSelect
            campaignId={campaign.id}
            classId={classId}
            value={subclassId}
            disabled={readOnly}
            onChange={(next) => {
              setSubclassId(next);
              onLink({ subclassId: next });
            }}
          />
        )}
        {subclassId !== null && (
          <div className="space-y-1.5">
            <Label htmlFor="link-subclass-cards">Subclass cards held</Label>
            <NativeSelect
              id="link-subclass-cards"
              value={String(cardsHeld)}
              disabled={readOnly}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCardsHeld(next);
                onLink({ subclassCards: next });
              }}
            >
              {SUBCLASS_CARD_LABELS.slice(0, SUBCLASS_CARDS_MAX + 1).map((label, n) => (
                <option key={label} value={n}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>
      {classId !== null && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="link-multiclass">Multiclass</Label>
            <NativeSelect
              id="link-multiclass"
              value={value(multi.classId)}
              disabled={readOnly}
              onChange={(event) => {
                const next = idOf(event.target.value);
                setMulti({ classId: next, domainId: null, subclassId: null, cards: 1 });
                onLink({ multiclassClassId: next });
              }}
            >
              <option value="">None</option>
              {classes
                .filter((cls) => cls.id !== classId)
                .map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          {multi.classId !== null && (
            <MulticlassParts
              campaignId={campaign.id}
              classId={multi.classId}
              domainId={multi.domainId}
              subclassId={multi.subclassId}
              cards={multi.cards}
              firstDomains={firstDomains}
              disabled={readOnly}
              onChange={(patch) => {
                setMulti((current) => ({
                  ...current,
                  ...(patch.multiclassDomainId === undefined
                    ? {}
                    : { domainId: patch.multiclassDomainId }),
                  ...(patch.multiclassSubclassId === undefined
                    ? {}
                    : { subclassId: patch.multiclassSubclassId }),
                  ...(patch.multiclassSubclassCards === undefined
                    ? {}
                    : { cards: patch.multiclassSubclassCards }),
                }));
                onLink(patch);
              }}
            />
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {([0, 1] as const).map((index) => (
          <div key={index} className="space-y-1.5">
            <Label htmlFor={`link-species-${String(index + 1)}`}>
              {index === 0 ? 'Species' : 'Mixed ancestry (optional)'}
            </Label>
            <NativeSelect
              id={`link-species-${String(index + 1)}`}
              value={value(speciesIds[index])}
              disabled={readOnly || (index === 1 && speciesIds[0] === null)}
              onChange={(event) => {
                const next: SheetLinks['speciesIds'] =
                  index === 0
                    ? [
                        idOf(event.target.value),
                        idOf(event.target.value) === null ? null : speciesIds[1],
                      ]
                    : [speciesIds[0], idOf(event.target.value)];
                if (next[0] !== null && next[0] === next[1]) next[1] = null;
                setSpeciesIds(next);
                onLink({ speciesIds: next });
              }}
            >
              <option value="">None</option>
              {species
                .filter((one) => index === 0 || one.id !== speciesIds[0])
                .map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
            </NativeSelect>
            {index === 1 && (
              <p className="text-xs text-muted-foreground">
                The first feature of the first species and the second of this one.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The second class's domain (one the first hasn't), its subclass and the cards held (F4.10). */
function MulticlassParts({
  campaignId,
  classId,
  domainId,
  subclassId,
  cards,
  firstDomains,
  disabled,
  onChange,
}: {
  campaignId: string;
  classId: string;
  domainId: string | null;
  subclassId: string | null;
  cards: number;
  firstDomains: (string | null)[];
  disabled: boolean;
  onChange: OnLink;
}) {
  const second = useClass(campaignId, classId).data;
  const domains = (second?.domains ?? []).filter(
    (domain) => domain !== null && !firstDomains.includes(domain.id),
  );
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="link-multiclass-domain">Multiclass domain</Label>
        <NativeSelect
          id="link-multiclass-domain"
          value={domainId ?? ''}
          disabled={disabled}
          onChange={(event) => {
            onChange({ multiclassDomainId: event.target.value === '' ? null : event.target.value });
          }}
        >
          <option value="">None</option>
          {domains.map((domain) =>
            domain === null ? null : (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ),
          )}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="link-multiclass-subclass">Multiclass subclass</Label>
        <NativeSelect
          id="link-multiclass-subclass"
          value={subclassId ?? ''}
          disabled={disabled}
          onChange={(event) => {
            onChange({
              multiclassSubclassId: event.target.value === '' ? null : event.target.value,
            });
          }}
        >
          <option value="">None</option>
          {(second?.subclasses ?? []).map((sub) => (
            <option key={sub.id} value={sub.id}>
              {sub.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {subclassId !== null && (
        <div className="space-y-1.5">
          <Label htmlFor="link-multiclass-cards">Multiclass subclass cards</Label>
          <NativeSelect
            id="link-multiclass-cards"
            value={String(cards)}
            disabled={disabled}
            onChange={(event) => {
              onChange({ multiclassSubclassCards: Number(event.target.value) });
            }}
          >
            {SUBCLASS_CARD_LABELS.slice(0, SUBCLASS_CARDS_MAX + 1).map((label, n) => (
              <option key={label} value={n}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </>
  );
}

function SubclassSelect({
  campaignId,
  classId,
  value,
  disabled,
  onChange,
}: {
  campaignId: string;
  classId: string;
  value: string | null;
  disabled: boolean;
  onChange: (next: string | null) => void;
}) {
  const subclasses = useClass(campaignId, classId).data?.subclasses ?? [];
  return (
    <div className="space-y-1.5">
      <Label htmlFor="link-subclass">Subclass</Label>
      <NativeSelect
        id="link-subclass"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value === '' ? null : event.target.value);
        }}
      >
        <option value="">None</option>
        {subclasses.map((sub) => (
          <option key={sub.id} value={sub.id}>
            {sub.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** "Typed (below)" or one of the campaign's weapons or armor for an equipped slot. */
export function GearLinkSelect({
  campaignId,
  slot,
  value,
  disabled,
  onChange,
}: {
  campaignId: string;
  slot: 'primary' | 'secondary' | 'armor';
  value: string | null;
  disabled: boolean;
  onChange: (next: string | null) => void;
}) {
  const weapons = useWeapons(campaignId).data ?? [];
  const armor = useArmorList(campaignId).data ?? [];
  const [current, setCurrent] = useState(value);
  const options =
    slot === 'armor'
      ? armor.map((piece) => ({
          id: piece.id,
          label: `${piece.name} (tier ${String(piece.tier)})`,
        }))
      : weapons
          .filter((weapon) => weapon.slot === slot)
          .map((weapon) => ({
            id: weapon.id,
            label: `${weapon.name} (tier ${String(weapon.tier)})`,
          }));
  const label =
    slot === 'armor'
      ? 'Armor from the records'
      : `${slot === 'primary' ? 'Primary' : 'Secondary'} weapon from the records`;
  return (
    <div className="max-w-sm space-y-1.5">
      <Label htmlFor={`link-${slot}`}>{label}</Label>
      <NativeSelect
        id={`link-${slot}`}
        value={current ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value === '' ? null : event.target.value;
          setCurrent(next);
          onChange(next);
        }}
      >
        <option value="">Typed (below)</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Spare weapons from the records: a list with Remove, and a picker to add one. */
export function SpareWeaponLinks({
  campaignId,
  initial,
  disabled,
  onChange,
}: {
  campaignId: string;
  initial: readonly string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const weapons = useWeapons(campaignId).data ?? [];
  const [ids, setIds] = useState<string[]>([...initial]);
  const [adding, setAdding] = useState('');
  const nameOf = (id: string) => weapons.find((weapon) => weapon.id === id)?.name ?? 'A weapon';
  const update = (next: string[]) => {
    setIds(next);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <ul aria-label="Spare weapons from the records" className="space-y-1">
          {ids.map((id, index) => (
            <li key={`${id}-${String(index)}`} className="flex items-center gap-2 text-sm">
              <span>{nameOf(id)}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove spare ${nameOf(id)}`}
                onClick={() => {
                  update(ids.filter((_, at) => at !== index));
                }}
              >
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="link-spare">Add a spare weapon from the records</Label>
          <NativeSelect
            id="link-spare"
            value={adding}
            disabled={disabled}
            onChange={(event) => {
              setAdding(event.target.value);
            }}
          >
            <option value="">Pick a weapon</option>
            {weapons.map((weapon) => (
              <option key={weapon.id} value={weapon.id}>
                {weapon.name} (tier {weapon.tier})
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || adding === ''}
          onClick={() => {
            update([...ids, adding]);
            setAdding('');
          }}
        >
          <PlusIcon aria-hidden />
          Add spare
        </Button>
      </div>
    </div>
  );
}
