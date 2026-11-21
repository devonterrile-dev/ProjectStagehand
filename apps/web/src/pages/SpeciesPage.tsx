import {
  TEXT_FIELD_MAX,
  updateSpeciesRequestSchema,
  type Campaign,
  type SpeciesRecord,
  type UpdateSpeciesRequest,
} from '@stagehand/shared';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FeatureListField } from '@/components/gameplay/ClassForm';
import { SpeciesView } from '@/components/gameplay/ClassViews';
import { GearTitle } from '@/components/gameplay/GearForm';
import { TextField } from '@/components/sheets/TextField';
import { useCampaign, useDeleteSpecies, usePatchSpecies, useSpecies } from '@/lib/queries';
import { gameplayPath } from '@/lib/records';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/gameplay/species/:speciesId` (F4.6): one species. */
export function SpeciesPage() {
  const { campaignId = '', speciesId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const speciesQuery = useSpecies(campaignId, speciesId);

  if (campaignQuery.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (campaignQuery.isError) {
    return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  }
  const campaign = campaignQuery.data;
  if (campaign === null) return <CampaignNotFound />;
  if (speciesQuery.isPending) return <p className="text-muted-foreground">Loading species…</p>;
  if (speciesQuery.isError) {
    return <p role="alert">Could not load this species. Try again in a moment.</p>;
  }
  const species = speciesQuery.data;
  if (species === null) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Species not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
        <Link to={gameplayPath(campaign.id)} className="underline">
          Back to gameplay
        </Link>
      </div>
    );
  }

  const canWrite = campaign.role === 'gm' && campaign.archivedAt === null;
  return (
    <div className="space-y-4">
      <Link
        to={gameplayPath(campaign.id)}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Gameplay
      </Link>
      {canWrite ? (
        <SpeciesForm key={species.id} campaign={campaign} species={species} />
      ) : (
        <SpeciesView species={species} />
      )}
    </div>
  );
}

type Key = keyof UpdateSpeciesRequest;

/** The GM's editor for a species, autosaving key by key. */
function SpeciesForm({ campaign, species }: { campaign: Campaign; species: SpeciesRecord }) {
  const { mutateAsync: sendPatch } = usePatchSpecies(campaign.id, species.id);
  const del = useDeleteSpecies(campaign.id);
  const navigate = useNavigate();
  const send = useCallback<SendPatch<UpdateSpeciesRequest>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [deleting, setDeleting] = useState(false);

  function commit(key: Key, value: unknown, now = false) {
    const parsed = updateSpeciesRequestSchema.safeParse({ [key]: value });
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
        what="Species"
        initial={species.name}
        error={errors.name ?? null}
        autosave={autosave}
        onChange={(name) => {
          commit('name', name);
        }}
        onDelete={() => {
          setDeleting(true);
        }}
      />

      <TextField
        id="species-description"
        label="Description"
        initial={species.description}
        maxLength={TEXT_FIELD_MAX}
        multiline
        disabled={false}
        error={errors.description ?? null}
        onCommit={(description) => {
          commit('description', description);
        }}
        onBlur={autosave.flush}
      />

      <FeatureListField
        id="species-features"
        title="Features"
        description="What only this species can do, in order: a mixed ancestry will take the first feature of one species and the second of another."
        itemLabel="Feature"
        initial={species.features}
        error={errors.features ?? null}
        onChange={(rows, now) => {
          commit('features', rows, now);
        }}
        onBlur={autosave.flush}
      />

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(false);
          }}
          title={`Delete ${species.name}?`}
          description="This can't be undone."
          confirmLabel="Delete species"
          onConfirm={async () => {
            autosave.discard();
            await del.mutateAsync(species.id);
            void navigate(gameplayPath(campaign.id), { replace: true });
          }}
        />
      )}
    </div>
  );
}
