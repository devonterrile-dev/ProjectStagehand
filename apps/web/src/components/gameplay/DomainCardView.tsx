import { isEmptyRichText, type DomainCard } from '@stagehand/shared';

import { RichTextView } from '@/components/records/RichTextView';

import { cardTypeLabel } from './labels';

/**
 * A domain card drawn as a card (F4.3): its domain and level across the top, its name, type and
 * recall cost, and its feature. Read, never run (§8). F4.7 lays these beside the sheet page.
 */
export function DomainCardView({ card }: { card: DomainCard }) {
  return (
    <article
      aria-label={`${card.name}, a ${card.domainName} card`}
      className="mx-auto max-w-sm overflow-hidden rounded-xl border-2 bg-card shadow-sm"
    >
      <header className="flex items-center justify-between gap-2 bg-muted px-4 py-2 text-sm font-medium">
        <span>{card.domainName}</span>
        <span>Level {card.level}</span>
      </header>
      <div className="space-y-3 px-4 py-4">
        <div>
          <h1 className="text-xl font-bold">{card.name}</h1>
          <p className="text-sm text-muted-foreground">
            {cardTypeLabel(card.type)} · Recall cost {card.recallCost}
          </p>
        </div>
        {isEmptyRichText(card.feature) ? (
          <p className="text-sm text-muted-foreground">No feature written yet.</p>
        ) : (
          <RichTextView value={card.feature} />
        )}
      </div>
    </article>
  );
}
