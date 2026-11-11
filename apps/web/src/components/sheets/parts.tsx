/**
 * Inputs for the rows and sections of a sheet or stat block: experiences, abilities,
 * attacks and weapons, armor, inventory. Each is controlled by its parent and labelled by a
 * prefix such as "Experience 2" or "Primary weapon", so every input has a unique name.
 */
import {
  ABILITY_KINDS,
  MOTIVE_MAX,
  SHORT_TEXT_MAX,
  TEXT_FIELD_MAX,
  type Ability,
  type Armor,
  type Attack,
  type Experience,
  type InventoryItem,
  type RulesetTrait,
  type Weapon,
} from '@stagehand/shared';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { enumLabel } from '@/lib/records';

interface PartProps<T> {
  /** Prefix of every input's accessible name, e.g. "Experience 2". */
  label: string;
  value: T;
  set: (next: T) => void;
  disabled: boolean;
  onBlur: () => void;
}

function RowText({
  label,
  placeholder,
  value,
  onChange,
  disabled,
  onBlur,
  maxLength = SHORT_TEXT_MAX,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onBlur: () => void;
  maxLength?: number;
}) {
  return (
    <Input
      aria-label={label}
      placeholder={placeholder}
      value={value}
      maxLength={maxLength}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onBlur={onBlur}
    />
  );
}

function RowLongText(props: Parameters<typeof RowText>[0]) {
  return (
    <Textarea
      aria-label={props.label}
      placeholder={props.placeholder}
      value={props.value}
      maxLength={TEXT_FIELD_MAX}
      disabled={props.disabled}
      onChange={(event) => {
        props.onChange(event.target.value);
      }}
      onBlur={props.onBlur}
    />
  );
}

/** A whole number inside a row. It keeps its own text, so "-" can be typed before "2". */
export function RowNumber({
  label,
  placeholder,
  value,
  onChange,
  disabled,
  onBlur,
}: {
  label: string;
  placeholder: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  onBlur: () => void;
}) {
  const [draft, setDraft] = useState(String(value));
  return (
    <Input
      type="number"
      inputMode="numeric"
      step={1}
      className="w-24"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (event.target.value.trim() !== '' && Number.isInteger(parsed)) onChange(parsed);
      }}
      onBlur={onBlur}
    />
  );
}

export function ExperienceFields({ label, value, set, disabled, onBlur }: PartProps<Experience>) {
  return (
    <div className="flex gap-2">
      <RowText
        label={`${label} name`}
        placeholder="Experience"
        value={value.name}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(name) => {
          set({ ...value, name });
        }}
      />
      <RowNumber
        label={`${label} bonus`}
        placeholder="Bonus"
        value={value.bonus}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(bonus) => {
          set({ ...value, bonus });
        }}
      />
    </div>
  );
}

export function AbilityFields({ label, value, set, disabled, onBlur }: PartProps<Ability>) {
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <RowText
          label={`${label} name`}
          placeholder="Name"
          value={value.name}
          disabled={disabled}
          onBlur={onBlur}
          onChange={(name) => {
            set({ ...value, name });
          }}
        />
        <NativeSelect
          aria-label={`${label} kind`}
          value={value.kind}
          disabled={disabled}
          onChange={(event) => {
            set({ ...value, kind: event.target.value as Ability['kind'] });
          }}
        >
          {ABILITY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {enumLabel(kind)}
            </option>
          ))}
        </NativeSelect>
        <RowText
          label={`${label} cost`}
          placeholder="Cost, e.g. 1 Hope"
          value={value.cost}
          disabled={disabled}
          onBlur={onBlur}
          onChange={(cost) => {
            set({ ...value, cost });
          }}
        />
      </div>
      <RowLongText
        label={`${label} description`}
        placeholder="What it does"
        value={value.description}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(description) => {
          set({ ...value, description });
        }}
      />
    </>
  );
}

/** The fields an attack and a weapon share. */
export function AttackFields<T extends Attack>({
  label,
  value,
  set,
  disabled,
  onBlur,
}: PartProps<T>) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <RowText
        label={`${label} name`}
        placeholder="Name"
        value={value.name}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(name) => {
          set({ ...value, name });
        }}
      />
      <RowText
        label={`${label} range`}
        placeholder="Range, e.g. Melee"
        value={value.range}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(range) => {
          set({ ...value, range });
        }}
      />
      <RowText
        label={`${label} damage dice`}
        placeholder="Damage dice, e.g. 1d8+2"
        value={value.damageDice}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(damageDice) => {
          set({ ...value, damageDice });
        }}
      />
      <RowText
        label={`${label} damage type`}
        placeholder="Damage type, e.g. physical"
        value={value.damageType}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(damageType) => {
          set({ ...value, damageType });
        }}
      />
    </div>
  );
}

export function WeaponFields({
  traits,
  ...props
}: PartProps<Weapon> & { traits: readonly RulesetTrait[] }) {
  const { label, value, set, disabled, onBlur } = props;
  return (
    <>
      <AttackFields {...props} />
      <NativeSelect
        aria-label={`${label} trait`}
        value={value.trait ?? ''}
        disabled={disabled}
        onChange={(event) => {
          set({ ...value, trait: event.target.value === '' ? null : event.target.value });
        }}
      >
        <option value="">Trait: —</option>
        {traits.map((trait) => (
          <option key={trait.id} value={trait.id}>
            Trait: {trait.label}
          </option>
        ))}
      </NativeSelect>
      <RowLongText
        label={`${label} feature`}
        placeholder="Feature"
        value={value.feature}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(feature) => {
          set({ ...value, feature });
        }}
      />
    </>
  );
}

export function ArmorFields({ label, value, set, disabled, onBlur }: PartProps<Armor>) {
  const number = (
    key: 'baseMajorThreshold' | 'baseSevereThreshold' | 'baseScore',
    text: string,
  ) => (
    <RowNumber
      label={`${label} ${text.toLowerCase()}`}
      placeholder={text}
      value={value[key]}
      disabled={disabled}
      onBlur={onBlur}
      onChange={(n) => {
        set({ ...value, [key]: n });
      }}
    />
  );
  return (
    <>
      <RowText
        label={`${label} name`}
        placeholder="Name"
        value={value.name}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(name) => {
          set({ ...value, name });
        }}
      />
      <div className="flex flex-wrap gap-2">
        {number('baseMajorThreshold', 'Base major threshold')}
        {number('baseSevereThreshold', 'Base severe threshold')}
        {number('baseScore', 'Base score')}
      </div>
      <RowLongText
        label={`${label} feature`}
        placeholder="Feature"
        value={value.feature}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(feature) => {
          set({ ...value, feature });
        }}
      />
    </>
  );
}

export function InventoryFields({ label, value, set, disabled, onBlur }: PartProps<InventoryItem>) {
  return (
    <>
      <RowText
        label={`${label} name`}
        placeholder="Item"
        value={value.name}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(name) => {
          set({ ...value, name });
        }}
      />
      <RowLongText
        label={`${label} detail`}
        placeholder="Detail"
        value={value.detail}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(detail) => {
          set({ ...value, detail });
        }}
      />
    </>
  );
}

/** A name + description pair, e.g. a class feature. */
export function NamedTextFields({
  label,
  value,
  set,
  disabled,
  onBlur,
}: PartProps<{ name: string; description: string }>) {
  return (
    <>
      <RowText
        label={`${label} name`}
        placeholder="Name"
        value={value.name}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(name) => {
          set({ ...value, name });
        }}
      />
      <RowLongText
        label={`${label} description`}
        placeholder="Description"
        value={value.description}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(description) => {
          set({ ...value, description });
        }}
      />
    </>
  );
}

export function MotiveField({ label, value, set, disabled, onBlur }: PartProps<string>) {
  return (
    <RowText
      label={label}
      placeholder="E.g. Ambush from below"
      value={value}
      maxLength={MOTIVE_MAX}
      disabled={disabled}
      onBlur={onBlur}
      onChange={set}
    />
  );
}
