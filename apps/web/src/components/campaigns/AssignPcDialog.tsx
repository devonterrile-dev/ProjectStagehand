import { characterNameSchema, type Member } from '@stagehand/shared';
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
import { useAssignCharacter, useCharacters, useCreateCharacter } from '@/lib/queries';

const NONE = '';
const NEW = 'new';

interface AssignPcDialogProps {
  campaignId: string;
  /** The player getting a PC. */
  player: Member;
  /** Everyone in the campaign, to say whose PC would move. */
  members: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** GM: give a player an existing PC (moving it if someone else had it), a new one, or none. */
export function AssignPcDialog({ open, onOpenChange, ...props }: AssignPcDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so the form starts fresh every time. */}
        <AssignPcForm
          {...props}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function AssignPcForm({
  campaignId,
  player,
  members,
  onDone,
}: Omit<AssignPcDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const { data: characters, isPending } = useCharacters(campaignId, true);
  const assign = useAssignCharacter(campaignId);
  const create = useCreateCharacter(campaignId);
  const [choice, setChoice] = useState<string>(player.character?.id ?? NEW);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saving = assign.isPending || create.isPending;

  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.displayName;

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (choice === NEW) {
        const parsed = characterNameSchema.safeParse(name);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Invalid character name');
          return;
        }
        await create.mutateAsync({ name: parsed.data, assignToUserId: player.userId });
      } else {
        await assign.mutateAsync({
          userId: player.userId,
          characterId: choice === NONE ? null : choice,
        });
      }
      onDone();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Something went wrong');
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <DialogHeader>
        <DialogTitle>PC for {player.displayName}</DialogTitle>
        <DialogDescription>
          Each player has one PC. Character sheets arrive in a later update.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="pc-choice">Character</Label>
        <select
          id="pc-choice"
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          value={choice}
          disabled={isPending}
          onChange={(event) => {
            setChoice(event.target.value);
          }}
        >
          <option value={NEW}>New PC…</option>
          {characters?.map((character) => {
            const holder =
              character.assignedToUserId !== null && character.assignedToUserId !== player.userId
                ? nameOf(character.assignedToUserId)
                : undefined;
            return (
              <option key={character.id} value={character.id}>
                {character.name}
                {holder === undefined ? '' : ` (moves from ${holder})`}
              </option>
            );
          })}
          <option value={NONE}>No PC</option>
        </select>
      </div>

      {choice === NEW && (
        <div className="space-y-2">
          <Label htmlFor="pc-name">New PC name</Label>
          <Input
            id="pc-name"
            value={name}
            maxLength={80}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="submit" disabled={saving}>
          Save PC
        </Button>
      </DialogFooter>
    </form>
  );
}
