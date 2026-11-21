import {
  rulesetFor,
  SEVERE_BELOW_MAJOR,
  SHEET_NUMBER_MAX,
  updateArmorRequestSchema,
  type ArmorRecord,
  type Campaign,
  type Ruleset,
  type UpdateArmorRequest,
} from '@stagehand/shared';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BonusFields, FeatureFields, GearTitle, TierField } from '@/components/gameplay/GearForm';
import { ArmorView } from '@/components/gameplay/GearViews';
import { NumberField } from '@/components/sheets/NumberField';
import { useArmor, useCampaign, useDeleteArmor, usePatchArmor } from '@/lib/queries';
import { armorListPath, gameplayPath } from '@/lib/records';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/gameplay/armor/:armorId` (F4.4): one piece of armor. */
export function ArmorPage() {
  const { campaignId = '', armorId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const armorQuery = useArmor(campaignId, armorId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  if (armorQuery.isPending) return <p className="text-muted-foreground">Loading armor…</p>;
  if (armorQuery.isError) {
    return <p role="alert">Could not load this armor. Try again in a moment.</p>;
  }
  const armor = armorQuery.data;
  if (armor === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Armor not found</h1>
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
      <Link
        to={armorListPath(campaign.id)}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Armor
      </Link>
      {canWrite ? (
        <ArmorForm key={armor.id} campaign={campaign} armor={armor} ruleset={ruleset} />
      ) : (
        <ArmorView armor={armor} ruleset={ruleset} />
      )}
    </div>
  );
}

type Key = keyof UpdateArmorRequest;
type NumberKey = 'baseMajorThreshold' | 'baseSevereThreshold' | 'baseScore';

/** The GM's editor for a piece of armor, autosaving key by key. */
function ArmorForm({
  campaign,
  armor,
  ruleset,
}: {
  campaign: Campaign;
  armor: ArmorRecord;
  ruleset: Ruleset;
}) {
  const { mutateAsync: sendPatch } = usePatchArmor(campaign.id, armor.id);
  const del = useDeleteArmor(campaign.id);
  const navigate = useNavigate();
  const send = useCallback<SendPatch<UpdateArmorRequest>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  const [numbers, setNumbers] = useState({
    baseMajorThreshold: armor.baseMajorThreshold,
    baseSevereThreshold: armor.baseSevereThreshold,
  });
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [deleting, setDeleting] = useState(false);

  function commit(key: Key, value: unknown, now = false) {
    const parsed = updateArmorRequestSchema.safeParse({ [key]: value });
    if (!parsed.success) {
      setErrors((current) => ({ ...current, [key]: parsed.error.issues[0]?.message }));
      return false;
    }
    setErrors((current) => ({ ...current, [key]: undefined }));
    autosave.save(parsed.data);
    if (now) autosave.flush();
    return true;
  }

  const number = (key: NumberKey, label: string) => (
    <NumberField
      id={`armor-${key}`}
      label={label}
      initial={armor[key]}
      min={0}
      max={SHEET_NUMBER_MAX}
      disabled={false}
      error={errors[key] ?? null}
      onCommit={(value) => {
        if (value === null) {
          setErrors((current) => ({ ...current, [key]: 'Enter a whole number' }));
          return;
        }
        if (commit(key, value) && key !== 'baseScore') {
          setNumbers((current) => ({ ...current, [key]: value }));
        }
      }}
      onBlur={autosave.flush}
    />
  );

  return (
    <div className="space-y-6">
      <GearTitle
        what="Armor"
        initial={armor.name}
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
          initial={armor.tier}
          onChange={(tier) => {
            commit('tier', tier, true);
          }}
        />
        {number('baseScore', 'Armor score')}
        {number('baseMajorThreshold', 'Major threshold')}
        {number('baseSevereThreshold', 'Severe threshold')}
      </div>
      <p className="text-sm text-muted-foreground">
        Damage below the major threshold marks 1 HP, from it 2 HP, and from the severe threshold 3
        HP. A sheet adds the PC&apos;s level to both.
      </p>
      {numbers.baseSevereThreshold < numbers.baseMajorThreshold && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {SEVERE_BELOW_MAJOR}.
        </p>
      )}

      <FeatureFields
        initialName={armor.featureName}
        initialText={armor.featureText}
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
        initial={armor.bonuses}
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
          title={`Delete ${armor.name}?`}
          description="This can't be undone."
          confirmLabel="Delete armor"
          onConfirm={async () => {
            autosave.discard();
            await del.mutateAsync(armor.id);
            void navigate(armorListPath(campaign.id), { replace: true });
          }}
        />
      )}
    </div>
  );
}
