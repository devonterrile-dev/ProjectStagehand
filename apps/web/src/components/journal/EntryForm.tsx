import {
  createEntryRequestSchema,
  ENTRY_DESCRIPTION_MAX,
  ENTRY_TITLE_MAX,
  type CreateEntryRequest,
} from '@stagehand/shared';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface EntryFormProps {
  initial?: CreateEntryRequest;
  submitLabel: string;
  busy: boolean;
  /** The server's refusal, if any. */
  error: string | null;
  onSubmit: (entry: CreateEntryRequest) => void;
  onCancel: () => void;
}

/** A player entry's title and description (F3.5): plain text, line breaks kept. */
export function EntryForm({
  initial = { title: '', description: '' },
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: EntryFormProps) {
  const ids = useId();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [invalid, setInvalid] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = createEntryRequestSchema.safeParse({ title, description });
        if (!parsed.success) {
          setInvalid(parsed.error.issues[0]?.message ?? 'Check the entry');
          return;
        }
        setInvalid(null);
        onSubmit(parsed.data);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${ids}-title`}>Title</Label>
        <Input
          id={`${ids}-title`}
          value={title}
          maxLength={ENTRY_TITLE_MAX}
          autoFocus
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${ids}-description`}>Description</Label>
        <Textarea
          id={`${ids}-description`}
          className="min-h-32"
          value={description}
          maxLength={ENTRY_DESCRIPTION_MAX}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>
      {(invalid ?? error) !== null && (
        <p role="alert" className="text-sm text-destructive">
          {invalid ?? error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || title.trim() === ''}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** "New entry": a player's own simple record, shared with the whole table. */
export function NewEntryDialog({
  open,
  onOpenChange,
  busy,
  error,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: string | null;
  onCreate: (entry: CreateEntryRequest) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New entry</DialogTitle>
          <DialogDescription>
            A title and a description. Everyone in the campaign can read it and add notes.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the form starts fresh every time. */}
        {open && (
          <EntryForm
            submitLabel="Create entry"
            busy={busy}
            error={error}
            onSubmit={onCreate}
            onCancel={() => {
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
