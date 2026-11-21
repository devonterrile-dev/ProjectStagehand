import {
  BONUS_MAX,
  BURDENS,
  burdenSchema,
  DAMAGE_DIE_SIDES,
  DAMAGE_KINDS,
  damageKindSchema,
  rulesetFor,
  updateWeaponRequestSchema,
  WEAPON_RANGES,
  WEAPON_SLOTS,
  weaponRangeSchema,
  weaponSlotSchema,
  type Campaign,
  type Ruleset,
  type UpdateWeaponRequest,
  type WeaponRecord,
} from '@stagehand/shared';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BonusFields, FeatureFields, GearTitle, TierField } from '@/components/gameplay/GearForm';
import { WeaponView } from '@/components/gameplay/GearViews';
import { burdenLabel, damageKindLabel, rangeLabel, slotLabel } from '@/components/gameplay/labels';
import { NumberField } from '@/components/sheets/NumberField';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useCampaign, useDeleteWeapon, usePatchWeapon, useWeapon } from '@/lib/queries';
import { gameplayPath, weaponsPath } from '@/lib/records';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/gameplay/weapons/:weaponId` (F4.4): one weapon. */
export function WeaponPage() {
  const { campaignId = '', weaponId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const weaponQuery = useWeapon(campaignId, weaponId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  if (weaponQuery.isPending) return <p className="text-muted-foreground">Loading weapon…</p>;
  if (weaponQuery.isError) {
    return <p role="alert">Could not load this weapon. Try again in a moment.</p>;
  }
  const weapon = weaponQuery.data;
  if (weapon === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Weapon not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
        <Link to={gameplayPath(campaign.id)} className="underline">
          Back to gameplay
        </Link>
      </div>
    );
  }

  const ruleset = rulesetFor(campaign.rulesetVersion);
  const canWrite = campaign.role === 'gm' && campaign.archivedAt === null;
  return (
    <div className="space-y-4">
      <Link to={weaponsPath(campaign.id)} className="text-sm text-muted-foreground hover:underline">
        ← Weapons
      </Link>
      {canWrite ? (
        <WeaponForm key={weapon.id} campaign={campaign} weapon={weapon} ruleset={ruleset} />
      ) : (
        <WeaponView weapon={weapon} ruleset={ruleset} />
      )}
    </div>
  );
}

type Key = keyof UpdateWeaponRequest;

/** The GM's editor for a weapon, autosaving key by key. */
function WeaponForm({
  campaign,
  weapon,
  ruleset,
}: {
  campaign: Campaign;
  weapon: WeaponRecord;
  ruleset: Ruleset;
}) {
  const { mutateAsync: sendPatch } = usePatchWeapon(campaign.id, weapon.id);
  const del = useDeleteWeapon(campaign.id);
  const navigate = useNavigate();
  const send = useCallback<SendPatch<UpdateWeaponRequest>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  const [slot, setSlot] = useState(weapon.slot);
  const [kind, setKind] = useState(weapon.kind);
  const [trait, setTrait] = useState(weapon.trait);
  const [range, setRange] = useState(weapon.range);
  const [die, setDie] = useState(weapon.damageDie);
  const [burden, setBurden] = useState(weapon.burden);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [deleting, setDeleting] = useState(false);

  function commit(key: Key, value: unknown, now = false) {
    const parsed = updateWeaponRequestSchema.safeParse({ [key]: value });
    if (!parsed.success) {
      setErrors((current) => ({ ...current, [key]: parsed.error.issues[0]?.message }));
      return;
    }
    setErrors((current) => ({ ...current, [key]: undefined }));
    autosave.save(parsed.data);
    if (now) autosave.flush();
  }

  return (
    <div className="space-y-6">
      <GearTitle
        what="Weapon"
        initial={weapon.name}
        error={errors.name ?? null}
        autosave={autosave}
        onChange={(name) => {
          commit('name', name);
        }}
        onDelete={() => {
          setDeleting(true);
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TierField
          initial={weapon.tier}
          onChange={(tier) => {
            commit('tier', tier, true);
          }}
        />
        <div className="space-y-1.5">
          <Label htmlFor="weapon-slot">Slot</Label>
          <NativeSelect
            id="weapon-slot"
            value={slot}
            onChange={(event) => {
              const next = weaponSlotSchema.parse(event.target.value);
              setSlot(next);
              // A secondary weapon is one-handed; the server makes it so too.
              if (next === 'secondary') setBurden('one_handed');
              commit('slot', next, true);
            }}
          >
            {WEAPON_SLOTS.map((option) => (
              <option key={option} value={option}>
                {slotLabel(option)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="weapon-trait">Trait</Label>
          <NativeSelect
            id="weapon-trait"
            value={trait}
            onChange={(event) => {
              setTrait(event.target.value);
              commit('trait', event.target.value, true);
            }}
          >
            {ruleset.traits.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="weapon-range">Range</Label>
          <NativeSelect
            id="weapon-range"
            value={range}
            onChange={(event) => {
              const next = weaponRangeSchema.parse(event.target.value);
              setRange(next);
              commit('range', next, true);
            }}
          >
            {WEAPON_RANGES.map((option) => (
              <option key={option} value={option}>
                {rangeLabel(option)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="weapon-die">Damage die</Label>
          <NativeSelect
            id="weapon-die"
            value={String(die)}
            onChange={(event) => {
              const next = Number(event.target.value);
              setDie(next);
              commit('damageDie', next, true);
            }}
          >
            {DAMAGE_DIE_SIDES.map((sides) => (
              <option key={sides} value={sides}>
                d{sides}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            A PC rolls one of these per point of proficiency.
          </p>
        </div>
        <NumberField
          id="weapon-damage-bonus"
          label="Damage bonus"
          initial={weapon.damageBonus}
          min={-BONUS_MAX}
          max={BONUS_MAX}
          disabled={false}
          error={errors.damageBonus ?? null}
          onCommit={(value) => {
            if (value === null) {
              setErrors((current) => ({ ...current, damageBonus: 'Enter a whole number' }));
            } else commit('damageBonus', value);
          }}
          onBlur={autosave.flush}
        />
        <div className="space-y-1.5">
          <Label htmlFor="weapon-kind">Damage type</Label>
          <NativeSelect
            id="weapon-kind"
            value={kind}
            onChange={(event) => {
              const next = damageKindSchema.parse(event.target.value);
              setKind(next);
              commit('kind', next, true);
            }}
          >
            {DAMAGE_KINDS.map((option) => (
              <option key={option} value={option}>
                {damageKindLabel(option)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {slot === 'primary' && (
          <div className="space-y-1.5">
            <Label htmlFor="weapon-burden">Burden</Label>
            <NativeSelect
              id="weapon-burden"
              value={burden}
              onChange={(event) => {
                const next = burdenSchema.parse(event.target.value);
                setBurden(next);
                commit('burden', next, true);
              }}
            >
              {BURDENS.map((option) => (
                <option key={option} value={option}>
                  {burdenLabel(option)}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      <FeatureFields
        initialName={weapon.featureName}
        initialText={weapon.featureText}
        errors={{ name: errors.featureName ?? null, text: errors.featureText ?? null }}
        onName={(name) => {
          commit('featureName', name);
        }}
        onText={(text) => {
          commit('featureText', text);
        }}
        onBlur={autosave.flush}
      />

      <BonusFields
        initial={weapon.bonuses}
        ruleset={ruleset}
        onChange={(bonuses) => {
          commit('bonuses', bonuses);
        }}
        onBlur={autosave.flush}
      />

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(false);
          }}
          title={`Delete ${weapon.name}?`}
          description="This can't be undone."
          confirmLabel="Delete weapon"
          onConfirm={async () => {
            autosave.discard();
            await del.mutateAsync(weapon.id);
            void navigate(weaponsPath(campaign.id), { replace: true });
          }}
        />
      )}
    </div>
  );
}
