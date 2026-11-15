import { SCENE_NAME_MAX, sceneNameSchema, type RecordSummary } from '@stagehand/shared';
import { useState, type SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { spotLabel } from '@/lib/scenes';

interface NewSceneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The campaign's Spots, by name. */
  spots: RecordSummary[];
  /** Creates the scene. The dialog closes when it resolves and shows the error if it rejects. */
  onCreate: (scene: { name: string; spotId: string | null }) => Promise<unknown>;
}

/**
 * A new scene (F3.2, governance §12 "Scene builder" step 1): a name, and optionally the Spot
 * it starts from, which sets its backdrop and suggests what to place.
 */
export function NewSceneDialog({ open, onOpenChange, ...form }: NewSceneDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so the form starts fresh every time. */}
        <NewSceneForm
          {...form}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewSceneForm({
  spots,
  onCreate,
  onDone,
}: Omit<NewSceneDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const [name, setName] = useState('');
  const [spotId, setSpotId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function chooseSpot(id: string) {
    const before = spots.find((spot) => spot.id === spotId)?.name ?? '';
    setSpotId(id);
    // A scene is usually named after its Spot: offer that while the GM hasn't typed their own.
    if (name.trim() === '' || name === before) {
      setName(spots.find((spot) => spot.id === id)?.name ?? '');
    }
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = sceneNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onCreate({ name: parsed.data, spotId: spotId === '' ? null : spotId });
      onDone();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <DialogHeader>
        <DialogTitle>New scene</DialogTitle>
        <DialogDescription>
          Start from a Spot to get its backdrop and its props, NPCs and items, or from an empty
          theater.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="new-scene-spot">Spot</Label>
        <NativeSelect
          id="new-scene-spot"
          value={spotId}
          onChange={(event) => {
            chooseSpot(event.target.value);
          }}
        >
          <option value="">No Spot: an empty theater</option>
          {spots.map((spot) => (
            <option key={spot.id} value={spot.id}>
              {spotLabel(spot)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-scene-name">Scene name</Label>
        <Input
          id="new-scene-name"
          value={name}
          maxLength={SCENE_NAME_MAX}
          autoFocus
          aria-invalid={error !== null}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={saving}>
          Create scene
        </Button>
      </DialogFooter>
    </form>
  );
}
