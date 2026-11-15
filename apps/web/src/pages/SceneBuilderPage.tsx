import {
  SCENE_MAX_OBJECTS,
  SCENE_NAME_MAX,
  sceneNameSchema,
  type Campaign,
  type Scene,
  type SceneObject,
  type SceneObjectInput,
  type StageRecord,
} from '@stagehand/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { CampaignNameDialog } from '@/components/campaigns/CampaignNameDialog';
import { SaveStatus } from '@/components/records/SaveStatus';

import { ObjectPanel } from '@/components/scenes/ObjectPanel';
import { SceneTray } from '@/components/scenes/SceneTray';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  useCampaign,
  usePatchScene,
  useSaveSceneObjects,
  useScene,
  useStageRecords,
} from '@/lib/queries';
import { recordPath } from '@/lib/records';
import {
  addRefusal,
  changeObject,
  keyAction,
  placeRecord,
  scenesPath,
  spotLabel,
  stageCutouts,
  stageImageUrl,
  toObjectInput,
} from '@/lib/scenes';
import { useAutosave } from '@/lib/useAutosave';
import type { Place } from '@/stage/placement';
import { SceneBuilderCanvas } from '@/stage/SceneBuilderCanvas';

/** A message in place of the builder: loading, not found, not allowed. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  );
}

/**
 * `/campaigns/:campaignId/scenes/:sceneId`: the scene builder (F3.2, governance §12 "Scene
 * builder"). It fills the window, like every stage page, and is loaded lazily so Three.js
 * stays out of the main bundle. GM only.
 */
export function SceneBuilderPage() {
  const { campaignId = '', sceneId = '' } = useParams();
  const campaignQuery = useCampaign(campaignId);
  const isGm = campaignQuery.data?.role === 'gm';
  const sceneQuery = useScene(campaignId, sceneId, isGm);

  if (campaignQuery.isPending) return <Notice>Loading…</Notice>;
  if (campaignQuery.isError) {
    return (
      <Notice>
        <p role="alert">Could not load this campaign. Try again in a moment.</p>
      </Notice>
    );
  }
  const campaign = campaignQuery.data;
  if (campaign === null) {
    return (
      <Notice>
        <h1 className="text-2xl font-bold">Campaign not found</h1>
        <Link to="/" className="underline">
          Back to your campaigns
        </Link>
      </Notice>
    );
  }
  const back = (
    <Link to={scenesPath(campaign.id)} className="underline">
      Back to scenes
    </Link>
  );
  if (!isGm) {
    return (
      <Notice>
        <p>Only the GM builds scenes. You&apos;ll see them on the stage during a session.</p>
        <Link to={`/campaigns/${campaign.id}`} className="underline">
          Back to {campaign.name}
        </Link>
      </Notice>
    );
  }
  if (sceneQuery.isError) {
    return (
      <Notice>
        <p role="alert">Could not load this scene. Try again in a moment.</p>
        {back}
      </Notice>
    );
  }
  // The builder edits its own copy of the objects, so it starts only from a fresh answer,
  // never from an older one kept from an earlier visit.
  if (sceneQuery.isPending || !sceneQuery.isFetchedAfterMount) {
    return <Notice>Loading the scene…</Notice>;
  }
  const scene = sceneQuery.data;
  if (scene === null) {
    return (
      <Notice>
        <h1 className="text-2xl font-bold">Scene not found</h1>
        <p>It may have been deleted.</p>
        {back}
      </Notice>
    );
  }
  return <SceneBuilder key={scene.id} campaign={campaign} scene={scene} />;
}

/** What the builder's autosave sends: always the whole list (D-49). */
interface ObjectsPatch {
  objects: SceneObjectInput[];
}

function SceneBuilder({ campaign, scene }: { campaign: Campaign; scene: Scene }) {
  // The objects as the GM has arranged them. The cached `scene` supplies the rest (name, Spot,
  // suggestions) and follows the server.
  const [objects, setObjects] = useState<SceneObject[]>(scene.objects);
  // The same list, for handlers that outlive a render: a drag in the theater, a key press.
  const objectsRef = useRef(objects);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [lookAround, setLookAround] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const archived = campaign.archivedAt !== null;
  const editable = !archived && !preview;
  const stage = useStageRecords(campaign.id, !archived);
  const patch = usePatchScene(campaign.id);
  const saveObjects = useSaveSceneObjects(campaign.id, scene.id);
  const autosave = useAutosave<ObjectsPatch>((pending, { keepalive }) =>
    saveObjects.mutateAsync({ objects: pending.objects, keepalive }),
  );
  const { save } = autosave;

  // These are stable, so the theater isn't re-rendered each time a panel is.
  const commit = useCallback(
    (next: SceneObject[]) => {
      objectsRef.current = next;
      setObjects(next);
      save({ objects: next.map(toObjectInput) });
    },
    [save],
  );

  /** Adds a record: at `place` when it was dropped in the theater, else at the usual spot. */
  const add = useCallback(
    (entry: StageRecord, place: Place | null = null) => {
      const current = objectsRef.current;
      if (addRefusal(current, entry) !== null) return;
      const placed = placeRecord(current, entry, crypto.randomUUID());
      const object = place === null ? placed : changeObject(placed, place);
      commit([...current, object]);
      setSelectedId(object.id);
    },
    [commit],
  );

  const change = useCallback(
    (id: string, changes: Partial<SceneObject>) => {
      commit(
        objectsRef.current.map((object) =>
          object.id === id ? changeObject(object, changes) : object,
        ),
      );
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit(objectsRef.current.filter((object) => object.id !== id));
      setSelectedId(null);
    },
    [commit],
  );

  const trayRecords = stage.data?.records;
  const dropRecord = useCallback(
    (recordId: string, place: Place | null) => {
      const entry = [...scene.suggestions, ...(trayRecords ?? [])].find(
        (candidate) => candidate.record.id === recordId,
      );
      if (entry !== undefined) add(entry, place);
    },
    [scene.suggestions, trayRecords, add],
  );

  // Keys for the selected object (F3.2c). Not while typing, in a dialog or in a menu.
  useEffect(() => {
    if (!editable || renaming || selectedId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const { target } = event;
      if (
        target instanceof Element &&
        target.closest(
          'input, select, textarea, [contenteditable], [role="dialog"], [role="alertdialog"], [role="menu"]',
        ) !== null
      ) {
        return;
      }
      const object = objectsRef.current.find((candidate) => candidate.id === selectedId);
      if (object === undefined) return;
      const action = keyAction(object, event.key, event.shiftKey);
      if (action === null) return;
      event.preventDefault();
      if (action === 'remove') remove(object.id);
      else if (action === 'deselect') setSelectedId(null);
      else change(object.id, action.change);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [editable, renaming, selectedId, change, remove]);

  const cutouts = useMemo(
    () => stageCutouts(campaign.id, objects, { preview }),
    [campaign.id, objects, preview],
  );
  const backdrop = scene.spot?.backdrop ?? null;
  const backdropUrl = backdrop === null ? null : stageImageUrl(campaign.id, backdrop);
  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const spots = stage.data?.spots ?? [];
  const spotOptions =
    scene.spot === null || spots.some((spot) => spot.id === scene.spot?.id)
      ? spots
      : [scene.spot, ...spots];

  return (
    <div className="dark flex h-full w-full flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 text-sm">
        <Link to={scenesPath(campaign.id)} className="underline">
          ← Scenes
        </Link>
        <h1 className="text-base font-semibold">{scene.name}</h1>
        {!archived && (
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              setRenaming(true);
            }}
          >
            Rename
          </Button>
        )}
        <label className="flex items-center gap-2">
          Backdrop
          <NativeSelect
            className="h-7 w-56 bg-background"
            value={scene.spot?.id ?? ''}
            disabled={archived || patch.isPending}
            onChange={(event) => {
              const spotId = event.target.value === '' ? null : event.target.value;
              patch.mutate({ sceneId: scene.id, patch: { spotId } });
            }}
          >
            <option value="">None: a bare back wall</option>
            {spotOptions.map((spot) => (
              <option key={spot.id} value={spot.id}>
                {spotLabel({ name: spot.name, parentName: spot.areaName })}
                {spot.backdrop === null ? ' (no backdrop yet)' : ''}
              </option>
            ))}
          </NativeSelect>
        </label>
        <span className="tabular-nums" aria-label="Objects placed">
          {objects.length} of {SCENE_MAX_OBJECTS} placed
        </span>
        <SaveStatus
          status={autosave.status}
          error={autosave.error}
          onRetry={() => {
            autosave.flush();
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          {/* Players never orbit, so the preview is always from their locked seat. */}
          <Button
            size="xs"
            variant={lookAround && !preview ? 'default' : 'secondary'}
            aria-pressed={lookAround && !preview}
            disabled={preview}
            title="Drag empty space to turn the theater, and scroll to zoom"
            onClick={() => {
              setLookAround((on) => !on);
            }}
          >
            Look around
          </Button>
          <Button
            size="xs"
            variant={preview ? 'default' : 'secondary'}
            aria-pressed={preview}
            onClick={() => {
              setPreview((on) => !on);
            }}
          >
            Preview
          </Button>
        </div>
      </header>

      {patch.isError && (
        <p role="alert" className="border-b px-3 py-1.5 text-sm text-destructive">
          Couldn&apos;t save that: {patch.error.message}
        </p>
      )}
      {archived && (
        <p className="border-b bg-muted px-3 py-1.5 text-sm">
          This campaign is archived, so this scene is read-only.
        </p>
      )}
      {scene.spot !== null && backdrop === null && (
        <p className="border-b px-3 py-1.5 text-sm text-muted-foreground">
          {scene.spot.name} has no backdrop yet, so the back wall is bare.{' '}
          {/* In a new tab: leaving the builder to draw a backdrop would lose the GM's place. */}
          <Link
            to={recordPath(campaign.id, scene.spot.id)}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Open {scene.spot.name}
          </Link>{' '}
          to generate one.
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {editable && (
          <SceneTray
            campaignId={campaign.id}
            spotName={scene.spot?.name ?? null}
            suggestions={scene.suggestions}
            records={trayRecords}
            objects={objects}
            onAdd={add}
          />
        )}
        <div className="relative min-w-0 flex-1 bg-black">
          <SceneBuilderCanvas
            backdropUrl={backdropUrl}
            objects={cutouts}
            selectedId={preview ? null : selectedId}
            onSelect={setSelectedId}
            editable={editable}
            lookAround={lookAround && !preview}
            guideTick={preview || selected === null ? null : selected.depthTick}
            onMove={change}
            onDropRecord={dropRecord}
          />
          {preview && (
            <p className="absolute bottom-3 left-3 max-w-md rounded-md bg-black/70 px-3 py-2 text-sm text-white">
              This is the scene as players first see it: hidden props are gone, and puppets wait
              below until you raise them.
            </p>
          )}
        </div>
        {!preview && (
          <ObjectPanel
            campaignId={campaign.id}
            objects={objects}
            selectedId={selectedId}
            editable={editable}
            onSelect={setSelectedId}
            onChange={change}
            onRemove={remove}
          />
        )}
      </div>

      <CampaignNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename scene"
        description="Only you see scene names."
        submitLabel="Save name"
        label="Scene name"
        initialName={scene.name}
        schema={sceneNameSchema}
        maxLength={SCENE_NAME_MAX}
        onSave={(name) => patch.mutateAsync({ sceneId: scene.id, patch: { name } })}
      />
    </div>
  );
}
