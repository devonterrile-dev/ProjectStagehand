import { LIKELY_NEXT_MAX, type Scene } from '@stagehand/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { usePatchScene, useScenes } from '@/lib/queries';

interface LikelyNextDialogProps {
  campaignId: string;
  scene: Scene;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An archived campaign: the list shows, but can't be changed. */
  readOnly: boolean;
}

/**
 * A scene's likely next scenes (F5.2, 19.28): the scenes it probably leads to, in order, which
 * the desk lists first while it is loaded. Up to 6, any of the campaign's scenes but itself.
 * Each change saves the whole list at once.
 */
export function LikelyNextDialog({
  campaignId,
  scene,
  open,
  onOpenChange,
  readOnly,
}: LikelyNextDialogProps) {
  const scenes = useScenes(campaignId, open);
  const patch = usePatchScene(campaignId);
  const listed = scene.nextScenes;
  const ids = listed.map((next) => next.id);
  const full = listed.length >= LIKELY_NEXT_MAX;
  const offered = (scenes.data ?? []).filter(
    (candidate) => candidate.id !== scene.id && !ids.includes(candidate.id),
  );
  const locked = readOnly || patch.isPending;

  function save(nextSceneIds: string[]) {
    patch.mutate({ sceneId: scene.id, patch: { nextSceneIds } });
  }

  /** The list with the scene at `index` moved by `by` places. */
  function moved(index: number, by: -1 | 1): string[] {
    const next = [...ids];
    const [taken] = next.splice(index, 1);
    if (taken !== undefined) next.splice(index + by, 0, taken);
    return next;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Likely next scenes</DialogTitle>
          <DialogDescription>
            The scenes {scene.name} probably leads to. While it is loaded, the desk lists them
            first, in this order.
          </DialogDescription>
        </DialogHeader>

        {listed.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ol aria-label="Likely next scenes" className="space-y-1.5">
            {listed.map((next, index) => (
              <li key={next.id} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-right text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate">{next.name}</span>
                {!readOnly && (
                  <>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={locked || index === 0}
                      aria-label={`Move ${next.name} up`}
                      onClick={() => {
                        save(moved(index, -1));
                      }}
                    >
                      Up
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={locked || index === listed.length - 1}
                      aria-label={`Move ${next.name} down`}
                      onClick={() => {
                        save(moved(index, 1));
                      }}
                    >
                      Down
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={locked}
                      aria-label={`Remove ${next.name}`}
                      onClick={() => {
                        save(ids.filter((id) => id !== next.id));
                      }}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}

        {!readOnly && (
          <label className="block space-y-1 text-sm">
            <span className="block text-muted-foreground">Add a scene</span>
            <NativeSelect
              className="w-full"
              value=""
              disabled={locked || full || offered.length === 0}
              onChange={(event) => {
                if (event.target.value !== '') save([...ids, event.target.value]);
              }}
            >
              <option value="">
                {full
                  ? `${String(LIKELY_NEXT_MAX)} of ${String(LIKELY_NEXT_MAX)}: remove one to add another`
                  : offered.length === 0
                    ? 'No other scenes to add'
                    : 'Choose a scene…'}
              </option>
              {offered.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}

        {patch.isError && (
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t save that: {patch.error.message}
          </p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">
            {listed.length} of {LIKELY_NEXT_MAX}
          </span>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
