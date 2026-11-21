import {
  BONUS_MAX,
  GEAR_FEATURE_NAME_MAX,
  GEAR_FEATURE_TEXT_MAX,
  GEAR_NAME_MAX,
  GEAR_TIER_MAX,
  type GearBonuses,
  type Ruleset,
} from '@stagehand/shared';
import { MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { FieldError } from '@/components/FieldError';
import { SaveStatus } from '@/components/records/SaveStatus';
import { NumberField } from '@/components/sheets/NumberField';
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
import { Textarea } from '@/components/ui/textarea';
import type { Autosave } from '@/lib/useAutosave';

/**
 * The parts the GM's weapon and armor forms share (F4.4): the name with the save status and the
 * delete menu, the tier, the feature, and the bonuses applied while equipped (19.25).
 */

export function GearTitle({
  what,
  initial,
  error,
  autosave,
  onChange,
  onDelete,
}: {
  /** "Weapon" or "Armor". */
  what: string;
  initial: string;
  error: string | null;
  autosave: Pick<Autosave<object>, 'status' | 'error' | 'flush'>;
  onChange: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 space-y-1">
        <Input
          aria-label={`${what} name`}
          className="text-lg font-semibold md:text-lg"
          value={name}
          maxLength={GEAR_NAME_MAX}
          aria-invalid={error !== null}
          onChange={(event) => {
            setName(event.target.value);
            onChange(event.target.value);
          }}
          onBlur={autosave.flush}
        />
        <FieldError message={error} />
      </div>
      <div className="flex items-center gap-2">
        <SaveStatus status={autosave.status} error={autosave.error} onRetry={autosave.flush} />
        {/* Non-modal so the confirm dialog it opens can take focus cleanly. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${what} settings`}>
              <MoreHorizontalIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon aria-hidden />
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const TIERS = Array.from({ length: GEAR_TIER_MAX }, (_, index) => index + 1);

export function TierField({
  initial,
  onChange,
}: {
  initial: number;
  onChange: (tier: number) => void;
}) {
  const [tier, setTier] = useState(initial);
  return (
    <div className="space-y-1.5">
      <Label htmlFor="gear-tier">Tier</Label>
      <NativeSelect
        id="gear-tier"
        value={String(tier)}
        onChange={(event) => {
          const next = Number(event.target.value);
          setTier(next);
          onChange(next);
        }}
      >
        {TIERS.map((option) => (
          <option key={option} value={option}>
            Tier {option}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function FeatureFields({
  initialName,
  initialText,
  errors,
  onName,
  onText,
  onBlur,
}: {
  initialName: string;
  initialText: string;
  errors: { name: string | null; text: string | null };
  onName: (name: string) => void;
  onText: (text: string) => void;
  onBlur: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialText);
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Feature</legend>
      <div className="space-y-1.5">
        <Label htmlFor="gear-feature-name">Name (optional)</Label>
        <Input
          id="gear-feature-name"
          value={name}
          maxLength={GEAR_FEATURE_NAME_MAX}
          placeholder="Heavy"
          aria-invalid={errors.name !== null}
          onChange={(event) => {
            setName(event.target.value);
            onName(event.target.value);
          }}
          onBlur={onBlur}
        />
        <FieldError message={errors.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="gear-feature-text">What it does</Label>
        <Textarea
          id="gear-feature-text"
          rows={3}
          value={text}
          maxLength={GEAR_FEATURE_TEXT_MAX}
          placeholder="−1 to Evasion"
          aria-invalid={errors.text !== null}
          onChange={(event) => {
            setText(event.target.value);
            onText(event.target.value);
          }}
          onBlur={onBlur}
        />
        <FieldError message={errors.text} />
      </div>
    </fieldset>
  );
}

type NumberKey = 'evasion' | 'armorScore' | 'majorThreshold' | 'severeThreshold';
const NUMBER_FIELDS: [NumberKey, string][] = [
  ['evasion', 'Evasion bonus'],
  ['armorScore', 'Armor score bonus'],
  ['majorThreshold', 'Major threshold bonus'],
  ['severeThreshold', 'Severe threshold bonus'],
];

/**
 * The numbers the feature changes while the gear is equipped: each −99 to +99, 0 for none. The
 * whole set is sent on each change. A sheet applies them once it links gear (F4.7).
 */
export function BonusFields({
  initial,
  ruleset,
  onChange,
  onBlur,
}: {
  initial: GearBonuses;
  ruleset: Ruleset;
  onChange: (bonuses: GearBonuses) => void;
  onBlur: () => void;
}) {
  const [bonuses, setBonuses] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  function commit(key: string, value: number | null, next: (n: number) => GearBonuses) {
    if (value === null || value < -BONUS_MAX || value > BONUS_MAX) {
      setErrors((current) => ({
        ...current,
        [key]: `Enter a whole number from −${String(BONUS_MAX)} to ${String(BONUS_MAX)}`,
      }));
      return;
    }
    setErrors((current) => ({ ...current, [key]: undefined }));
    const updated = next(value);
    setBonuses(updated);
    onChange(updated);
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Bonuses while equipped</legend>
      <p className="text-sm text-muted-foreground">
        Enter the numbers the feature changes, e.g. −1 for “−1 to Evasion”. Leave the rest at 0.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {NUMBER_FIELDS.map(([key, label]) => (
          <NumberField
            key={key}
            id={`bonus-${key}`}
            label={label}
            initial={initial[key]}
            min={-BONUS_MAX}
            max={BONUS_MAX}
            disabled={false}
            error={errors[key] ?? null}
            onCommit={(value) => {
              commit(key, value, (n) => ({ ...bonuses, [key]: n }));
            }}
            onBlur={onBlur}
          />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {ruleset.traits.map((trait) => (
          <NumberField
            key={trait.id}
            id={`bonus-trait-${trait.id}`}
            label={trait.label}
            initial={initial.traits[trait.id] ?? 0}
            min={-BONUS_MAX}
            max={BONUS_MAX}
            disabled={false}
            error={errors[`trait-${trait.id}`] ?? null}
            onCommit={(value) => {
              commit(`trait-${trait.id}`, value, (n) => ({
                ...bonuses,
                traits: { ...bonuses.traits, [trait.id]: n },
              }));
            }}
            onBlur={onBlur}
          />
        ))}
      </div>
    </fieldset>
  );
}
