import { cn } from 'cn';
import { XIcon } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { optionId } from '@/lib/records';

/** How many suggestions the list shows at once. */
const SHOWN = 8;

interface TagFilterProps {
  /** Every tag in the campaign, sorted. */
  tags: readonly string[];
  selected: readonly string[];
  onToggle: (tag: string) => void;
}

/** The unpicked tags matching the query: prefix matches first, then the rest, alphabetically. */
function suggest(tags: readonly string[], selected: readonly string[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  const rank = (tag: string) => (tag.toLocaleLowerCase().startsWith(needle) ? 0 : 1);
  return tags
    .filter((tag) => !selected.includes(tag) && tag.toLocaleLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, SHOWN);
}

/**
 * A type-to-search box over the campaign's tags; each picked tag shows as a chip that
 * removes it when clicked. A record must have every picked tag (F1.6b).
 */
export function TagFilter({ tags, selected, onToggle }: TagFilterProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  if (tags.length === 0 && selected.length === 0) return null;

  const matches = suggest(tags, selected, query);
  const showing = open && matches.length > 0;

  function pick(tag: string) {
    setQuery('');
    setActive(0);
    onToggle(tag);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + matches.length) % Math.max(matches.length, 1));
    } else if (event.key === 'Enter') {
      const tag = showing ? matches[active] : undefined;
      if (tag !== undefined) {
        event.preventDefault();
        pick(tag);
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Tags</span>
        <div className="relative w-48">
          <input
            role="combobox"
            aria-label="Filter by tag"
            aria-expanded={showing}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showing ? optionId(listId, active) : undefined}
            autoComplete="off"
            className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            placeholder="Search tags"
            value={query}
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
            }}
            onBlur={() => {
              setOpen(false);
            }}
            onKeyDown={handleKeyDown}
          />
          {showing && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Tags"
              className="absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {matches.map((tag, index) => (
                <li
                  key={tag}
                  id={optionId(listId, index)}
                  role="option"
                  aria-selected={index === active}
                  className={cn(
                    'cursor-pointer truncate rounded-sm px-2 py-1.5 text-sm',
                    index === active && 'bg-accent text-accent-foreground',
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(tag);
                  }}
                  onMouseEnter={() => {
                    setActive(index);
                  }}
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
          {open && matches.length === 0 && query.trim() !== '' && (
            <p className="absolute top-full z-50 mt-1 rounded-md border bg-popover px-3 py-2 text-sm whitespace-nowrap text-muted-foreground shadow-md">
              No matching tags
            </p>
          )}
        </div>
      </div>
      {selected.length > 0 && (
        <div role="group" aria-label="Tag filters" className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <Badge key={tag} asChild variant="secondary" className="cursor-pointer gap-1 pr-1.5">
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                title={`Remove ${tag}`}
                className="hover:bg-secondary/80"
                onClick={() => {
                  onToggle(tag);
                }}
              >
                {tag}
                <XIcon aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
