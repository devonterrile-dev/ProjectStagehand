import {
  assetImagePath,
  isCutoutKind,
  VISUAL_COST_ESTIMATE_USD,
  VISUAL_ERROR_MESSAGES,
  VISUAL_LIMITS,
  VISUAL_REVISION_COST_ESTIMATE_USD,
  visualKindsFor,
  type AssetKind,
  type AssetSummary,
  type VisualSubject,
} from '@stagehand/shared';
import { ImageIcon, PencilIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatUsd } from '@/lib/ai-import';
import { ApiError, type VisualOwnerRef } from '@/lib/api';
import {
  useChooseVisual,
  useDiscardVisual,
  useGenerateVisual,
  useProviderCredentials,
  useReviseVisual,
  useVisuals,
} from '@/lib/queries';

import { ImageViewer, type ViewerItem } from './ImageViewer';
import { CHECKERBOARD, KIND_LABELS, visualAlt } from './visual-style';
import { VisualKindDialog } from './VisualKindDialog';

/** A 409 that the GM fixes in Settings (no key, or one that can't be read any more). */
const needsSettings = (error: unknown) =>
  error instanceof ApiError && error.status === 409 && error.message.includes('Settings');

interface VisualCardProps {
  campaignId: string;
  owner: VisualOwnerRef;
  /** The record's or PC's name, for alt text and the kind question. */
  name: string;
  subject: VisualSubject;
  /** Archived campaigns can look but not make or choose. */
  readOnly: boolean;
  className?: string;
}

/** What the card shows, worked out from the image in use and the drafts (D-44). */
type Review =
  /** Nothing to review: the image in use, or none. */
  | { mode: 'idle' }
  /** One finished draft: Use this / Discard, or Replace / Keep current beside the image in use. */
  | { mode: 'draft'; draft: AssetSummary }
  /** A draft and a change of it: Keep new / Go back. */
  | { mode: 'compare'; before: AssetSummary; after: AssetSummary };

function reviewOf(drafts: readonly AssetSummary[]): Review {
  const pending = drafts.filter((asset) => asset.status === 'pending');
  const after = pending.find((asset) => pending.some((other) => other.id === asset.revisedFromId));
  const before = pending.find((asset) => asset.id === after?.revisedFromId);
  if (after !== undefined && before !== undefined) return { mode: 'compare', before, after };
  const [draft] = pending.slice(-1);
  return draft === undefined ? { mode: 'idle' } : { mode: 'draft', draft };
}

/**
 * Generate visual (F2.3) and review (F2.5, governance §11, D-44). A record or PC has one image
 * in use, always shown first, and at most a draft under review:
 * - with no image in use, the GM uses or discards the draft;
 * - beside an image in use, the GM keeps the current one or replaces it;
 * - Regenerate with notes sends the draft (or the image in use) back with the GM's notes, and
 *   the two versions are compared until the GM keeps the new one or goes back.
 * Images are shown as the stage will use them (F2.4: cutouts on a checkerboard), with the
 * model's original a click away.
 */
export function VisualCard({
  campaignId,
  owner,
  name,
  subject,
  readOnly,
  className,
}: VisualCardProps) {
  const visuals = useVisuals(campaignId, owner, true);
  const credentials = useProviderCredentials();
  const generate = useGenerateVisual(campaignId, owner);
  const revise = useReviseVisual(campaignId, owner);
  const choose = useChooseVisual(campaignId, owner);
  const discard = useDiscardVisual(campaignId, owner);
  const [asking, setAsking] = useState(false);
  const [revising, setRevising] = useState<string | null>(null);
  /** The kind last asked for here, for the next question once its image was discarded. */
  const [chosenKind, setChosenKind] = useState<AssetKind | null>(null);
  /** The image open in the large viewer, among the ones shown. */
  const [viewing, setViewing] = useState<{ items: ViewerItem[]; index: number } | null>(null);

  const kinds = visualKindsFor(subject);
  const inUse = visuals.data?.inUse ?? null;
  const drafts = visuals.data?.drafts ?? [];
  const working = drafts.find((asset) => asset.status === 'generating') ?? null;
  const failed = drafts.filter((asset) => asset.status === 'failed');
  const review = reviewOf(drafts);
  const hasKey = credentials.data?.some((c) => c.provider === 'openrouter') ?? true;
  const [defaultKind = 'prop'] = kinds;
  const lastKind =
    [...drafts, ...(inUse === null ? [] : [inUse])].find((asset) => kinds.includes(asset.kind))
      ?.kind ??
    chosenKind ??
    defaultKind;
  const pending = generate.isPending || revise.isPending || choose.isPending || discard.isPending;
  const locked = working !== null || pending;

  function resetErrors() {
    generate.reset();
    revise.reset();
    choose.reset();
    discard.reset();
  }

  function start(kind?: AssetKind) {
    setAsking(false);
    if (kind !== undefined) setChosenKind(kind);
    resetErrors();
    generate.mutate(kind === undefined ? {} : { kind });
  }

  function sendNotes(assetId: string, notes: string) {
    resetErrors();
    revise.mutate(
      { assetId, notes },
      {
        onSuccess: () => {
          setRevising(null);
        },
      },
    );
  }

  function use(assetId: string) {
    resetErrors();
    choose.mutate(assetId);
  }

  function drop(assetId: string) {
    resetErrors();
    discard.mutate(assetId);
  }

  const error = generate.error ?? revise.error ?? choose.error ?? discard.error;
  /** The images on show, in order: what the large viewer flips between. */
  const shown: ViewerItem[] = [];
  const shot = (asset: AssetSummary, label?: string) => {
    const index = shown.push({ asset, label }) - 1;
    return (
      <Shot
        key={asset.id}
        campaignId={campaignId}
        asset={asset}
        name={name}
        label={label}
        inUse={asset.id === inUse?.id}
        onEnlarge={() => {
          setViewing({ items: [...shown], index });
        }}
      />
    );
  };

  /** The image a Regenerate with notes would change now, if any. */
  const revisable = review.mode === 'draft' ? review.draft : review.mode === 'idle' ? inUse : null;

  let images: ReactNode;
  if (review.mode === 'compare') {
    images = (
      <Pair>
        {shot(review.before, 'Before')}
        {shot(review.after, 'After')}
      </Pair>
    );
  } else if (review.mode === 'draft' && inUse !== null) {
    images = (
      <Pair>
        {shot(inUse, 'Current')}
        {shot(review.draft, 'New')}
      </Pair>
    );
  } else if (review.mode === 'draft') {
    images = shot(review.draft);
  } else if (inUse !== null) {
    images = shot(inUse);
  } else if (working === null && failed.length === 0) {
    images = (
      <p className="text-sm text-muted-foreground">
        No visual yet. Generate one from this {subject === 'pc' ? 'sheet' : 'record'}&apos;s
        {subject === 'spot' ? ' backdrop notes' : ' appearance'} and description.
      </p>
    );
  }

  return (
    <Card role="region" aria-label="Visual" className={className}>
      <CardHeader>
        <CardTitle>Visual</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {visuals.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visuals.isError ? (
          <p role="alert" className="text-sm">
            Could not load the visuals. Try again in a moment.
          </p>
        ) : (
          <>
            {images}
            {working !== null && <Generating asset={working} />}
            {failed.map((asset) => (
              <div
                key={asset.id}
                role="status"
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {asset.errorCode === null
                    ? 'This image was not made.'
                    : VISUAL_ERROR_MESSAGES[asset.errorCode]}
                </span>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={locked}
                    onClick={() => {
                      drop(asset.id);
                    }}
                  >
                    Dismiss
                  </Button>
                )}
              </div>
            ))}
          </>
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

        {!readOnly && visuals.isSuccess && (
          <div className="space-y-3">
            {review.mode === 'compare' && (
              <Actions>
                <Button
                  type="button"
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    drop(review.before.id);
                  }}
                >
                  Keep new
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    drop(review.after.id);
                  }}
                >
                  Go back
                </Button>
              </Actions>
            )}
            {review.mode === 'draft' && (
              <Actions>
                <Button
                  type="button"
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    use(review.draft.id);
                  }}
                >
                  {inUse === null ? 'Use this' : 'Replace'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    drop(review.draft.id);
                  }}
                >
                  {inUse === null ? 'Discard' : 'Keep current'}
                </Button>
              </Actions>
            )}

            {!hasKey ? (
              <p className="text-sm text-muted-foreground">
                Add your OpenRouter key in Settings to make images.{' '}
                <Link to="/settings" className="underline">
                  Open Settings
                </Link>
              </p>
            ) : revisable !== null && revising === revisable.id ? (
              <NotesForm
                busy={locked}
                onCancel={() => {
                  setRevising(null);
                }}
                onSend={(notes) => {
                  sendNotes(revisable.id, notes);
                }}
              />
            ) : (
              <>
                <Actions>
                  {revisable !== null && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={locked}
                      onClick={() => {
                        resetErrors();
                        setRevising(revisable.id);
                      }}
                    >
                      <PencilIcon aria-hidden />
                      Regenerate with notes
                    </Button>
                  )}
                  {review.mode === 'idle' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={locked}
                      onClick={() => {
                        if (kinds.length > 1) setAsking(true);
                        else start();
                      }}
                    >
                      <ImageIcon aria-hidden />
                      {inUse === null ? 'Generate visual' : 'Generate new'}
                    </Button>
                  )}
                </Actions>
                {review.mode === 'idle' && (
                  <p className="text-xs text-muted-foreground">
                    About {formatUsd(VISUAL_COST_ESTIMATE_USD[lastKind])} an image, on your
                    OpenRouter key.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <ImageViewer
          campaignId={campaignId}
          name={name}
          open={viewing !== null}
          onOpenChange={(open) => {
            if (!open) setViewing(null);
          }}
          items={viewing?.items ?? []}
          index={viewing?.index ?? 0}
          onIndexChange={(index) => {
            setViewing((current) => (current === null ? current : { ...current, index }));
          }}
        />

        {kinds.length > 1 && (
          <VisualKindDialog
            name={name}
            initial={lastKind}
            open={asking}
            onOpenChange={setAsking}
            onChoose={start}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/**
 * One image: the stage version (or the original), what kind it is, its cost and notes. Clicking
 * it opens the large viewer. Only a cutout can switch to its original: a backdrop's stage
 * version is the same picture, cropped and sized (D-43).
 */
function Shot({
  campaignId,
  asset,
  name,
  label,
  inUse,
  onEnlarge,
}: {
  campaignId: string;
  asset: AssetSummary;
  name: string;
  /** "Current" / "New" or "Before" / "After" when two are shown side by side. */
  label?: string | undefined;
  inUse: boolean;
  onEnlarge: () => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const cutout = isCutoutKind(asset.kind);
  const original = showOriginal && cutout;
  const alt = visualAlt(name, asset.kind, label, original);
  return (
    <figure className="space-y-2">
      {label !== undefined && <p className="text-sm font-medium">{label}</p>}
      <button
        type="button"
        aria-label={`Enlarge ${alt}`}
        className="block w-full cursor-zoom-in overflow-hidden rounded-md border transition-shadow hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        style={cutout && !original && asset.processed !== null ? CHECKERBOARD : undefined}
        onClick={onEnlarge}
      >
        <img
          src={assetImagePath(campaignId, asset.id, {
            variant: original ? 'original' : 'processed',
            processed: asset.processed,
          })}
          alt={alt}
          className="max-h-80 w-full object-contain"
        />
      </button>
      <figcaption className="space-y-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{KIND_LABELS[asset.kind]}</Badge>
          {inUse && <Badge>In use</Badge>}
          <span>Cost {formatUsd(asset.costUsd)}</span>
          {asset.processed === null ? (
            <span>Not ready for the stage yet: this is the model&apos;s original.</span>
          ) : !cutout ? null : (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              aria-pressed={showOriginal}
              onClick={() => {
                setShowOriginal((shown) => !shown);
              }}
            >
              {showOriginal ? 'Show the stage version' : 'Show the original'}
            </Button>
          )}
        </div>
        {asset.revisionNotes !== null && <p>Notes: {asset.revisionNotes}</p>}
      </figcaption>
    </figure>
  );
}

/** Regenerate with notes: what to change, sent with the image being changed. */
function NotesForm({
  busy,
  onCancel,
  onSend,
}: {
  busy: boolean;
  onCancel: () => void;
  onSend: (notes: string) => void;
}) {
  const fieldId = useId();
  const [notes, setNotes] = useState('');
  const empty = notes.trim() === '';
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty) onSend(notes.trim());
      }}
    >
      <Label htmlFor={fieldId}>What should change?</Label>
      <Textarea
        id={fieldId}
        value={notes}
        maxLength={VISUAL_LIMITS.notesMax}
        rows={3}
        placeholder="Bigger hat, angrier eyebrows"
        onChange={(event) => {
          setNotes(event.target.value);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {notes.length} / {VISUAL_LIMITS.notesMax}. The image is sent back with these notes: about{' '}
        {formatUsd(VISUAL_REVISION_COST_ESTIMATE_USD)}, on your OpenRouter key.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || empty}>
          Regenerate
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Generating({ asset }: { asset: AssetSummary }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const seconds = Math.max(0, Math.round((now - new Date(asset.createdAt).getTime()) / 1000));
  const elapsed = `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="rounded-md border px-3 py-2 text-sm" role="status">
      <p className="font-medium">
        {asset.revisedFromId === null ? 'Making the image…' : 'Making the new version…'}
      </p>
      <p className="text-muted-foreground">
        This takes about a minute ({elapsed} so far). You can leave this page and come back.
      </p>
    </div>
  );
}
