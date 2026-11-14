import { assetImagePath, isCutoutKind, type AssetSummary } from '@stagehand/shared';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { formatUsd } from '@/lib/ai-import';

import { CHECKERBOARD, KIND_LABELS, visualAlt } from './visual-style';

/** One image the viewer can show; `label` is its place in a pair ("Current", "New", …). */
export interface ViewerItem {
  asset: AssetSummary;
  label?: string | undefined;
}

interface ImageViewerProps {
  campaignId: string;
  /** The record's or PC's name. */
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One image, or the pair in the order the card shows them. */
  items: readonly ViewerItem[];
  index: number;
  onIndexChange: (index: number) => void;
}

/**
 * An image shown large in the middle of the screen (F2.5). For a pair, a switch (and the arrow
 * keys) flips between the two at the same size and place, so a small change is easy to spot.
 */
export function ImageViewer({
  campaignId,
  name,
  open,
  onOpenChange,
  items,
  index,
  onIndexChange,
}: ImageViewerProps) {
  const item = items[index];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[min(92vw,1400px)]"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
          if (event.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1);
        }}
      >
        {item !== undefined && (
          <ViewerBody
            campaignId={campaignId}
            name={name}
            items={items}
            item={item}
            index={index}
            onIndexChange={onIndexChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while open, so "Show the original" starts off each time. */
function ViewerBody({
  campaignId,
  name,
  items,
  item,
  index,
  onIndexChange,
}: {
  campaignId: string;
  name: string;
  items: readonly ViewerItem[];
  item: ViewerItem;
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const { asset, label } = item;
  const cutout = isCutoutKind(asset.kind);
  // Only a cutout's stage version differs visibly from the original (D-43).
  const original = showOriginal && cutout;
  return (
    <>
      <DialogTitle className="pr-8">{label === undefined ? name : `${name}, ${label}`}</DialogTitle>
      {items.length > 1 && (
        <div className="flex gap-2" role="group" aria-label="Compare">
          {items.map((other, position) => (
            <Button
              key={other.asset.id}
              type="button"
              size="sm"
              variant={position === index ? 'default' : 'outline'}
              aria-pressed={position === index}
              onClick={() => {
                onIndexChange(position);
              }}
            >
              {other.label ?? `Image ${String(position + 1)}`}
            </Button>
          ))}
        </div>
      )}
      <div
        className="overflow-hidden rounded-md border"
        style={cutout && !original && asset.processed !== null ? CHECKERBOARD : undefined}
      >
        <img
          src={assetImagePath(campaignId, asset.id, {
            variant: original ? 'original' : 'processed',
            processed: asset.processed,
          })}
          alt={visualAlt(name, asset.kind, label, original)}
          className="mx-auto max-h-[75vh] w-full object-contain"
        />
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{KIND_LABELS[asset.kind]}</Badge>
          <span>Cost {formatUsd(asset.costUsd)}</span>
          {cutout && asset.processed !== null && (
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
      </div>
    </>
  );
}
