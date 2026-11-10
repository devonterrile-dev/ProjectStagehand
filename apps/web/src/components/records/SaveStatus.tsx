import { Button } from '@/components/ui/button';
import type { AutosaveStatus } from '@/lib/useAutosave';

interface SaveStatusProps {
  status: AutosaveStatus;
  error: string | null;
  onRetry: () => void;
}

/** The one line that says where autosave stands. Nothing until the first edit. */
export function SaveStatus({ status, error, onRetry }: SaveStatusProps) {
  if (status === 'idle') return null;
  if (status === 'error') {
    return (
      <span role="alert" className="flex items-center gap-1 text-sm text-destructive">
        Couldn&apos;t save: {error ?? 'Something went wrong'}
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  }
  return (
    <span role="status" className="text-sm text-muted-foreground">
      {status === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  );
}
