import {
  AI_IMPORT_LIMITS,
  RECORD_TYPE_LABELS,
  RECORD_TYPES,
  startImportRequestSchema,
  type ImportMode,
  type RecordSummary,
  type RecordType,
  type StartImportRequest,
} from '@stagehand/shared';
import { SparklesIcon, XIcon } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { RecordPicker } from '@/components/records/RecordPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  formatTokens,
  formatUsd,
  IMPORT_MODE_LABELS,
  importReviewPath,
  plural,
} from '@/lib/ai-import';
import { ApiError } from '@/lib/api';
import { useEstimateImport, useStartImport } from '@/lib/queries';
import { pluralLabel } from '@/lib/records';

/** What the form starts with: from the URL, or from an import being tried again. */
export interface ImportFormInitial {
  mode?: ImportMode;
  text?: string;
  targetTypes?: RecordType[] | null;
  recordId?: string | null;
}

interface ImportFormProps {
  campaignId: string;
  /** Every record of the campaign: whether Bootstrap is offered, and the fill-in picker. */
  records: RecordSummary[];
  initial: ImportFormInitial;
}

const MODE_HELP: Record<ImportMode, string> = {
  bootstrap:
    'For an empty campaign: the story overview, major factions and NPCs, areas and spots, lore and opening story beats.',
  add: 'New NPCs, places, arcs or anything else. Claude sees what the campaign already has, so it links to it and can propose changes to it.',
  fill: "Claude completes one record's empty fields. Notes are optional guidance.",
};

/** A 409 that the GM fixes in Settings (no key, or one that can't be read any more). */
const needsSettings = (error: unknown) =>
  error instanceof ApiError && error.status === 409 && error.message.includes('Settings');

/**
 * The new-import form (F1.8b, governance §10): notes, a mode, an optional type filter, a
 * cost check on request (D-29), and Send. Sending moves to the import's own page, which
 * waits for the model.
 */
export function ImportForm({ campaignId, records, initial }: ImportFormProps) {
  const navigate = useNavigate();
  const formId = useId();
  const start = useStartImport(campaignId);
  const estimate = useEstimateImport(campaignId);
  const empty = records.length === 0;
  const modes: ImportMode[] = empty ? ['bootstrap', 'add'] : ['add', 'fill'];
  const [mode, setMode] = useState<ImportMode>(
    initial.mode !== undefined && modes.includes(initial.mode)
      ? initial.mode
      : empty
        ? 'bootstrap'
        : 'add',
  );
  const [text, setText] = useState(initial.text ?? '');
  const [types, setTypes] = useState<RecordType[]>(initial.targetTypes ?? []);
  const [recordId, setRecordId] = useState<string | null>(
    initial.recordId !== undefined &&
      initial.recordId !== null &&
      records.some((r) => r.id === initial.recordId)
      ? initial.recordId
      : null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  /** The request the shown estimate is for; the estimate hides once the form differs. */
  const [estimatedFor, setEstimatedFor] = useState<string | null>(null);

  const target = records.find((r) => r.id === recordId) ?? null;

  function requestOf(): StartImportRequest {
    if (mode === 'fill') return { mode, text, ...(recordId === null ? {} : { recordId }) };
    return { mode, text, ...(types.length === 0 ? {} : { targetTypes: types }) };
  }

  /** The request, checked like the server will; null (with the problem shown) if it fails. */
  function checked(): StartImportRequest | null {
    const parsed = startImportRequestSchema.safeParse(requestOf());
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the form');
      return null;
    }
    setProblem(null);
    return parsed.data;
  }

  const current = JSON.stringify(requestOf());
  const shownEstimate = estimate.isSuccess && estimatedFor === current ? estimate.data : null;

  function checkCost() {
    const request = checked();
    if (request === null) return;
    start.reset();
    setEstimatedFor(current);
    estimate.mutate(request);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = checked();
    if (request === null) return;
    estimate.reset();
    start.mutate(request, {
      onSuccess: (created) => {
        void navigate(importReviewPath(campaignId, created.id));
      },
    });
  }

  const busy = start.isPending;
  const error = start.error ?? (estimatedFor === current ? estimate.error : null);
  const fillCandidates = records.filter((r) => r.id !== recordId);

  return (
    <form className="space-y-6" onSubmit={handleSubmit} noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What kind of import?</legend>
        <div className="space-y-2">
          {modes.map((option) => (
            <label key={option} className="flex items-start gap-3 rounded-md border p-3">
              <input
                type="radio"
                name={`${formId}-mode`}
                value={option}
                className="mt-1"
                checked={mode === option}
                disabled={busy}
                onChange={() => {
                  setMode(option);
                  setProblem(null);
                }}
              />
              <span className="space-y-1">
                <span className="block font-medium">{IMPORT_MODE_LABELS[option]}</span>
                <span className="block text-sm text-muted-foreground">{MODE_HELP[option]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'fill' && (
        <div className="space-y-2">
          <Label htmlFor={`${formId}-record`}>Record to fill in</Label>
          {target !== null && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1 pr-1">
                {target.name}
                <span className="text-muted-foreground">· {RECORD_TYPE_LABELS[target.type]}</span>
                <button
                  type="button"
                  aria-label={`Pick another record than ${target.name}`}
                  className="rounded-sm p-0.5 hover:bg-muted"
                  disabled={busy}
                  onClick={() => {
                    setRecordId(null);
                  }}
                >
                  <XIcon className="size-3" aria-hidden />
                </button>
              </Badge>
            </div>
          )}
          {target === null && (
            <RecordPicker
              id={`${formId}-record`}
              label="Record to fill in"
              placeholder="Type a record's name"
              candidates={fillCandidates}
              disabled={busy}
              onPick={(picked) => {
                setRecordId(picked.id);
                setProblem(null);
              }}
            />
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${formId}-text`}>
          {mode === 'fill' ? 'Notes for Claude (optional)' : 'Your notes'}
        </Label>
        <Textarea
          id={`${formId}-text`}
          className="max-h-[60vh] min-h-64"
          value={text}
          disabled={busy}
          aria-describedby={`${formId}-count`}
          placeholder={
            mode === 'fill'
              ? 'Anything Claude should know while filling this record in.'
              : 'Write freely: who, where, what they want, what happened, what is secret…'
          }
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <p
          id={`${formId}-count`}
          className={`text-xs ${
            text.length > AI_IMPORT_LIMITS.inputMaxChars
              ? 'text-destructive'
              : 'text-muted-foreground'
          }`}
        >
          {formatTokens(text.length)} / {formatTokens(AI_IMPORT_LIMITS.inputMaxChars)} characters
        </p>
      </div>

      {mode !== 'fill' && (
        <div role="group" aria-label="Only create" className="space-y-2">
          <p className="text-sm font-medium">Only create (optional)</p>
          <div className="flex flex-wrap gap-2">
            {RECORD_TYPES.map((type) => {
              const on = types.includes(type);
              return (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={on ? 'default' : 'outline'}
                  className="h-7 rounded-full px-3"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => {
                    setTypes((existing) =>
                      on ? existing.filter((other) => other !== type) : [...existing, type],
                    );
                  }}
                >
                  {pluralLabel(type)}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Leave all off to let Claude propose any kind of record.
          </p>
        </div>
      )}

      <p className="rounded-md border bg-muted px-4 py-3 text-sm">
        Your notes{mode === 'bootstrap' ? '' : ' and the records of this campaign they relate to'}{' '}
        are sent to Anthropic under your own API key, private fields included. Nothing is saved
        until you review and accept what Claude proposes.
      </p>
      <p className="text-sm text-muted-foreground">
        Claude first asks about anything unclear. Answer as many rounds as you like, or go straight
        to the records. Each round is another call, mostly read from Anthropic&apos;s cache, so it
        costs much less than the first.
      </p>

      {problem !== null && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}{' '}
          {needsSettings(error) && (
            <Link to="/settings" className="underline">
              Open Settings
            </Link>
          )}
        </p>
      )}
      {shownEstimate !== null && (
        <p role="status" className="text-sm">
          {shownEstimate.estimatedCostUsd === null
            ? `No price is listed for ${shownEstimate.model}, so there is no estimate.`
            : `Writing the records: about ${formatUsd(shownEstimate.estimatedCostUsd.likely)}, at most ${formatUsd(
                shownEstimate.estimatedCostUsd.max,
              )}.`}{' '}
          <span className="text-muted-foreground">
            {formatTokens(shownEstimate.inputTokens)} tokens in;{' '}
            {plural(
              shownEstimate.context.index +
                shownEstimate.context.summary +
                shownEstimate.context.full,
              'record',
            )}{' '}
            sent along ({formatTokens(shownEstimate.context.full)} in full).
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          <SparklesIcon aria-hidden />
          {busy ? 'Sending…' : 'Send to Claude'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || estimate.isPending}
          onClick={checkCost}
        >
          {estimate.isPending ? 'Checking…' : 'Check cost'}
        </Button>
      </div>
    </form>
  );
}
