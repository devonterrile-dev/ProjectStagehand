import { NOTE_BODY_MAX } from '@stagehand/shared';
import { useEffect, useRef, useState } from 'react';

/** How long the posted note takes to peel away before a blank one is under it. */
export const PEEL_MS = 600;

interface StickyNoteFormProps {
  /** What the note is on, for its label. */
  about: string;
  /** Sends the note; rejects with the server's refusal. */
  onPost: (body: string) => Promise<unknown>;
  onBack: () => void;
}

/**
 * The sticky note on the pad at the table (F3.5b): the player types on it and presses Post. The
 * note is posted like one written on the site, peels up off the pad and away, and a blank one is
 * under it. Plain DOM with no React context: it is drawn inside the 3D scene (drei `Html`).
 */
export function StickyNoteForm({ about, onPost, onBack }: StickyNoteFormProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [peeled, setPeeled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (peeled === null) return;
    const timer = window.setTimeout(() => {
      setPeeled(null);
    }, PEEL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [peeled]);

  const post = () => {
    const body = text.trim();
    if (body === '' || posting) return;
    setPosting(true);
    setError(null);
    onPost(body).then(
      () => {
        setPosting(false);
        setPeeled(text);
        setText('');
        // Pressing Post took the keyboard; the blank note gets it back.
        field.current?.focus({ preventScroll: true });
      },
      (refused: unknown) => {
        setPosting(false);
        setError(refused instanceof Error ? refused.message : 'Could not post the note');
      },
    );
  };

  return (
    <div className="relative h-full w-full font-serif text-stone-900">
      {/* The blank note under the one being written: what shows once it is pulled away. */}
      <div aria-hidden className="absolute inset-0 rounded-sm bg-yellow-200 shadow-md" />
      {peeled !== null && (
        <div
          aria-hidden
          data-testid="peeling-note"
          className="sticky-peel absolute inset-0 rounded-sm bg-yellow-200 p-6 text-2xl whitespace-pre-wrap shadow-lg"
        >
          {peeled}
        </div>
      )}
      <form
        className="absolute inset-0 flex flex-col gap-3 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          post();
        }}
      >
        <textarea
          aria-label={`Sticky note on ${about}`}
          placeholder={`A note on ${about}…`}
          className="min-h-0 flex-1 resize-none bg-transparent text-2xl leading-snug outline-none placeholder:text-stone-500"
          value={text}
          maxLength={NOTE_BODY_MAX}
          // Focused by the paper it is laid on once it is in place, not on mount (TablePieces).
          data-autofocus
          ref={field}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              post();
            }
          }}
        />
        {error !== null && (
          <p role="alert" className="text-base text-red-800">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 text-lg">
          <button
            type="button"
            className="rounded px-3 py-1 underline-offset-4 hover:underline"
            onClick={onBack}
          >
            Back
          </button>
          <span className="text-sm text-stone-600">
            {text.length} / {NOTE_BODY_MAX}
          </span>
          <button
            type="submit"
            className="rounded bg-stone-800 px-4 py-1 text-yellow-100 disabled:opacity-40"
            disabled={text.trim() === '' || posting}
          >
            Post
          </button>
        </div>
      </form>
    </div>
  );
}
