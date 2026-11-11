import {
  emptyRichText,
  isEmptyRichText,
  MOTIVES_MAX,
  SHEET_LIST_MAX,
  SHORT_TEXT_MAX,
  STAT_BLOCK_NAME_MAX,
  updateStatBlockRequestSchema,
  type Ability,
  type Attack,
  type Campaign,
  type Experience,
  type StatBlock,
  type UpdateStatBlockRequest,
} from '@stagehand/shared';
import { MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FieldError } from '@/components/FieldError';
import { RichTextEditor } from '@/components/records/RichTextEditor';
import { SaveStatus } from '@/components/records/SaveStatus';
import { AddButton, Group, SectionBox } from '@/components/sheets/layout';
import { ListEditor } from '@/components/sheets/ListEditor';
import { NumberField } from '@/components/sheets/NumberField';
import {
  AbilityFields,
  AttackFields,
  ExperienceFields,
  MotiveField,
} from '@/components/sheets/parts';
import { blank, hasName } from '@/components/sheets/rows';
import { TextField } from '@/components/sheets/TextField';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeleteStatBlock, usePatchStatBlock } from '@/lib/queries';
import { recordPath } from '@/lib/records';
import { useAutosave, type SendPatch } from '@/lib/useAutosave';

type Key = keyof UpdateStatBlockRequest;
type NumberKey =
  | 'tier'
  | 'difficulty'
  | 'attackModifier'
  | 'majorThreshold'
  | 'severeThreshold'
  | 'hpMax'
  | 'stressMax';

interface StatBlockFormProps {
  campaign: Campaign;
  /** The stat block as last saved. Render with `key={statBlock.id}`. */
  statBlock: StatBlock;
  onDeleted: () => void;
}

/**
 * The GM's editor for a stat block (governance §8), autosaving key by key. Each key
 * replaces its whole value (D-23). A stat block is a template: HP and Stress max only.
 */
export function StatBlockForm({ campaign, statBlock, onDeleted }: StatBlockFormProps) {
  const { mutateAsync: sendPatch } = usePatchStatBlock(campaign.id, statBlock.id);
  const del = useDeleteStatBlock(campaign.id);
  const send = useCallback<SendPatch<UpdateStatBlockRequest>>(
    (patch, { keepalive }) => sendPatch({ patch, keepalive }),
    [sendPatch],
  );
  const autosave = useAutosave(send);
  const readOnly = campaign.archivedAt !== null;

  /** The last valid value of every key, saved or queued. */
  const committed = useRef<StatBlock>(statBlock);
  const [errors, setErrors] = useState<Partial<Record<Key, string | undefined>>>({});
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(statBlock.name);
  const [attack, setAttack] = useState<Attack | null>(statBlock.standardAttack);

  function setError(key: Key, message: string | null) {
    setErrors((current) =>
      (current[key] ?? null) === message ? current : { ...current, [key]: message ?? undefined },
    );
  }

  function commit(key: Key, value: unknown, now = false) {
    const parsed = updateStatBlockRequestSchema.safeParse({ [key]: value });
    if (!parsed.success) {
      setError(key, parsed.error.issues[0]?.message ?? 'Invalid value');
      return;
    }
    setError(key, null);
    const next = parsed.data[key];
    const unchanged = JSON.stringify(next) === JSON.stringify(committed.current[key]);
    committed.current = { ...committed.current, [key]: next };
    if (unchanged) return;
    autosave.save(parsed.data);
    if (now) autosave.flush();
  }

  const number = (key: NumberKey, label: string, min = 0) => (
    <NumberField
      id={`stat-${key}`}
      label={label}
      initial={statBlock[key]}
      min={min}
      disabled={readOnly}
      error={errors[key] ?? null}
      onCommit={(value) => {
        if (value === null) setError(key, 'Enter a whole number');
        else commit(key, value);
      }}
      onBlur={autosave.flush}
    />
  );

  const usedBy = statBlock.usedBy;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-1">
          <Input
            id="stat-name"
            aria-label="Stat block name"
            className="text-lg font-semibold md:text-lg"
            value={name}
            maxLength={STAT_BLOCK_NAME_MAX}
            disabled={readOnly}
            aria-invalid={errors.name !== undefined}
            onChange={(event) => {
              setName(event.target.value);
              commit('name', event.target.value);
            }}
            onBlur={autosave.flush}
          />
          <FieldError message={errors.name ?? null} />
        </div>
        <div className="flex items-center gap-2">
          <SaveStatus status={autosave.status} error={autosave.error} onRetry={autosave.flush} />
          {!readOnly && (
            // Non-modal so the confirm dialog it opens can take focus cleanly.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Stat block settings">
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

      <Group title="Identity">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          {number('tier', 'Tier', 1)}
          <TextField
            id="stat-role"
            label="Role"
            initial={statBlock.role}
            maxLength={SHORT_TEXT_MAX}
            disabled={readOnly}
            error={errors.role ?? null}
            onCommit={(value) => {
              commit('role', value);
            }}
            onBlur={autosave.flush}
          />
        </div>
        <div className="space-y-2">
          <Label>Public description</Label>
          <RichTextEditor
            id="stat-public-description"
            label="Public description"
            value={statBlock.publicDescription}
            editable={!readOnly}
            onChange={(doc) => {
              commit('publicDescription', isEmptyRichText(doc) ? emptyRichText() : doc);
            }}
            onBlur={autosave.flush}
          />
          <FieldError message={errors.publicDescription ?? null} />
        </div>
      </Group>

      <Group title="Core">
        <div className="grid grid-cols-2 gap-4">
          {number('difficulty', 'Difficulty')}
          {number('attackModifier', 'Attack modifier', -99)}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Standard attack</h3>
          {attack === null ? (
            <AddButton
              label="Add standard attack"
              disabled={readOnly}
              onClick={() => {
                setAttack(blank.attack());
              }}
            />
          ) : (
            <SectionBox
              removeLabel="Remove standard attack"
              disabled={readOnly}
              waiting={!hasName(attack)}
              onRemove={() => {
                setAttack(null);
                commit('standardAttack', null, true);
              }}
            >
              <AttackFields
                label="Standard attack"
                value={attack}
                disabled={readOnly}
                onBlur={autosave.flush}
                set={(next) => {
                  setAttack(next);
                  if (hasName(next)) commit('standardAttack', next);
                }}
              />
            </SectionBox>
          )}
          <FieldError message={errors.standardAttack ?? null} />
        </div>
      </Group>

      <Group title="Experiences">
        <ListEditor<Experience>
          id="stat-experiences"
          itemLabel="Experience"
          value={statBlock.experiences}
          empty={blank.experience}
          isComplete={hasName}
          max={SHEET_LIST_MAX}
          disabled={readOnly}
          emptyText="No experiences yet."
          renderRow={(row, set, index) => (
            <ExperienceFields
              label={`Experience ${String(index + 1)}`}
              value={row}
              set={set}
              disabled={readOnly}
              onBlur={autosave.flush}
            />
          )}
          onChange={(rows, now) => {
            commit('experiences', rows, now);
          }}
        />
        <FieldError message={errors.experiences ?? null} />
      </Group>

      <Group title="Motives and tactics">
        <ListEditor<string>
          id="stat-motives"
          itemLabel="Motive"
          value={statBlock.motives}
          empty={() => ''}
          isComplete={(motive) => motive.trim() !== ''}
          max={MOTIVES_MAX}
          disabled={readOnly}
          emptyText="No motives or tactics yet."
          renderRow={(row, set, index) => (
            <MotiveField
              label={`Motive ${String(index + 1)}`}
              value={row}
              set={set}
              disabled={readOnly}
              onBlur={autosave.flush}
            />
          )}
          onChange={(rows, now) => {
            commit('motives', rows, now);
          }}
        />
        <FieldError message={errors.motives ?? null} />
      </Group>

      <Group title="Features">
        <ListEditor<Ability>
          id="stat-features"
          itemLabel="Feature"
          value={statBlock.features}
          empty={blank.ability}
          isComplete={hasName}
          max={SHEET_LIST_MAX}
          disabled={readOnly}
          emptyText="No features yet."
          renderRow={(row, set, index) => (
            <AbilityFields
              label={`Feature ${String(index + 1)}`}
              value={row}
              set={set}
              disabled={readOnly}
              onBlur={autosave.flush}
            />
          )}
          onChange={(rows, now) => {
            commit('features', rows, now);
          }}
        />
        <FieldError message={errors.features ?? null} />
      </Group>

      <Group
        title="Health"
        description="Template values. Each copy of this monster tracks its own HP and Stress in battle."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {number('majorThreshold', 'Major threshold')}
          {number('severeThreshold', 'Severe threshold')}
          {number('hpMax', 'HP max')}
          {number('stressMax', 'Stress max')}
        </div>
      </Group>

      <Group title="Used by">
        {usedBy.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No NPCs use this stat block. Pick it on an NPC&apos;s record.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="NPCs using this stat block">
            {usedBy.map((npc) => (
              <li key={npc.id}>
                <Link to={recordPath(campaign.id, npc.id)} className="underline">
                  {npc.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Group>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(false);
          }}
          title={`Delete ${statBlock.name}?`}
          description={
            usedBy.length === 0
              ? "This can't be undone."
              : `${usedBy.map((npc) => npc.name).join(', ')} will lose ${usedBy.length === 1 ? 'its' : 'their'} stat block. This can't be undone.`
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            autosave.discard();
            await del.mutateAsync(statBlock.id);
            onDeleted();
          }}
        />
      )}
    </div>
  );
}
