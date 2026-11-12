import {
  createProposalPayloadSchema,
  emptyRichText,
  isEmptyRichText,
  LINK_LABEL_MAX,
  linkProposalPayloadSchema,
  RECORD_NAME_MAX,
  updateProposalPayloadSchema,
  type CreateProposalPayload,
  type LinkProposalPayload,
  type RichText,
  type UpdateProposalPayload,
} from '@stagehand/shared';
import { useId, useMemo, useState, type ReactNode } from 'react';

import { FieldError } from '@/components/FieldError';
import { AreaSelect } from '@/components/records/AreaSelect';
import { FieldInput } from '@/components/records/FieldInput';
import { RichTextEditor } from '@/components/records/RichTextEditor';
import { TagInput } from '@/components/records/TagInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  changedFieldSpecs,
  specsOf,
  withKey,
  type CreateProposal,
  type LinkProposal,
  type UpdateProposal,
} from '@/lib/ai-import';
import { RecordMentionsContext, type RecordMentions } from '@/lib/record-mentions';

import { RefChip } from './ProposalParts';
import { useReview } from './review-context';

interface EditorProps<P> {
  /** Sends the whole payload; the card closes the editor once it is saved. */
  onSave: (payload: P) => void;
  onCancel: () => void;
  saving: boolean;
}

const noop = () => undefined;

/** Rich text as a proposal stores it: an empty document is the empty document. */
const tidy = (doc: RichText) => (isEmptyRichText(doc) ? emptyRichText() : doc);

/** Mentions inside the editors: existing records may be mentioned; proposed ones are named. */
function MentionsFor({ selfId, children }: { selfId: string; children: ReactNode }) {
  const { campaignId, records, byId } = useReview();
  const mentions = useMemo<RecordMentions>(
    () => ({ campaignId, selfId, records, byId }),
    [campaignId, selfId, records, byId],
  );
  return (
    <RecordMentionsContext.Provider value={mentions}>{children}</RecordMentionsContext.Provider>
  );
}

/** Save and Cancel, with the first problem of the draft above them. */
function EditorFooter({
  problem,
  saving,
  onSave,
  onCancel,
}: {
  problem: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 border-t pt-3">
      <FieldError message={problem} />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save and accept'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The part of a Zod schema the editors use. */
interface PayloadSchema<P> {
  safeParse: (
    value: unknown,
  ) =>
    | { success: true; data: P }
    | { success: false; error: { issues: readonly { message: string }[] } };
}

/** Checks a draft with the payload schema the server uses; the first problem, or the payload. */
function useChecked<P>(schema: PayloadSchema<P>) {
  const [problem, setProblem] = useState<string | null>(null);
  const check = (draft: unknown): P | null => {
    const parsed = schema.safeParse(draft);
    if (parsed.success) {
      setProblem(null);
      return parsed.data;
    }
    setProblem(parsed.error.issues[0]?.message ?? 'Check the changes');
    return null;
  };
  return { problem, check };
}

/** Every field of a proposed record, editable; its links can only be removed. */
export function CreateProposalEditor({
  proposal,
  onSave,
  onCancel,
  saving,
}: EditorProps<CreateProposalPayload> & { proposal: CreateProposal }) {
  const id = useId();
  const { areas } = useReview();
  const [draft, setDraft] = useState<CreateProposalPayload>(proposal.payload);
  const { problem, check } = useChecked(createProposalPayloadSchema);
  const set = (patch: Partial<CreateProposalPayload>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setField = (key: string, value: unknown) => {
    setDraft((current) => ({ ...current, fields: withKey(current.fields, key, value) }));
  };

  return (
    <MentionsFor selfId={draft.id}>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={draft.name}
            maxLength={RECORD_NAME_MAX}
            onChange={(event) => {
              set({ name: event.target.value });
            }}
          />
        </div>
        {draft.type === 'spot' && (
          <div className="space-y-2">
            <Label htmlFor={`${id}-area`}>Area</Label>
            <AreaSelect
              id={`${id}-area`}
              areas={areas}
              value={draft.parentId ?? ''}
              onChange={(areaId) => {
                set({ parentId: areaId === '' ? null : areaId });
              }}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={`${id}-tags`}>Tags</Label>
          <TagInput
            id={`${id}-tags`}
            value={draft.tags}
            disabled={false}
            onChange={(tags) => {
              set({ tags });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>Public description</Label>
          <RichTextEditor
            id={`${id}-public`}
            label="Public description"
            value={proposal.payload.publicDescription}
            editable
            onChange={(doc) => {
              set({ publicDescription: tidy(doc) });
            }}
          />
        </div>
        {specsOf(draft.type).map(([key, spec]) => {
          if (spec.kind !== 'links') {
            return (
              <FieldInput
                key={key}
                id={`${id}-field-${key}`}
                spec={spec}
                initial={proposal.payload.fields[key]}
                disabled={false}
                error={null}
                onCommit={(value) => {
                  setField(key, value);
                }}
                onBlur={noop}
              />
            );
          }
          const ids = draft.links[key] ?? [];
          if ((proposal.payload.links[key] ?? []).length === 0) return null;
          return (
            <div key={key} className="space-y-2">
              <p className="text-sm font-medium">{spec.label}</p>
              {ids.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">All removed</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {ids.map((linked) => (
                    <RefChip
                      key={linked}
                      id={linked}
                      onRemove={() => {
                        set({
                          links: { ...draft.links, [key]: ids.filter((other) => other !== linked) },
                        });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div className="space-y-2">
          <Label>GM notes</Label>
          <RichTextEditor
            id={`${id}-gm`}
            label="GM notes"
            value={proposal.payload.gmNotes}
            editable
            onChange={(doc) => {
              set({ gmNotes: tidy(doc) });
            }}
          />
        </div>
        {proposal.payload.otherLinks.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Other links</p>
            {draft.otherLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">All removed</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {draft.otherLinks.map((link) => (
                  <RefChip
                    key={link.recordId}
                    id={link.recordId}
                    suffix={link.label}
                    onRemove={() => {
                      set({
                        otherLinks: draft.otherLinks.filter((o) => o.recordId !== link.recordId),
                      });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <EditorFooter
          problem={problem}
          saving={saving}
          onCancel={onCancel}
          onSave={() => {
            const payload = check(draft);
            if (payload !== null) onSave(payload);
          }}
        />
      </div>
    </MentionsFor>
  );
}

type UpdateKey = 'name' | 'publicDescription' | 'gmNotes' | 'addTags';

/**
 * The changes of an update, each rewordable or droppable. A change can't be added, and an
 * emptied value drops the change (an update never clears anything).
 */
export function UpdateProposalEditor({
  proposal,
  onSave,
  onCancel,
  saving,
}: EditorProps<UpdateProposalPayload> & { proposal: UpdateProposal }) {
  const id = useId();
  const original = proposal.payload;
  const [draft, setDraft] = useState<UpdateProposalPayload>(original);
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const { problem, check } = useChecked(updateProposalPayloadSchema);

  const setTop = (key: UpdateKey, value: UpdateProposalPayload[UpdateKey] | undefined) => {
    setDraft((current) => withKey(current, key, value));
  };
  const setField = (key: string, value: unknown) => {
    setDraft((current) => {
      const fields = withKey(current.fields ?? {}, key, value);
      return withKey(current, 'fields', Object.keys(fields).length === 0 ? null : fields);
    });
  };
  const drop = (key: string, field: boolean) => {
    setDropped((current) => new Set([...current, key]));
    if (field) setField(key, null);
    else setTop(key as UpdateKey, undefined);
  };
  const shown = (key: string) => !dropped.has(key);
  const dropButton = (key: string, field = false) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => {
        drop(key, field);
      }}
    >
      Drop this change
    </Button>
  );
  const row = (key: string, label: string, input: ReactNode, field = false) =>
    shown(key) && (
      <div key={key} className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{label}</p>
          {dropButton(key, field)}
        </div>
        {input}
      </div>
    );

  return (
    <MentionsFor selfId={original.recordId}>
      <div className="space-y-3">
        {original.name !== undefined &&
          row(
            'name',
            'Name',
            <Input
              aria-label="New name"
              value={draft.name ?? ''}
              maxLength={RECORD_NAME_MAX}
              onChange={(event) => {
                setTop('name', event.target.value === '' ? undefined : event.target.value);
              }}
            />,
          )}
        {original.publicDescription !== undefined &&
          row(
            'publicDescription',
            'Public description',
            <RichTextEditor
              id={`${id}-public`}
              label="New public description"
              value={original.publicDescription}
              editable
              onChange={(doc) => {
                setTop('publicDescription', isEmptyRichText(doc) ? undefined : doc);
              }}
            />,
          )}
        {changedFieldSpecs(proposal).map(([key, spec]) =>
          row(
            key,
            spec.label,
            <FieldInput
              id={`${id}-field-${key}`}
              spec={{ ...spec, label: `New ${spec.label.toLowerCase()}` }}
              initial={original.fields?.[key]}
              disabled={false}
              error={null}
              onCommit={(value) => {
                setField(key, value);
              }}
              onBlur={noop}
            />,
            true,
          ),
        )}
        {original.gmNotes !== undefined &&
          row(
            'gmNotes',
            'GM notes',
            <RichTextEditor
              id={`${id}-gm`}
              label="New GM notes"
              value={original.gmNotes}
              editable
              onChange={(doc) => {
                setTop('gmNotes', isEmptyRichText(doc) ? undefined : doc);
              }}
            />,
          )}
        {original.addTags !== undefined &&
          row(
            'addTags',
            'Tags to add',
            <TagInput
              id={`${id}-tags`}
              value={draft.addTags ?? []}
              disabled={false}
              onChange={(tags) => {
                setTop('addTags', tags.length === 0 ? undefined : tags);
              }}
            />,
          )}
        <EditorFooter
          problem={problem}
          saving={saving}
          onCancel={onCancel}
          onSave={() => {
            const payload = check(draft);
            if (payload !== null) onSave(payload);
          }}
        />
      </div>
    </MentionsFor>
  );
}

/** A free-form link's relationship, the only part of a link that can be edited. */
export function LinkProposalEditor({
  proposal,
  onSave,
  onCancel,
  saving,
}: EditorProps<LinkProposalPayload> & { proposal: LinkProposal }) {
  const id = useId();
  const [label, setLabel] = useState(proposal.payload.label ?? '');
  const { problem, check } = useChecked(linkProposalPayloadSchema);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-label`}>Relationship</Label>
        <Input
          id={`${id}-label`}
          value={label}
          placeholder="e.g. rival of"
          maxLength={LINK_LABEL_MAX}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
        />
      </div>
      <EditorFooter
        problem={problem}
        saving={saving}
        onCancel={onCancel}
        onSave={() => {
          const trimmed = label.trim();
          const payload = check({ ...proposal.payload, label: trimmed === '' ? null : trimmed });
          if (payload !== null) onSave(payload);
        }}
      />
    </div>
  );
}
