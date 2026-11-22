import {
  CHARACTER_NAME_MAX,
  characterSheetPatchSchemaFor,
  emptyRichText,
  isEmptyRichText,
  loadoutMaxOf,
  rulesetFor,
  SHEET_LIST_MAX,
  SHORT_TEXT_MAX,
  type Ability,
  type Armor,
  type Campaign,
  type CharacterSheet,
  type CharacterSheetPatch,
  type SheetLinks,
  type ClassFeature,
  type Experience,
  type Gold,
  type InventoryItem,
  type Weapon,
} from '@stagehand/shared';
import { MoreHorizontalIcon, Trash2Icon, Undo2Icon, WandSparklesIcon } from 'lucide-react';
import { Link } from 'react-router';
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
import {
  useAddHeldCard,
  useDeleteCharacter,
  useGrantLevel,
  useSetNeedsGuide,
  useUndoLevelUp,
  useDomainCards,
  useMoveHeldCard,
  usePatchCharacter,
  useRecords,
  useRemoveHeldCard,
} from '@/lib/queries';
import { characterBuildPath, characterLevelUpPath } from '@/lib/records';
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
import { FeatureCards, HeldCards } from './SheetCards';
import { ClassLinkFields, GearLinkSelect, SpareWeaponLinks } from './SheetLinkFields';
import { TextField } from './TextField';

/** The stored values the form edits key by key; links are set by `LinkFields` (F4.7). */
type Key = Exclude<keyof CharacterSheetPatch, keyof SheetLinks>;
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
  const [sendingToGuide, setSendingToGuide] = useState(false);
  const [skippingGuide, setSkippingGuide] = useState(false);
  const [undoingLevel, setUndoingLevel] = useState(false);
  const grant = useGrantLevel(campaign.id, sheet.id);
  const undoLevel = useUndoLevelUp(campaign.id, sheet.id);
  const latestLevelUp = sheet.levelUp.history.at(-1) ?? null;
  const levelMax = ruleset.levels?.max ?? sheet.level;
  const guide = useSetNeedsGuide(campaign.id, sheet.id);
  const [linkError, setLinkError] = useState<string | null>(null);
  const built = sheet.built;

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

  /** Saves link keys (F4.7) at once; the server checks them against the campaign's records. */
  function link(patch: Partial<SheetLinks>) {
    const parsed = characterSheetPatchSchemaFor(ruleset).safeParse(patch);
    if (!parsed.success) {
      setLinkError(parsed.error.issues[0]?.message ?? 'Invalid link');
      return;
    }
    setLinkError(null);
    autosave.save(parsed.data);
    autosave.flush();
  }

  /** Weapons save together; a weapon in hand without a name waits until it has one. */
  function changeWeapons(next: CharacterSheet['weapons'], now = false) {
    setWeapons(next);
    const waiting = [next.primary, next.secondary].some((w) => w !== null && !hasName(w));
    if (!waiting) commit('weapons', next, now);
  }

  const number = (
    key: NumberKey,
    label: string,
    extra: { suffix?: string; min?: number; max?: number } = {},
  ) => (
    <NumberField
      id={`sheet-${key}`}
      label={label}
      initial={sheet[key]}
      min={extra.min ?? 0}
      max={extra.max}
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
                {latestLevelUp !== null && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setUndoingLevel(true);
                    }}
                  >
                    <Undo2Icon aria-hidden />
                    Undo level-up to {latestLevelUp.level}…
                  </DropdownMenuItem>
                )}
                {!sheet.needsGuide && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setSendingToGuide(true);
                    }}
                  >
                    <WandSparklesIcon aria-hidden />
                    Send through the creation guide…
                  </DropdownMenuItem>
                )}
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

      {sheet.needsGuide && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/60 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/40"
        >
          <p>
            Waiting for {playerName ?? 'its player'} to build this character with the creation
            guide. The sheet changes when the guide finishes.
          </p>
          {!readOnly && (
            <div className="flex gap-2">
              <Button asChild size="sm">
                <Link to={characterBuildPath(campaign.id, sheet.id)}>Run the guide for them</Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={guide.isPending}
                onClick={() => {
                  setSkippingGuide(true);
                }}
              >
                Fill it in by hand instead…
              </Button>
            </div>
          )}
        </div>
      )}

      {!sheet.needsGuide && !readOnly && (
        <LevelUpBar
          campaignId={campaign.id}
          sheet={sheet}
          playerName={playerName}
          levelMax={levelMax}
          busy={grant.isPending}
          error={grant.error?.message ?? null}
          onGrant={(granted) => {
            grant.mutate(granted);
          }}
        />
      )}

      <Group title="Identity">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          {number('level', 'Level', { min: 1, max: ruleset.levels?.max })}
          {built.linked.class ? (
            <Worked label="Class" value={built.className} from="the linked class" />
          ) : (
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
          )}
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

      <Group
        title="Class, subclass and species"
        description="Linked from the gameplay records. A linked class replaces the class name and the class feature below."
      >
        <ClassLinkFields campaign={campaign} sheet={sheet} readOnly={readOnly} onLink={link} />
        <FieldError message={linkError} />
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
          {built.linked.armor ? (
            <Worked label="Armor score" value={String(built.armorScore)} from="the armor" />
          ) : (
            number('armorScore', 'Armor score')
          )}
          {number('armorSlotsMarked', 'Armor slots marked')}
          {built.linked.armor ? (
            <Worked label="Armor slots" value={String(built.armorSlotsMax)} from="the armor" />
          ) : (
            number('armorSlotsMax', 'Armor slots')
          )}
        </div>
        {built.evasion !== sheet.evasion && (
          <p className="text-sm text-muted-foreground">
            Evasion on the sheet: {built.evasion}, with equipped gear.
          </p>
        )}
      </Group>

      <Group title="Health">
        {built.linked.armor ? (
          <Worked
            label="Thresholds (major / severe)"
            value={`${String(built.thresholds.major)} / ${String(built.thresholds.severe)}`}
            from="the armor, plus the level and gear"
          />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {number('minorThreshold', 'Minor threshold')}
            {number('majorThreshold', 'Major threshold')}
            {number('severeThreshold', 'Severe threshold')}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {number('hpCurrent', 'Current HP')}
          {number('hpMax', 'HP max')}
          {number('stressCurrent', 'Current Stress')}
          {number('stressMax', 'Stress max')}
        </div>
      </Group>

      <Group title="Hope and proficiency">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {number('hope', 'Hope', { suffix: `of ${String(ruleset.hopeMax)}` })}
          {number('hopeBonus', 'Hope bonus', {
            suffix: `added to +${String(ruleset.hopeSpendBonus)}`,
          })}
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
          const linked = built.weapons[slot];
          return (
            <div key={slot} className="space-y-2">
              <h3 className="text-sm font-medium">{label}</h3>
              <GearLinkSelect
                campaignId={campaign.id}
                slot={slot}
                value={
                  slot === 'primary' ? sheet.links.primaryWeaponId : sheet.links.secondaryWeaponId
                }
                disabled={readOnly}
                onChange={(next) => {
                  link(
                    slot === 'primary' ? { primaryWeaponId: next } : { secondaryWeaponId: next },
                  );
                }}
              />
              {linked !== null && linked.weaponId !== null ? (
                <p className="text-sm">
                  {linked.name}: {linked.damage} {linked.damageType}, {linked.range}
                </p>
              ) : weapon === null ? (
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
          <SpareWeaponLinks
            campaignId={campaign.id}
            initial={sheet.links.spareWeaponIds}
            disabled={readOnly}
            onChange={(ids) => {
              link({ spareWeaponIds: ids });
            }}
          />
        </div>
        <FieldError message={errors.weapons ?? null} />
      </Group>

      <Group title="Armor">
        <GearLinkSelect
          campaignId={campaign.id}
          slot="armor"
          value={sheet.links.armorId}
          disabled={readOnly}
          onChange={(next) => {
            link({ armorId: next });
          }}
        />
        {built.linked.armor ? (
          <p className="text-sm">
            {built.armorName}: thresholds {built.thresholds.major} / {built.thresholds.severe},
            score {built.armorScore}
          </p>
        ) : armor === null ? (
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
        {built.linked.class ? (
          <p className="text-sm text-muted-foreground">
            Replaced by {built.className}&apos;s Hope feature and class features (in Feature cards).
          </p>
        ) : classFeature === null ? (
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

      <Group title="Domain cards" description="At most five in the loadout; the rest in the vault.">
        <DomainCardsEditor campaign={campaign} sheet={sheet} readOnly={readOnly} />
      </Group>

      <Group title="Feature cards" description="Worked out from the linked records.">
        <FeatureCards cards={sheet.cards} ruleset={ruleset} />
        {built.warnings.map((warning) => (
          <p key={warning} role="status" className="text-sm text-amber-700 dark:text-amber-400">
            {warning}.
          </p>
        ))}
        {sheet.cards.class === null &&
          sheet.cards.subclass === null &&
          sheet.cards.species.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing linked yet.</p>
          )}
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

      {undoingLevel && latestLevelUp !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setUndoingLevel(false);
          }}
          title={`Undo ${sheet.name}'s level-up to ${String(latestLevelUp.level)}?`}
          description={`The sheet goes back to how it was before: level, traits, slots, evasion, Hope bonus, proficiency and thresholds. The cards it added are removed and any swap is reversed. The level stays granted, so ${playerName ?? 'the player'} can level up again.`}
          confirmLabel="Undo level-up"
          onConfirm={async () => {
            autosave.flush();
            await undoLevel.mutateAsync();
            setUndoingLevel(false);
          }}
        />
      )}

      {skippingGuide && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setSkippingGuide(false);
          }}
          title={`Fill in ${sheet.name} by hand?`}
          description={`${playerName ?? 'Its player'} won't get the creation guide for this character: you fill in the sheet yourself. You can send them through the guide later with Send through the creation guide… in the ⋯ menu.`}
          confirmLabel="Fill it in by hand"
          onConfirm={async () => {
            await guide.mutateAsync(false);
            setSkippingGuide(false);
          }}
        />
      )}

      {sendingToGuide && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setSendingToGuide(false);
          }}
          title={`Send ${sheet.name} through the creation guide?`}
          description={`${playerName ?? 'Its player'} builds a new level 1 character with the guide, or you can run it for them. When it finishes, the class, subclass, species, traits, level, weapons, armor and domain cards are replaced, and the starting items and gold are added to the inventory. Experiences, combat options, spare weapons and your notes stay. Nothing changes until then.`}
          confirmLabel="Send through the guide"
          onConfirm={async () => {
            autosave.flush();
            await guide.mutateAsync(true);
            setSendingToGuide(false);
          }}
        />
      )}

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

/**
 * Leveling up (F4.9) on the GM's editor: Grant a level, or while one waits, who is levelling up,
 * with Run the level-up for them and Withdraw. A PC without a linked class can't use the guide.
 */
function LevelUpBar({
  campaignId,
  sheet,
  playerName,
  levelMax,
  busy,
  error,
  onGrant,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  playerName: string | null;
  levelMax: number;
  busy: boolean;
  error: string | null;
  onGrant: (granted: boolean) => void;
}) {
  const next = sheet.level + 1;
  if (sheet.levelUp.granted) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-500/60 bg-sky-50 px-4 py-3 text-sm dark:bg-sky-950/40"
      >
        <p>
          Level {next} granted: waiting for {playerName ?? 'its player'} to level up with the guide.
        </p>
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link to={characterLevelUpPath(campaignId, sheet.id)}>Run the level-up for them</Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              onGrant(false);
            }}
          >
            Withdraw
          </Button>
        </div>
      </div>
    );
  }
  if (sheet.level >= levelMax) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {sheet.links.classId === null ? (
        <p className="text-muted-foreground">
          Link a class (or send the character through the creation guide) to level up with the
          guide.
        </p>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            onGrant(true);
          }}
        >
          Grant a level (to {next})
        </Button>
      )}
      <FieldError message={error} />
    </div>
  );
}

/** A value worked out from linked records, shown in place of the field it replaces. */
function Worked({ label, value, from }: { label: string; value: string; from: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-sm">
        {value} <span className="text-muted-foreground">(from {from})</span>
      </p>
    </div>
  );
}

/** The GM's domain cards for a PC: add any card of the campaign, move and remove for free. */
function DomainCardsEditor({
  campaign,
  sheet,
  readOnly,
}: {
  campaign: Campaign;
  sheet: CharacterSheet;
  readOnly: boolean;
}) {
  const ruleset = rulesetFor(campaign.rulesetVersion);
  const all = useDomainCards(campaign.id).data ?? [];
  const add = useAddHeldCard(campaign.id, sheet.id);
  const move = useMoveHeldCard(campaign.id, sheet.id, 'gm');
  const remove = useRemoveHeldCard(campaign.id, sheet.id);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const held = new Set([...sheet.cards.loadout, ...sheet.cards.vault].map((card) => card.id));
  const domains = [...new Set(all.map((card) => card.domainName))];

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="sheet-add-card">Add a domain card</Label>
            <NativeSelect
              id="sheet-add-card"
              value={adding}
              onChange={(event) => {
                setAdding(event.target.value);
              }}
            >
              <option value="">Pick a card</option>
              {domains.map((domain) => (
                <optgroup key={domain} label={domain}>
                  {all
                    .filter((card) => card.domainName === domain && !held.has(card.id))
                    .map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.name} (level {card.level})
                      </option>
                    ))}
                </optgroup>
              ))}
            </NativeSelect>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={adding === '' || add.isPending}
            onClick={() => {
              setError(null);
              add.mutateAsync({ cardId: adding }).then(
                () => {
                  setAdding('');
                },
                (caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : 'Could not add that card');
                },
              );
            }}
          >
            Add card
          </Button>
        </div>
      )}
      <FieldError message={error} />
      <HeldCards
        cards={sheet.cards}
        loadoutMax={loadoutMaxOf(ruleset)}
        actions={
          readOnly
            ? undefined
            : {
                who: 'gm',
                onMove: (cardId, to, swapOut) =>
                  move.mutateAsync({ cardId, input: { to, ...(swapOut ? { swapOut } : {}) } }),
                onRemove: (cardId) => remove.mutateAsync(cardId),
              }
        }
      />
    </div>
  );
}
