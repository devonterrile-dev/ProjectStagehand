import { NOTE_BODY_MAX, wasEdited, type PlayerNote } from '@stagehand/shared';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { NoteSubjectRef } from '@/lib/api';
import { postedTime } from '@/lib/journal';
import { useCreateNote, useDeleteNote, useMe, useNotes, useUpdateNote } from '@/lib/queries';

interface NotesSectionProps {
  campaignId: string;
  subject: NoteSubjectRef;
  isGm: boolean;
  /** An archived campaign's notes can be read, not written. */
  readOnly: boolean;
}

/**
 * The notes on a revealed record or a player entry (F3.5, governance §7): a box to post one,
 * then every note, newest first. Each shows who posted it and when; its author can edit or
 * delete it, and the GM can delete any.
 */
export function NotesSection({ campaignId, subject, isGm, readOnly }: NotesSectionProps) {
  const notes = useNotes(campaignId, subject);
  const list = notes.data ?? null;
  const { data: me } = useMe();
  const create = useCreateNote(campaignId, subject);
  const [draft, setDraft] = useState('');

  const post = () => {
    create.mutate(draft, {
      onSuccess: () => {
        setDraft('');
      },
    });
  };

  return (
    <section aria-labelledby="notes-heading" className="space-y-4">
      <h2 id="notes-heading" className="text-lg font-semibold">
        Notes
      </h2>

      {!readOnly && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            post();
          }}
        >
          <Textarea
            aria-label="New note"
            placeholder="Add a note for the table"
            value={draft}
            maxLength={NOTE_BODY_MAX}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                if (draft.trim() !== '' && !create.isPending) post();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {draft.length} / {NOTE_BODY_MAX}
            </span>
            <Button type="submit" size="sm" disabled={draft.trim() === '' || create.isPending}>
              Post note
            </Button>
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {create.error.message}
            </p>
          )}
        </form>
      )}

      {notes.isPending && <p className="text-sm text-muted-foreground">Loading notes…</p>}
      {notes.isError && (
        <p role="alert" className="text-sm">
          Could not load the notes. Try again in a moment.
        </p>
      )}
      {list !== null && list.length === 0 && (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      )}
      {list !== null && list.length > 0 && (
        <ul aria-label="Notes" className="space-y-3">
          {list.map((note) => (
            <NoteItem
              key={note.id}
              campaignId={campaignId}
              note={note}
              mine={note.author.userId !== null && note.author.userId === me?.id}
              isGm={isGm}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteItem({
  campaignId,
  note,
  mine,
  isGm,
  readOnly,
}: {
  campaignId: string;
  note: PlayerNote;
  mine: boolean;
  isGm: boolean;
  readOnly: boolean;
}) {
  const update = useUpdateNote(campaignId);
  const remove = useDeleteNote(campaignId);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const save = () => {
    if (editing === null) return;
    update.mutate(
      { noteId: note.id, body: editing },
      {
        onSuccess: () => {
          setEditing(null);
        },
      },
    );
  };

  return (
    <li className="rounded-md border bg-card p-3">
      {editing === null ? (
        <p className="text-sm whitespace-pre-wrap">{note.body}</p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Textarea
            aria-label="Edit note"
            value={editing}
            maxLength={NOTE_BODY_MAX}
            autoFocus
            onChange={(event) => {
              setEditing(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(null);
              }
            }}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={editing.trim() === '' || update.isPending}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {update.isError && (
            <p role="alert" className="text-sm text-destructive">
              {update.error.message}
            </p>
          )}
        </form>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {!readOnly && editing === null && mine && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              setEditing(note.body);
            }}
          >
            Edit
          </Button>
        )}
        {!readOnly && editing === null && (mine || isGm) && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete
          </Button>
        )}
        <span>
          {note.author.displayName} ·{' '}
          <time dateTime={note.createdAt}>{postedTime(note.createdAt)}</time>
          {wasEdited(note) && ' · edited'}
        </span>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this note?"
        description={
          mine
            ? 'Your note will be gone for everyone at the table.'
            : `${note.author.displayName}’s note will be gone for everyone at the table.`
        }
        confirmLabel="Delete note"
        onConfirm={() => remove.mutateAsync(note.id)}
      />
    </li>
  );
}
