import { VISUAL_COST_ESTIMATE_USD, type AssetKind } from '@stagehand/shared';
import { useId, useState, type SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatUsd } from '@/lib/ai-import';

/** The two ways an NPC can be drawn (D-42). */
const CHOICES: { kind: AssetKind; label: string; help: string }[] = [
  {
    kind: 'character',
    label: 'Humanoid',
    help: 'A person: human, elf, gnome, robot. Drawn as a cute chibi character puppet.',
  },
  {
    kind: 'monster',
    label: 'Monster',
    help: 'A creature or beast: troll, spider, dragon. Drawn with the monster style.',
  },
];

interface VisualKindDialogProps {
  name: string;
  /** The choice it opens on: the kind of the last try, or humanoid. */
  initial: AssetKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (kind: AssetKind) => void;
}

/** Asked before an NPC's image is made: humanoid or monster (F2.3). */
export function VisualKindDialog({ open, onOpenChange, ...props }: VisualKindDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so it starts on `initial` every time. */}
        <KindForm
          {...props}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function KindForm({
  name,
  initial,
  onChoose,
  onCancel,
}: Omit<VisualKindDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const id = useId();
  const [kind, setKind] = useState<AssetKind>(initial);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onChoose(kind);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Is {name} a humanoid or a monster?</DialogTitle>
        <DialogDescription>
          This picks the drawing style and the reference pictures sent with the request. About{' '}
          {formatUsd(VISUAL_COST_ESTIMATE_USD[kind])} on your OpenRouter key.
        </DialogDescription>
      </DialogHeader>
      <fieldset className="space-y-2">
        <legend className="sr-only">Drawn as</legend>
        {CHOICES.map((choice) => (
          <label key={choice.kind} className="flex items-start gap-3 rounded-md border p-3">
            <input
              type="radio"
              name={`${id}-kind`}
              value={choice.kind}
              className="mt-1"
              checked={kind === choice.kind}
              onChange={() => {
                setKind(choice.kind);
              }}
            />
            <span className="space-y-1">
              <span className="block font-medium">{choice.label}</span>
              <span className="block text-sm text-muted-foreground">{choice.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Generate</Button>
      </DialogFooter>
    </form>
  );
}
