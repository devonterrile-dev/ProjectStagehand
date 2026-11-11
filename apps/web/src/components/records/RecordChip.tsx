import { XIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { RecordOpenMenu } from './RecordOpenMenu';

interface RecordChipProps {
  recordId: string;
  name: string;
  /** Accessible name of the remove button, e.g. "Remove Mira from Leaders". Omit for none. */
  removeLabel?: string;
  disabled?: boolean;
  onRemove?: () => void;
}

/** A linked record: its name opens the Open / Open in new tab menu; × unlinks it. */
export function RecordChip({ recordId, name, removeLabel, disabled, onRemove }: RecordChipProps) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      <RecordOpenMenu recordId={recordId} name={name}>
        <button type="button" className="hover:underline">
          {name}
        </button>
      </RecordOpenMenu>
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={removeLabel ?? `Remove ${name}`}
          disabled={disabled}
          className="rounded-full hover:bg-muted-foreground/20 disabled:opacity-50"
          onClick={onRemove}
        >
          <XIcon aria-hidden className="size-3" />
        </button>
      )}
    </Badge>
  );
}
