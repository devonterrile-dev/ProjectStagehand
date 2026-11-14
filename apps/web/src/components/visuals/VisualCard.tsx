import {
  assetImagePath,
  isCutoutKind,
  VISUAL_COST_ESTIMATE_USD,
  VISUAL_ERROR_MESSAGES,
  visualKindsFor,
  type AssetKind,
  type AssetSummary,
  type VisualSubject,
} from '@stagehand/shared';
import { cn } from 'cn';
import { ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUsd } from '@/lib/ai-import';
import { ApiError, type VisualOwnerRef } from '@/lib/api';
import {
  useChooseVisual,
  useGenerateVisual,
  useProviderCredentials,
  useVisuals,
} from '@/lib/queries';

import { VisualKindDialog } from './VisualKindDialog';

const KIND_LABELS: Record<AssetKind, string> = {
  character: 'Humanoid',
  monster: 'Monster',
  prop: 'Prop',
  backdrop: 'Backdrop',
};

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

/**
 * Generate visual (F2.3, governance §11): the record's or PC's tries at an image, newest
 * first, with the one in use marked. Generate starts a new try in the background (an NPC
 * asks humanoid or monster first); the card polls until it is ready. Images are shown as
 * the model made them until post-processing arrives (F2.4).
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
  const choose = useChooseVisual(campaignId, owner);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const kinds = visualKindsFor(subject);
  const assets = visuals.data?.assets ?? [];
  const inUse = visuals.data?.visualAssetId ?? null;
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null;
  const busy = assets.some((asset) => asset.status === 'generating');
  const hasKey = credentials.data?.some((c) => c.provider === 'openrouter') ?? true;
  const [defaultKind = 'prop'] = kinds;
  const lastKind = assets.find((asset) => kinds.includes(asset.kind))?.kind ?? defaultKind;

  function start(kind?: AssetKind) {
    setAsking(false);
    choose.reset();
    generate.mutate(kind === undefined ? {} : { kind }, {
      onSuccess: (asset) => {
        setSelectedId(asset.id);
      },
    });
  }

  const error = generate.error ?? choose.error;

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
        ) : selected === null ? (
          <p className="text-sm text-muted-foreground">
            No visual yet. Generate one from this {subject === 'pc' ? 'sheet' : 'record'}&apos;s
            {subject === 'spot' ? ' backdrop notes' : ' appearance'} and description.
          </p>
        ) : (
          <SelectedTry
            campaignId={campaignId}
            asset={selected}
            name={name}
            inUse={selected.id === inUse}
            readOnly={readOnly}
            choosing={choose.isPending}
            onChoose={() => {
              generate.reset();
              choose.mutate(selected.id);
            }}
          />
        )}

        {assets.length > 1 && (
          <ul className="flex flex-wrap gap-2" aria-label="Tries">
            {assets.map((asset, index) => (
              <li key={asset.id}>
                <button
                  type="button"
                  aria-label={`Try ${String(assets.length - index)}${asset.id === inUse ? ', in use' : ''}`}
                  aria-pressed={asset.id === selected?.id}
                  className={cn(
                    'flex size-14 items-center justify-center overflow-hidden rounded-md border bg-muted text-xs text-muted-foreground',
                    asset.id === selected?.id && 'ring-2 ring-ring',
                  )}
                  onClick={() => {
                    setSelectedId(asset.id);
                  }}
                >
                  {asset.status === 'pending' || asset.status === 'approved' ? (
                    <img
                      src={assetImagePath(campaignId, asset.id)}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : asset.status === 'generating' ? (
                    '…'
                  ) : (
                    '✕'
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {inUse !== null && !assets.some((asset) => asset.id === inUse) && (
          <p className="text-xs text-muted-foreground">The visual in use is an older try.</p>
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

        {!readOnly && (
          <div className="space-y-2">
            {!hasKey ? (
              <p className="text-sm text-muted-foreground">
                Add your OpenRouter key in Settings to make images.{' '}
                <Link to="/settings" className="underline">
                  Open Settings
                </Link>
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || generate.isPending}
                onClick={() => {
                  if (kinds.length > 1) setAsking(true);
                  else start();
                }}
              >
                <ImageIcon aria-hidden />
                {assets.length === 0 ? 'Generate visual' : 'Generate another'}
              </Button>
            )}
            {hasKey && (
              <p className="text-xs text-muted-foreground">
                About {formatUsd(VISUAL_COST_ESTIMATE_USD[lastKind])} an image, on your OpenRouter
                key.
              </p>
            )}
          </div>
        )}

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

function SelectedTry({
  campaignId,
  asset,
  name,
  inUse,
  readOnly,
  choosing,
  onChoose,
}: {
  campaignId: string;
  asset: AssetSummary;
  name: string;
  inUse: boolean;
  readOnly: boolean;
  choosing: boolean;
  onChoose: () => void;
}) {
  if (asset.status === 'generating') return <Generating asset={asset} />;
  if (asset.status === 'failed' || asset.status === 'rejected') {
    return (
      <p className="rounded-md border px-3 py-2 text-sm" role="status">
        {asset.errorCode === null
          ? 'This try was rejected.'
          : VISUAL_ERROR_MESSAGES[asset.errorCode]}
      </p>
    );
  }
  return (
    <figure className="space-y-2">
      <img
        src={assetImagePath(campaignId, asset.id)}
        alt={`${name}, ${KIND_LABELS[asset.kind].toLowerCase()} visual`}
        className="max-h-80 w-full rounded-md border object-contain"
      />
      <figcaption className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">{KIND_LABELS[asset.kind]}</Badge>
        {inUse && <Badge>In use</Badge>}
        <span>Cost {formatUsd(asset.costUsd)}</span>
        {isCutoutKind(asset.kind) && <span>Unprocessed: the background is removed later.</span>}
      </figcaption>
      {!readOnly && !inUse && (
        <Button type="button" size="sm" disabled={choosing} onClick={onChoose}>
          Use this one
        </Button>
      )}
    </figure>
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
      <p className="font-medium">Making the image…</p>
      <p className="text-muted-foreground">
        This takes about a minute ({elapsed} so far). You can leave this page and come back.
      </p>
    </div>
  );
}
