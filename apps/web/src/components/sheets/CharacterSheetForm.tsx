import {
  CHARACTER_NAME_MAX,
  characterSheetPatchSchemaFor,
  emptyRichText,
  isEmptyRichText,
  rulesetFor,
  SHEET_LIST_MAX,
  SHORT_TEXT_MAX,
  type Ability,
  type Armor,
  type Campaign,
  type CharacterSheet,
  type CharacterSheetPatch,
  type ClassFeature,
  type Experience,
  type Gold,
  type InventoryItem,
  type Weapon,
} from '@stagehand/shared';
import { MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FieldError } from '@/components/FieldError';
import { RichTextEditor } from '@/components/records/RichTextEditor';
import { SaveStatus } from '@/components/records/SaveStatus';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useDeleteCharacter, usePatchCharacter, useRecords } from '@/lib/queries';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';

import { formatModifier } from './format';
import { AddButton, Group, SectionBox } from './layout';
import { ListEditor } from './ListEditor';
import { NumberField } from './NumberField';
import {
  AbilityFields,
  ArmorFields,
  ExperienceFields,
  InventoryFields,
  NamedTextFields,
  WeaponFields,
} from './parts';
import { blank, hasName } from './rows';
import { TextField } from './TextField';

type Key = keyof CharacterSheetPatch;
type NumberKey = {
  [K in Key]-?: CharacterSheet[K] extends number ? K : never;
}[Key];

/** Each current value and its max: a valid edit to one may fix the other's error. */
const PARTNERS: Partial<Record<Key, Key>> = {
  hpMax: 'hpCurrent',
  hpCurrent: 'hpMax',
  stressMax: 'stressCurrent',
  stressCurrent: 'stressMax',
  armorSlotsMax: 'armorSlotsMarked',
  armorSlotsMarked: 'armorSlotsMax',
};

interface CharacterSheetFormProps {
  campaign: Campaign;
  /** The sheet as last saved. Render with `key={sheet.id}`. */
  sheet: CharacterSheet;
  /** The display name of the PC's player, if assigned. */
  playerName: string | null;
  onDeleted: () => void;
  /** Shown between Identity and Traits: the PC's Visual card (F2.3). */
  visual?: ReactNode;
}

/**
 * The GM's editor for a PC's sheet, grouped as in governance §8 and autosaving key by key.
 * Each key replaces its whole value (D-23), so lists and sections are sent complete. The
 * inputs keep their own state after the first render.
 */
export function CharacterSheetForm({
  campaign,
  sheet,
  playerName,
  onDeleted,
  visual,
}: CharacterSheetFormProps) {
  const ruleset = rulesetFor(campaign.rulesetVersion);
  const { mutateAsync: sendPatch } = usePatchCharacter(campaign.id, sheet.id);
  const del = useDeleteCharacter(campaign.id);
  const send = useCallback<SendPatch<CharacterSheetPatch>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  // Inventory rows can link an Item record (D-24).
  const { data: items } = useRecords(campaign.id, 'item', true);
  const readOnly = campaign.archivedAt !== null;

  /** The last valid value of every key, saved or queued: what the cross-field rules check. */
  const committed = useRef<CharacterSheet>(sheet);
  /** The last value typed for each key, valid or not, for re-checking a pair. */
  const latest = useRef<Partial<Record<Key, unknown>>>({});
  const [errors, setErrors] = useState<Partial<Record<Key, string | undefined>>>({});
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState(sheet.name);
  const [traits, setTraits] = useState(sheet.traits);
  const [weapons, setWeapons] = useState(sheet.weapons);
  const [armor, setArmor] = useState<Armor | null>(sheet.armor);
  const [classFeature, setClassFeature] = useState<ClassFeature | null>(sheet.classFeature);
  const [gold, setGold] = useState<Gold>(sheet.gold);

  function setError(key: Key, message: string | null) {
    setErrors((current) =>
      (current[key] ?? null) === message ? current : { ...current, [key]: message ?? undefined },
    );
  }

  /** Validates one key's new value and queues it, unless it matches what's already queued. */
  function commit(key: Key, value: unknown, now = false, recheck = true) {
    latest.current[key] = value;
    const parsed = characterSheetPatchSchemaFor(ruleset, committed.current).safeParse({
      [key]: value,
    });
    if (!parsed.success) {
      setError(key, parsed.error.issues[0]?.message ?? 'Invalid value');
      return;
    }
    setError(key, null);

    const next = parsed.data[key];
    const unchanged = JSON.stringify(next) === JSON.stringify(committed.current[key]);
    committed.current = { ...committed.current, [key]: next };
    if (!unchanged) {
      autosave.save(parsed.data);
      if (now) autosave.flush();
    }

    // Lowering a current value can make its max valid again (and the other way round).
    const partner = PARTNERS[key];
    if (recheck && partner !== undefined && errors[partner] !== undefined) {
      const typed = latest.current[partner];
      if (typeof typed === 'number') commit(partner, typed, now, false);
    }
  }

  function commitNumber(key: NumberKey, value: number | null) {
    if (value === null) {
      latest.current[key] = null;
      setError(key, 'Enter a whole number');
      return;
    }
    commit(key, value);
  }

  /** Weapons save together; a weapon in hand without a name waits until it has one. */
  function changeWeapons(next: CharacterSheet['weapons'], now = false) {
    setWeapons(next);
    const waiting = [next.primary, next.secondary].some((w) => w !== null && !hasName(w));
    if (!waiting) commit('weapons', next, now);
  }

  const number = (key: NumberKey, label: string, extra: { suffix?: string; min?: number } = {}) => (
    <NumberField
      id={`sheet-${key}`}
      label={label}
      initial={sheet[key]}
      min={extra.min ?? 0}
      suffix={extra.suffix}
      disabled={readOnly}
      error={errors[key] ?? null}
      onCommit={(value) => {
        commitNumber(key, value);
      }}
      onBlur={autosave.flush}
    />
  );

  const modifiers: number[] = [];
  for (let n = ruleset.traitModifier.min; n <= ruleset.traitModifier.max; n += 1) modifiers.push(n);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-1">
          <Input
            id="sheet-name"
            aria-label="Character name"
            className="text-lg font-semibold md:text-lg"
            value={name}
            maxLength={CHARACTER_NAME_MAX}
            disabled={readOnly}
            aria-invalid={errors.name !== undefined}
            onChange={(event) => {
              setName(event.target.value);
              commit('name', event.target.value);
            }}
            onBlur={autosave.flush}
          />
          <FieldError message={errors.name ?? null} />
          <p className="text-sm text-muted-foreground">
            {playerName === null ? 'Not assigned to a player' : `Played by ${playerName}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SaveStatus status={autosave.status} error={autosave.error} onRetry={autosave.flush} />
          {!readOnly && (
            // Non-modal so the confirm dialog it opens can take focus cleanly.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Character settings">
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    setDeleting(true);
                  }}
                >
                  <Trash2Icon aria-hidden />
                  Delete…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Group title="Identity">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          {number('level', 'Level', { min: 1 })}
          <TextField
            id="sheet-className"
            label="Class"
            initial={sheet.className}
            maxLength={SHORT_TEXT_MAX}
            disabled={readOnly}
            error={errors.className ?? null}
            onCommit={(value) => {
              commit('className', value);
            }}
            onBlur={autosave.flush}
          />
        </div>
        <div className="space-y-2">
          <Label>Public description</Label>
          <RichTextEditor
            id="sheet-public-description"
            label="Public description"
            value={sheet.publicDescription}
            editable={!readOnly}
            onChange={(doc) => {
              commit('publicDescription', isEmptyRichText(doc) ? emptyRichText() : doc);
            }}
            onBlur={autosave.flush}
          />
          <FieldError message={errors.publicDescription ?? null} />
        </div>
      </Group>

      {visual}

      <Group title="Traits">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {ruleset.traits.map((trait) => (
            <div key={trait.id} className="space-y-1.5">
              <Label htmlFor={`sheet-trait-${trait.id}`}>{trait.label}</Label>
              <NativeSelect
                id={`sheet-trait-${trait.id}`}
                value={String(traits[trait.id] ?? 0)}
                disabled={readOnly}
                onChange={(event) => {
                  const next = { ...traits, [trait.id]: Number(event.target.value) };
                  setTraits(next);
                  commit('traits', next, true);
                }}
              >
                {modifiers.map((n) => (
                  <option key={n} value={n}>
                    {formatModifier(n)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ))}
        </div>
        <FieldError message={errors.traits ?? null} />
      </Group>

      <Group title="Defense">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {number('evasion', 'Evasion')}
          {number('armorScore', 'Armor score')}
          {number('armorSlotsMarked', 'Armor slots marked')}
          {number('armorSlotsMax', 'Armor slots')}
        </div>
      </Group>

      <Group title="Health">
        <div className="grid grid-cols-3 gap-4">
          {number('minorThreshold', 'Minor threshold')}
          {number('majorThreshold', 'Major threshold')}
          {number('severeThreshold', 'Severe threshold')}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {number('hpCurrent', 'Current HP')}
          {number('hpMax', 'HP max')}
          {number('stressCurrent', 'Current Stress')}
          {number('stressMax', 'Stress max')}
        </div>
      </Group>

      <Group title="Hope and proficiency">
        <div className="grid grid-cols-2 gap-4">
          {number('hope', 'Hope', { suffix: `of ${String(ruleset.hopeMax)}` })}
          {number('proficiency', 'Proficiency')}
        </div>
      </Group>

      <Group title="Experiences">
        <ListEditor<Experience>
          id="sheet-experiences"
          itemLabel="Experience"
          value={sheet.experiences}
          empty={blank.experience}
          isComplete={hasName}
          max={SHEET_LIST_MAX}
          disabled={readOnly}
          emptyText="No experiences yet."
          renderRow={(row, set, index) => (
            <ExperienceFields
              label={`Experience ${String(index + 1)}`}
              value={row}
              set={set}
              disabled={readOnly}
              onBlur={autosave.flush}
            />
          )}
          onChange={(rows, now) => {
            commit('experiences', rows, now);
          }}
        />
        <FieldError message={errors.experiences ?? null} />
      </Group>

      <Group title="Weapons">
        {(['primary', 'secondary'] as const).map((slot) => {
          const label = slot === 'primary' ? 'Primary weapon' : 'Secondary weapon';
          const weapon = weapons[slot];
          return (
            <div key={slot} className="space-y-2">
              <h3 className="text-sm font-medium">{label}</h3>
              {weapon === null ? (
                <AddButton
                  label={`Add ${label.toLowerCase()}`}
                  disabled={readOnly}
                  onClick={() => {
                    changeWeapons({ ...weapons, [slot]: blank.weapon() });
                  }}
                />
              ) : (
                <SectionBox
                  removeLabel={`Remove ${label.toLowerCase()}`}
                  disabled={readOnly}
                  waiting={!hasName(weapon)}
                  onRemove={() => {
                    changeWeapons({ ...weapons, [slot]: null }, true);
                  }}
                >
                  <WeaponFields
                    label={label}
                    value={weapon}
                    traits={ruleset.traits}
                    disabled={readOnly}
                    onBlur={autosave.flush}
                    set={(next: Weapon) => {
                      changeWeapons({ ...weapons, [slot]: next });
                    }}
                  />
                </SectionBox>
              )}
            </div>
          );
        })}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Spare weapons</h3>
          <ListEditor<Weapon>
            id="sheet-spare-weapons"
            itemLabel="Spare weapon"
            value={sheet.weapons.inventory}
            empty={blank.weapon}
            isComplete={hasName}
            max={SHEET_LIST_MAX}
            disabled={readOnly}
            emptyText="No spare weapons."
            renderRow={(row, set, index) => (
              <WeaponFields
                label={`Spare weapon ${String(index + 1)}`}
                value={row}
                traits={ruleset.traits}
                set={set}
                disabled={readOnly}
                onBlur={autosave.flush}
              />
            )}
            onChange={(rows, now) => {
              changeWeapons({ ...weapons, inventory: rows }, now);
            }}
          />
        </div>
        <FieldError message={errors.weapons ?? null} />
      </Group>

      <Group title="Armor">
        {armor === null ? (
          <AddButton
            label="Add armor"
            disabled={readOnly}
            onClick={() => {
              setArmor(blank.armor());
            }}
          />
        ) : (
          <SectionBox
            removeLabel="Remove armor"
            disabled={readOnly}
            waiting={!hasName(armor)}
            onRemove={() => {
              setArmor(null);
              commit('armor', null, true);
            }}
          >
            <ArmorFields
              label="Armor"
              value={armor}
              disabled={readOnly}
              onBlur={autosave.flush}
              set={(next) => {
                setArmor(next);
                if (hasName(next)) commit('armor', next);
              }}
            />
          </SectionBox>
        )}
        <FieldError message={errors.armor ?? null} />
      </Group>

      <Group title="Inventory">
        <ListEditor<InventoryItem>
          id="sheet-inventory"
          itemLabel="Item"
          value={sheet.inventory}
          empty={blank.item}
          isComplete={hasName}
          max={SHEET_LIST_MAX}
          disabled={readOnly}
          emptyText="Nothing carried yet."
          renderRow={(row, set, index) => (
            <InventoryFields
              label={`Item ${String(index + 1)}`}
              value={row}
              set={set}
              disabled={readOnly}
              onBlur={autosave.flush}
              campaignId={campaign.id}
              items={items}
            />
          )}
          onChange={(rows, now) => {
            commit('inventory', rows, now);
          }}
        />
        <FieldError message={errors.inventory ?? null} />
        <div className="grid grid-cols-3 gap-4">
          {(['handfuls', 'bags', 'chests'] as const).map((key) => (
            <NumberField
              key={key}
              id={`sheet-gold-${key}`}
              label={`Gold: ${key}`}
              initial={sheet.gold[key]}
              min={0}
              disabled={readOnly}
              error={null}
              onCommit={(value) => {
                if (value === null) {
                  setError('gold', 'Enter a whole number');
                  return;
                }
                const next = { ...gold, [key]: value };
                setGold(next);
                commit('gold', next);
              }}
              onBlur={autosave.flush}
            />
          ))}
        </div>
        <FieldError message={errors.gold ?? null} />
      </Group>

      <Group title="Class feature">
        {classFeature === null ? (
          <AddButton
            label="Add class feature"
            disabled={readOnly}
            onClick={() => {
              setClassFeature(blank.named());
            }}
          />
        ) : (
          <SectionBox
            removeLabel="Remove class feature"
            disabled={readOnly}
            waiting={!hasName(classFeature)}
            onRemove={() => {
              setClassFeature(null);
              commit('classFeature', null, true);
            }}
          >
            <NamedTextFields
              label="Class feature"
              value={classFeature}
              disabled={readOnly}
              onBlur={autosave.flush}
              set={(next) => {
                setClassFeature(next);
                if (hasName(next)) commit('classFeature', next);
              }}
            />
          </SectionBox>
        )}
        <FieldError message={errors.classFeature ?? null} />
      </Group>

      <Group title="Combat options">
        <ListEditor<Ability>
          id="sheet-combat-options"
          itemLabel="Combat option"
          value={sheet.combatOptions}
          empty={blank.ability}
          isComplete={hasName}
          max={SHEET_LIST_MAX}
          disabled={readOnly}
          emptyText="No combat options yet."
          renderRow={(row, set, index) => (
            <AbilityFields
              label={`Combat option ${String(index + 1)}`}
              value={row}
              set={set}
              disabled={readOnly}
              onBlur={autosave.flush}
            />
          )}
          onChange={(rows, now) => {
            commit('combatOptions', rows, now);
          }}
        />
        <FieldError message={errors.combatOptions ?? null} />
      </Group>

      <Group title="GM notes" description="Private: the player never sees these.">
        <RichTextEditor
          id="sheet-gm-notes"
          label="GM notes"
          value={sheet.gmNotes}
          editable={!readOnly}
          onChange={(doc) => {
            commit('gmNotes', isEmptyRichText(doc) ? emptyRichText() : doc);
          }}
          onBlur={autosave.flush}
        />
        <FieldError message={errors.gmNotes ?? null} />
      </Group>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(false);
          }}
          title={`Delete ${sheet.name}?`}
          description={
            playerName === null
              ? "This can't be undone."
              : `${playerName} stays in the campaign without a PC. This can't be undone.`
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            autosave.discard();
            await del.mutateAsync(sheet.id);
            onDeleted();
          }}
        />
      )}
    </div>
  );
}
