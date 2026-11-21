import {
  rulesetFor,
  TEXT_FIELD_MAX,
  updateSubclassRequestSchema,
  type Campaign,
  type Ruleset,
  type SubclassRecord,
  type UpdateSubclassRequest,
} from '@stagehand/shared';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FeatureListField } from '@/components/gameplay/ClassForm';
import { SubclassView } from '@/components/gameplay/ClassViews';
import { GearTitle } from '@/components/gameplay/GearForm';
import { TextField } from '@/components/sheets/TextField';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useCampaign, useDeleteSubclass, usePatchSubclass, useSubclass } from '@/lib/queries';
import { classPath, gameplayPath } from '@/lib/records';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/gameplay/classes/:classId/subclasses/:subclassId` (F4.5). */
export function SubclassPage() {
  const { campaignId = '', subclassId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const subclassQuery = useSubclass(campaignId, subclassId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  if (subclassQuery.isPending) return <p className="text-muted-foreground">Loading subclass…</p>;
  if (subclassQuery.isError) {
    return <p role="alert">Could not load this subclass. Try again in a moment.</p>;
  }
  const subclass = subclassQuery.data;
  if (subclass === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Subclass not found</h1>
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
        to={classPath(campaign.id, subclass.classId)}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← {subclass.className}
      </Link>
      {canWrite ? (
        <SubclassForm key={subclass.id} campaign={campaign} subclass={subclass} ruleset={ruleset} />
      ) : (
        <SubclassView subclass={subclass} ruleset={ruleset} />
      )}
    </div>
  );
}

type Key = keyof UpdateSubclassRequest;
type FeatureKey = 'foundation' | 'specialization' | 'mastery';
const FEATURE_LISTS: [FeatureKey, string, string, string][] = [
  ['foundation', 'Foundation', 'Foundation feature', 'A new character of this subclass has these.'],
  [
    'specialization',
    'Specialization',
    'Specialization feature',
    'Gained with the first upgraded subclass card.',
  ],
  ['mastery', 'Mastery', 'Mastery feature', 'Gained with the second upgraded subclass card.'],
];

/** The GM's editor for a subclass, autosaving key by key. */
function SubclassForm({
  campaign,
  subclass,
  ruleset,
}: {
  campaign: Campaign;
  subclass: SubclassRecord;
  ruleset: Ruleset;
}) {
  const { mutateAsync: sendPatch } = usePatchSubclass(campaign.id, subclass.id);
  const del = useDeleteSubclass(campaign.id);
  const navigate = useNavigate();
  const send = useCallback<SendPatch<UpdateSubclassRequest>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  const [spellcast, setSpellcast] = useState(subclass.spellcastTrait);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [deleting, setDeleting] = useState(false);

  function commit(key: Key, value: unknown, now = false) {
    const parsed = updateSubclassRequestSchema.safeParse({ [key]: value });
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
        what="Subclass"
        initial={subclass.name}
        error={errors.name ?? null}
        autosave={autosave}
        onChange={(name) => {
          commit('name', name);
        }}
        onDelete={() => {
          setDeleting(true);
        }}
      />
      <p className="text-sm text-muted-foreground">A subclass of {subclass.className}.</p>

      <TextField
        id="subclass-description"
        label="Description"
        initial={subclass.description}
        maxLength={TEXT_FIELD_MAX}
        multiline
        disabled={false}
        error={errors.description ?? null}
        onCommit={(description) => {
          commit('description', description);
        }}
        onBlur={autosave.flush}
      />

      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="subclass-spellcast">Spellcast trait</Label>
        <NativeSelect
          id="subclass-spellcast"
          value={spellcast ?? ''}
          onChange={(event) => {
            const next = event.target.value === '' ? null : event.target.value;
            setSpellcast(next);
            commit('spellcastTrait', next, true);
          }}
        >
          <option value="">None: it doesn&apos;t cast</option>
          {ruleset.traits.map((trait) => (
            <option key={trait.id} value={trait.id}>
              {trait.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {FEATURE_LISTS.map(([key, title, itemLabel, description]) => (
        <FeatureListField
          key={key}
          id={`subclass-${key}`}
          title={title}
          description={description}
          itemLabel={itemLabel}
          initial={subclass[key]}
          error={errors[key] ?? null}
          onChange={(rows, now) => {
            commit(key, rows, now);
          }}
          onBlur={autosave.flush}
        />
      ))}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(false);
          }}
          title={`Delete ${subclass.name}?`}
          description="This can't be undone."
          confirmLabel="Delete subclass"
          onConfirm={async () => {
            autosave.discard();
            await del.mutateAsync(subclass.id);
            void navigate(classPath(campaign.id, subclass.classId), { replace: true });
          }}
        />
      )}
    </div>
  );
}
