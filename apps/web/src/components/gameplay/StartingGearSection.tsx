import {
  STARTING_GEAR_MODES,
  type StartingGear,
  type StartingGearMode,
  type StartingKit,
} from '@stagehand/shared';
import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { FieldError } from '@/components/FieldError';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useArmorList, usePutStartingGear, useStartingGear, useWeapons } from '@/lib/queries';

/**
 * The campaign's starting gear (F4.8, governance §8 "Starting gear"), on the GM's Gameplay page:
 * how the creation guide hands out gear, and the kit for the Set mode. The mode saves when
 * picked; the kit with Save kit.
 */

const MODE_LABELS: Record<StartingGearMode, { label: string; help: string }> = {
  default: {
    label: 'Default',
    help: 'Players pick a tier 1 primary weapon (and a secondary beside a one-handed one), tier 1 armor and a potion, and get a torch, rope, basic supplies and a handful of gold.',
  },
  set: {
    label: 'Set',
    help: 'Every new character gets the kit below, with nothing to pick.',
  },
  none: {
    label: 'None',
    help: 'No gear from the guide: you hand it out in play.',
  },
};

export function StartingGearSection({
  campaignId,
  canWrite,
}: {
  campaignId: string;
  canWrite: boolean;
}) {
  const query = useStartingGear(campaignId);
  const put = usePutStartingGear(campaignId);
  const [error, setError] = useState<string | null>(null);

  const save = async (gear: StartingGear) => {
    setError(null);
    try {
      await put.mutateAsync(gear);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That didn’t save. Try again.');
    }
  };

  const gear = query.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-xl">Starting gear</h2>
        </CardTitle>
        <CardDescription>
          What the creation guide gives a new character. Only you see this setting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {gear === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="sr-only">Starting gear</legend>
              {STARTING_GEAR_MODES.map((mode) => (
                <label key={mode} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="starting-gear"
                    className="mt-1"
                    value={mode}
                    checked={gear.mode === mode}
                    disabled={!canWrite || put.isPending}
                    onChange={() => void save({ ...gear, mode })}
                  />
                  <span>
                    <span className="font-medium">{MODE_LABELS[mode].label}</span>
                    <span className="block text-muted-foreground">{MODE_LABELS[mode].help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {gear.mode === 'set' && (
              <KitEditor
                key={JSON.stringify(gear.kit)}
                campaignId={campaignId}
                kit={gear.kit}
                disabled={!canWrite || put.isPending}
                onSave={(kit) => save({ mode: 'set', kit })}
              />
            )}
          </>
        )}
        <FieldError message={error} />
      </CardContent>
    </Card>
  );
}

function KitEditor({
  campaignId,
  kit,
  disabled,
  onSave,
}: {
  campaignId: string;
  kit: StartingKit;
  disabled: boolean;
  onSave: (kit: StartingKit) => Promise<void>;
}) {
  const weapons = useWeapons(campaignId).data ?? [];
  const armor = useArmorList(campaignId).data ?? [];
  const [draft, setDraft] = useState<StartingKit>(kit);
  const idOf = (raw: string) => (raw === '' ? null : raw);
  const aboveTier1 = [
    weapons.find((one) => one.id === draft.primaryWeaponId),
    weapons.find((one) => one.id === draft.secondaryWeaponId),
    armor.find((one) => one.id === draft.armorId),
  ].filter((piece) => piece !== undefined && piece.tier > 1);

  const gearSelect = (
    id: string,
    label: string,
    value: string | null,
    options: { id: string; name: string; tier: number }[],
    onChange: (next: string | null) => void,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => {
          onChange(idOf(event.target.value));
        }}
      >
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} (tier {option.tier})
          </option>
        ))}
      </NativeSelect>
    </div>
  );

  return (
    <section aria-label="Starting kit" className="space-y-4 rounded-md border p-4">
      <h3 className="font-semibold">The kit</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        {gearSelect(
          'kit-primary',
          'Primary weapon',
          draft.primaryWeaponId,
          weapons.filter((one) => one.slot === 'primary'),
          (next) => {
            setDraft({ ...draft, primaryWeaponId: next });
          },
        )}
        {gearSelect(
          'kit-secondary',
          'Secondary weapon',
          draft.secondaryWeaponId,
          weapons.filter((one) => one.slot === 'secondary'),
          (next) => {
            setDraft({ ...draft, secondaryWeaponId: next });
          },
        )}
        {gearSelect('kit-armor', 'Armor', draft.armorId, armor, (next) => {
          setDraft({ ...draft, armorId: next });
        })}
      </div>
      {aboveTier1.length > 0 && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {aboveTier1.map((piece) => piece?.name).join(', ')}: above tier 1, so stronger than a new
          character usually starts with.
        </p>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Items</h4>
        {draft.items.length === 0 && <p className="text-sm text-muted-foreground">No items.</p>}
        <ul className="space-y-2">
          {draft.items.map((item, index) => (
            <li key={index} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`kit-item-${String(index)}`}>Item {index + 1}</Label>
                <Input
                  id={`kit-item-${String(index)}`}
                  value={item.name}
                  disabled={disabled}
                  onChange={(event) => {
                    const items = [...draft.items];
                    items[index] = { ...item, name: event.target.value };
                    setDraft({ ...draft, items });
                  }}
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`kit-item-detail-${String(index)}`}>Detail</Label>
                <Input
                  id={`kit-item-detail-${String(index)}`}
                  value={item.detail}
                  disabled={disabled}
                  onChange={(event) => {
                    const items = [...draft.items];
                    items[index] = { ...item, detail: event.target.value };
                    setDraft({ ...draft, items });
                  }}
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove item ${String(index + 1)}`}
                disabled={disabled}
                onClick={() => {
                  setDraft({ ...draft, items: draft.items.filter((_, at) => at !== index) });
                }}
              >
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setDraft({ ...draft, items: [...draft.items, { name: '', detail: '' }] });
          }}
        >
          <PlusIcon aria-hidden />
          Add item
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['handfuls', 'Handfuls of gold'],
            ['bags', 'Bags of gold'],
            ['chests', 'Chests of gold'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`kit-gold-${key}`}>{label}</Label>
            <Input
              id={`kit-gold-${key}`}
              type="number"
              min={0}
              value={draft.gold[key]}
              disabled={disabled}
              onChange={(event) => {
                const value = Math.max(0, Math.trunc(Number(event.target.value) || 0));
                setDraft({ ...draft, gold: { ...draft.gold, [key]: value } });
              }}
            />
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        disabled={disabled}
        onClick={() =>
          void onSave({ ...draft, items: draft.items.filter((item) => item.name.trim() !== '') })
        }
      >
        Save kit
      </Button>
    </section>
  );
}
