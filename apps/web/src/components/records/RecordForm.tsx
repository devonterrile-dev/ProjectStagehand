import {
  emptyRichText,
  isEmptyRichText,
  RECORD_FIELD_SPECS,
  RECORD_NAME_MAX,
  updateRecordRequestSchemaFor,
  type Campaign,
  type CampaignRecord,
  type FieldSpec,
  type RecordSummary,
  type UpdateRecordRequest,
} from '@stagehand/shared';
import { MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FieldError } from '@/components/FieldError';
import { StatBlockSelect } from '@/components/stat-blocks/StatBlockSelect';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeleteRecord, usePatchRecord, useStatBlocks } from '@/lib/queries';
import { RecordMentionsContext, type RecordMentions } from '@/lib/record-mentions';
import { useRecordNavigation } from '@/lib/record-navigation';
import { mergeRecordPatch, useAutosave, type SendPatch } from '@/lib/useAutosave';

import { AreaSelect } from './AreaSelect';
import { FieldInput } from './FieldInput';
import { LinkFieldInput, type LinkedRecord } from './LinkFieldInput';
import { OtherLinksEditor, type OtherLinkRow } from './OtherLinksEditor';
import { RichTextEditor } from './RichTextEditor';
import { SaveStatus } from './SaveStatus';
import { TagInput } from './TagInput';

interface RecordFormProps {
  campaign: Campaign;
  /** The record as last saved. Render with `key={record.id}` so a new record gets a new form. */
  record: CampaignRecord;
  /** Every record summary in the campaign: the Area select, link pickers and @-mentions. */
  records: RecordSummary[];
  onDeleted: () => void;
}

/** Keys that live on the record itself; everything else is inside `fields`. */
const TOP_LEVEL = new Set<string>([
  'name',
  'publicDescription',
  'gmNotes',
  'tags',
  'parentId',
  'statBlockId',
]);

/** The ids of a link list, for the request and for comparing with what's saved. */
const idsOf = (list: readonly { id: string }[]) => list.map((item) => item.id);

/** Other links as the request sends them: a blank relationship is null. */
const otherLinksBody = (rows: readonly OtherLinkRow[]) =>
  rows.map((row) => ({ recordId: row.id, label: row.label.trim() === '' ? null : row.label }));

/**
 * The whole record, autosaving field by field (D-22). The inputs keep their own text after
 * the first render, so a save landing in the cache never overwrites what the GM is typing.
 * Link fields, other links and @-mentions (D-24) save the same way.
 */
export function RecordForm({ campaign, record, records, onDeleted }: RecordFormProps) {
  const { mutateAsync: sendPatch } = usePatchRecord(campaign.id, record.id);
  const del = useDeleteRecord(campaign.id);
  const send = useCallback<SendPatch>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send, { merge: mergeRecordPatch });
  const navigation = useRecordNavigation();
  const { settle } = autosave;
  // "Open" on a linked record waits for this form's saves first.
  useEffect(() => navigation.register(settle), [navigation, settle]);

  const readOnly = campaign.archivedAt !== null;
  const [name, setName] = useState(record.name);
  const [tags, setTags] = useState(record.tags);
  const [parentId, setParentId] = useState(record.parentId ?? '');
  const [statBlockId, setStatBlockId] = useState(record.statBlockId ?? '');
  const { data: statBlocks } = useStatBlocks(campaign.id, record.type === 'npc');
  const [links, setLinks] = useState<Record<string, LinkedRecord[]>>(record.links);
  const [otherLinks, setOtherLinks] = useState<OtherLinkRow[]>(() =>
    record.otherLinks.map((link) => ({ ...link.record, label: link.label ?? '' })),
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [deleting, setDeleting] = useState(false);

  const fields = record.fields as Record<string, unknown>;
  const spec = RECORD_FIELD_SPECS[record.type] as Record<string, FieldSpec>;

  const mentions = useMemo<RecordMentions>(
    () => ({
      campaignId: campaign.id,
      selfId: record.id,
      records,
      byId: new Map(records.map((summary) => [summary.id, summary])),
    }),
    [campaign.id, record.id, records],
  );
  /** A linked record under its current name (it may have been renamed since it was linked). */
  const current = (linked: LinkedRecord): LinkedRecord => ({
    id: linked.id,
    name: mentions.byId.get(linked.id)?.name ?? linked.name,
  });

  /** Validates one field's new value and queues it, unless it already matches what's saved. */
  function commit(key: string, value: unknown, now = false) {
    const body: Record<string, unknown> = TOP_LEVEL.has(key)
      ? { [key]: value }
      : { fields: { [key]: value } };
    const parsed = updateRecordRequestSchemaFor(record.type).safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid value';
      setErrors((current) => ({ ...current, [key]: message }));
      return;
    }
    setErrors((current) =>
      (current[key] ?? null) === null ? current : { ...current, [key]: null },
    );

    const saved = TOP_LEVEL.has(key) ? record[key as keyof CampaignRecord] : fields[key];
    const sent = TOP_LEVEL.has(key)
      ? parsed.data[key as keyof UpdateRecordRequest]
      : parsed.data.fields?.[key];
    if (JSON.stringify(sent ?? null) === JSON.stringify(saved ?? null) && !autosave.isDirty()) {
      return;
    }
    autosave.save(parsed.data);
    if (now) autosave.flush();
  }

  /** Queues a validated body, or shows its first issue under `errorKey`. */
  function queue(errorKey: string, body: UpdateRecordRequest, unchanged: boolean, now: boolean) {
    const parsed = updateRecordRequestSchemaFor(record.type).safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid value';
      setErrors((existing) => ({ ...existing, [errorKey]: message }));
      return;
    }
    setErrors((existing) =>
      (existing[errorKey] ?? null) === null ? existing : { ...existing, [errorKey]: null },
    );
    if (unchanged && !autosave.isDirty()) return;
    autosave.save(parsed.data);
    if (now) autosave.flush();
  }

  /** A link field's whole list, saved at once. */
  function commitLinks(key: string, next: LinkedRecord[]) {
    setLinks((existing) => ({ ...existing, [key]: next }));
    const ids = idsOf(next);
    const saved = idsOf(record.links[key] ?? []);
    queue(
      `links.${key}`,
      { links: { [key]: ids } },
      JSON.stringify(ids) === JSON.stringify(saved),
      true,
    );
  }

  /** The whole list of other links: at once for adds and removes, debounced for labels. */
  function commitOtherLinks(next: OtherLinkRow[], now: boolean) {
    setOtherLinks(next);
    const body = otherLinksBody(next);
    const saved = record.otherLinks.map((link) => ({
      recordId: link.record.id,
      label: link.label,
    }));
    queue('otherLinks', { otherLinks: body }, JSON.stringify(body) === JSON.stringify(saved), now);
  }

  const errorOf = (key: string) => errors[key] ?? null;

  return (
    <RecordMentionsContext.Provider value={mentions}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <Input
              id="record-name"
              aria-label="Name"
              className="text-lg font-semibold md:text-lg"
              value={name}
              maxLength={RECORD_NAME_MAX}
              disabled={readOnly}
              aria-invalid={errorOf('name') !== null}
              onChange={(event) => {
                setName(event.target.value);
                commit('name', event.target.value);
              }}
              onBlur={autosave.flush}
            />
            <FieldError message={errorOf('name')} />
          </div>
          <div className="flex items-center gap-2">
            <SaveStatus status={autosave.status} error={autosave.error} onRetry={autosave.flush} />
            {!readOnly && (
              // Non-modal so the confirm dialog it opens can take focus cleanly.
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Record settings">
                    <MoreHorizontalIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      setDeleting(true);
                    }}
                  >
                    <Trash2Icon aria-hidden />
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {record.type === 'spot' && (
          <div className="space-y-2">
            <Label htmlFor="record-area">Area</Label>
            <AreaSelect
              id="record-area"
              areas={records.filter((summary) => summary.type === 'area')}
              value={parentId}
              disabled={readOnly}
              onChange={(areaId) => {
                setParentId(areaId);
                commit('parentId', areaId, true);
              }}
            />
            <FieldError message={errorOf('parentId')} />
          </div>
        )}

        {record.type === 'npc' && (
          <div className="space-y-2">
            <StatBlockSelect
              campaignId={campaign.id}
              statBlocks={statBlocks ?? []}
              value={statBlockId}
              disabled={readOnly}
              onChange={(id) => {
                setStatBlockId(id ?? '');
                commit('statBlockId', id, true);
              }}
            />
            <FieldError message={errorOf('statBlockId')} />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="record-tags">Tags</Label>
          <TagInput
            id="record-tags"
            value={tags}
            disabled={readOnly}
            onChange={(next) => {
              setTags(next);
              commit('tags', next, true);
            }}
          />
          <FieldError message={errorOf('tags')} />
        </div>

        <div className="space-y-2">
          <Label>Public description</Label>
          <p className="text-xs text-muted-foreground">
            What players see once the record is revealed. Everything below stays private.
          </p>
          <RichTextEditor
            id="record-public-description"
            label="Public description"
            value={record.publicDescription}
            editable={!readOnly}
            onChange={(doc) => {
              commit('publicDescription', isEmptyRichText(doc) ? emptyRichText() : doc);
            }}
            onBlur={autosave.flush}
          />
          <FieldError message={errorOf('publicDescription')} />
        </div>

        {Object.entries(spec).map(([key, fieldSpec]) =>
          fieldSpec.kind === 'links' ? (
            <LinkFieldInput
              key={key}
              id={`link-${key}`}
              spec={fieldSpec}
              value={(links[key] ?? []).map(current)}
              records={records}
              selfId={record.id}
              disabled={readOnly}
              error={errorOf(`links.${key}`)}
              onChange={(next) => {
                commitLinks(key, next);
              }}
            />
          ) : (
            <FieldInput
              key={key}
              id={`field-${key}`}
              spec={fieldSpec}
              initial={fields[key]}
              disabled={readOnly}
              error={errorOf(key)}
              onCommit={(value, now) => {
                commit(key, value, now);
              }}
              onBlur={autosave.flush}
            />
          ),
        )}

        <div className="space-y-2">
          <Label>GM notes</Label>
          <RichTextEditor
            id="record-gm-notes"
            label="GM notes"
            value={record.gmNotes}
            editable={!readOnly}
            onChange={(doc) => {
              commit('gmNotes', isEmptyRichText(doc) ? emptyRichText() : doc);
            }}
            onBlur={autosave.flush}
          />
          <FieldError message={errorOf('gmNotes')} />
        </div>

        <OtherLinksEditor
          value={otherLinks.map((row) => ({ ...row, ...current(row) }))}
          records={records}
          selfId={record.id}
          disabled={readOnly}
          error={errorOf('otherLinks')}
          onChange={commitOtherLinks}
          onBlur={autosave.flush}
        />

        {deleting && (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setDeleting(false);
            }}
            title={`Delete ${record.name}?`}
            description="This can't be undone. Links to it from other records will be removed too."
            confirmLabel="Delete"
            onConfirm={async () => {
              autosave.discard();
              await del.mutateAsync(record.id);
              onDeleted();
            }}
          />
        )}
      </div>
    </RecordMentionsContext.Provider>
  );
}
