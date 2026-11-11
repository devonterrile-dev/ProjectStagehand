import { Button } from '@/components/ui/button';

interface TagFilterProps {
  /** Every tag in the campaign, sorted. Selected tags no record has any more are added. */
  tags: readonly string[];
  selected: readonly string[];
  onToggle: (tag: string) => void;
}

/** One toggle chip per tag (F1.6b); a record must have every selected tag. */
export function TagFilter({ tags, selected, onToggle }: TagFilterProps) {
  const shown = [...new Set([...tags, ...selected])].sort((a, b) => a.localeCompare(b));
  if (shown.length === 0) return null;

  return (
    <div role="group" aria-label="Tags" className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Tags</span>
      {shown.map((tag) => {
        const on = selected.includes(tag);
        return (
          <Button
            key={tag}
            type="button"
            size="sm"
            variant={on ? 'default' : 'outline'}
            className="h-7 rounded-full px-3"
            aria-pressed={on}
            onClick={() => {
              onToggle(tag);
            }}
          >
            {tag}
          </Button>
        );
      })}
    </div>
  );
}
