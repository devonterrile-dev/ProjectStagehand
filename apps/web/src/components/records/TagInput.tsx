import { TAG_MAX, TAGS_MAX, tagSchema } from '@stagehand/shared';
import { XIcon } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

import { Badge } from '@/components/ui/badge';

interface TagInputProps {
  id: string;
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}

/** Free tags: Enter or a comma adds what's typed, Backspace on an empty box removes the last. */
export function TagInput({ id, value, disabled, onChange }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    const parsed = tagSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid tag');
      return;
    }
    setDraft('');
    if (value.includes(parsed.data)) return;
    if (value.length >= TAGS_MAX) {
      setError(`At most ${String(TAGS_MAX)} tags`);
      return;
    }
    setError(null);
    onChange([...value, parsed.data]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              disabled={disabled}
              className="rounded-full hover:bg-muted-foreground/20 disabled:opacity-50"
              onClick={() => {
                onChange(value.filter((other) => other !== tag));
              }}
            >
              <XIcon aria-hidden className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          className="min-w-24 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          placeholder={value.length === 0 ? 'Add a tag and press Enter' : ''}
          value={draft}
          maxLength={TAG_MAX}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (draft.trim() !== '') add();
          }}
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
