import {
  SCENE_NAME_MAX,
  sceneNameSchema,
  type Campaign,
  type SceneSummary,
} from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NewSceneDialog } from '@/components/scenes/NewSceneDialog';
import { SceneList } from '@/components/scenes/SceneList';
import { GmOnlyNote } from '@/components/stat-blocks/GmOnlyNote';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useCampaign,
  useCreateScene,
  useDeleteScene,
  usePatchScene,
  useRecords,
  useScenes,
} from '@/lib/queries';
import { scenePath } from '@/lib/scenes';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** `/campaigns/:campaignId/scenes`: the GM's saved scenes (F3.2, governance §12). */
export function ScenesPage() {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) return <CampaignNotFound />;
  return <ScenesView campaign={campaign} />;
}

function ScenesView({ campaign }: { campaign: Campaign }) {
  const isGm = campaign.role === 'gm';
  const editable = isGm && campaign.archivedAt === null;
  const { data: scenes, isPending, isError } = useScenes(campaign.id, isGm);
  const { data: spots } = useRecords(campaign.id, 'spot', editable);
  const create = useCreateScene(campaign.id);
  const patch = usePatchScene(campaign.id);
  const remove = useDeleteScene(campaign.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<SceneSummary | null>(null);
  const [deleting, setDeleting] = useState<SceneSummary | null>(null);

  return (
    <div className="space-y-4">
      <Link
        to={`/campaigns/${campaign.id}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← {campaign.name}
      </Link>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>
              <h1 className="text-2xl">Scenes</h1>
            </CardTitle>
            <CardDescription>
              Each scene is the theater set up for one place: a backdrop, props, and NPC puppets
              waiting below.
            </CardDescription>
          </div>
          {editable && (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
              }}
            >
              <PlusIcon aria-hidden />
              New scene
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!isGm && <GmOnlyNote />}
          {isGm && isPending && <p className="text-muted-foreground">Loading scenes…</p>}
          {isGm && isError && <p role="alert">Could not load the scenes. Try again in a moment.</p>}
          {isGm && scenes !== undefined && (
            <SceneList
              campaignId={campaign.id}
              scenes={scenes}
              editable={editable}
              onRename={setRenaming}
              onDelete={setDeleting}
            />
          )}
        </CardContent>
      </Card>

      <NewSceneDialog
        open={creating}
        onOpenChange={setCreating}
        spots={spots ?? []}
        onCreate={async (input) => {
          const scene = await create.mutateAsync(input);
          void navigate(scenePath(campaign.id, scene.id));
        }}
      />
      <CampaignNameDialog
        // A fresh form for each scene.
        key={renaming?.id ?? 'none'}
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title="Rename scene"
        description="Only you see scene names."
        submitLabel="Save name"
        label="Scene name"
        initialName={renaming?.name ?? ''}
        schema={sceneNameSchema}
        maxLength={SCENE_NAME_MAX}
        onSave={(name) =>
          renaming === null
            ? Promise.resolve()
            : patch.mutateAsync({ sceneId: renaming.id, patch: { name } })
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? 'this scene'}?`}
        description="The scene and where everything stands in it are deleted for good. Its records and their images are kept."
        confirmLabel="Delete scene"
        onConfirm={() => (deleting === null ? Promise.resolve() : remove.mutateAsync(deleting.id))}
      />
    </div>
  );
}
