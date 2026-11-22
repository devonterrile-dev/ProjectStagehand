import {
  isEmptyRichText,
  traitLabel,
  type CardPlace,
  type HeldCard,
  type Ruleset,
  type SheetCards,
} from '@stagehand/shared';
import { ChevronRightIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { FieldError } from '@/components/FieldError';
import { FeatureList } from '@/components/gameplay/ClassViews';
import { Facts } from '@/components/gameplay/GearViews';
import { cardTypeLabel } from '@/components/gameplay/labels';
import { RichTextView } from '@/components/records/RichTextView';
import { Button } from '@/components/ui/button';

/**
 * The cards beside a player's sheet page (F4.7, governance §8 and §12): the subclass and the
 * ancestry to its right, the loadout and vault piles to its left. Every card is the same size;
 * long text scrolls inside the card. The site's sheet page and the table both lay these out.
 */

/** Every side card's size, in CSS pixels; the table lays them out at the sheet page's scale. */
const SIDE_CARD = { widthPx: 280, heightPx: 380 } as const;

/** One card: a corner label, its name and a line under it fixed at the top; the rest scrolls. */
export function CardFrame({
  label,
  corner,
  name,
  meta,
  footer,
  children,
}: {
  label: string;
  corner: ReactNode;
  name: string;
  meta?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article
      aria-label={label}
      className="flex flex-col overflow-hidden rounded-xl border-2 bg-card text-card-foreground shadow-sm"
      style={{ width: SIDE_CARD.widthPx, height: SIDE_CARD.heightPx }}
    >
      <header className="flex items-center justify-between gap-2 bg-muted px-4 py-1.5 text-sm font-medium">
        {corner}
      </header>
      <div className="px-4 pt-2">
        <h1 className="truncate text-lg leading-tight font-bold">{name}</h1>
        {meta !== undefined && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-2 text-sm">
        {children}
      </div>
      {footer !== undefined && <footer className="border-t px-3 py-2">{footer}</footer>}
    </article>
  );
}

/** The subclass card: its spellcast trait, and the foundation, specialization and mastery held. */
export function SubclassCard({
  subclass,
  ruleset,
}: {
  subclass: NonNullable<SheetCards['subclass']>;
  ruleset: Ruleset;
}) {
  return (
    <CardFrame
      label={`${subclass.name}, the subclass`}
      corner={<span>{subclass.className} subclass</span>}
      name={subclass.name}
    >
      <Facts
        facts={[
          [
            'Spellcast trait',
            subclass.spellcastTrait === null
              ? 'None'
              : traitLabel(ruleset, subclass.spellcastTrait),
          ],
        ]}
      />
      {subclass.foundation !== null && (
        <FeatureList title="Foundation" features={subclass.foundation} />
      )}
      {subclass.specialization !== null && (
        <FeatureList title="Specialization" features={subclass.specialization} />
      )}
      {subclass.mastery !== null && <FeatureList title="Mastery" features={subclass.mastery} />}
    </CardFrame>
  );
}

/**
 * The ancestry card: one species with all its features, or a mixed ancestry as one card with the
 * two features it gives, each marked with the species it comes from (D-64). Nothing without one.
 */
export function AncestryCard({ species }: { species: SheetCards['species'] }) {
  const [first, second] = species;
  if (first === undefined) return null;
  if (second === undefined) {
    return (
      <CardFrame
        label={`${first.name}, the species`}
        corner={<span>Species</span>}
        name={first.name}
      >
        <FeatureList title="Features" features={first.features} />
      </CardFrame>
    );
  }
  const name = `${first.name} / ${second.name}`;
  return (
    <CardFrame label={`${name}, a mixed ancestry`} corner={<span>Mixed ancestry</span>} name={name}>
      <FeatureList
        title="Features"
        features={[first, second].flatMap((one) =>
          one.features.map((feature) => ({ ...feature, name: `${feature.name} (${one.name})` })),
        )}
      />
    </CardFrame>
  );
}

/** Moving the player's own cards: by the rules, or free while the GM has Rest on. */
export interface PileActions {
  onMove: (cardId: string, to: CardPlace, swapOut?: string) => Promise<unknown>;
}

/**
 * What bringing a card back costs, in words. `rest` is the table's Rest switch; undefined where
 * it isn't known (the site), so the words say both.
 */
function recallCostLabel(card: HeldCard, rest: boolean | undefined): string {
  if (card.recallCost === 0) return 'free';
  if (rest === true) return 'free: Rest';
  const stress = `${String(card.recallCost)} Stress`;
  return rest === false ? stress : `${stress}, free during Rest`;
}

/**
 * The loadout or the vault as a pile of cards (§9 "Domain card loadout"): the top card shows,
 * and clicking it (or Next card) turns to the next one. With `actions`, the vault's top card can
 * be brought back to the loadout; into a full loadout, the player first picks which loadout card
 * goes to the vault. Loadout cards have no move of their own (D-67).
 */
export function CardPile({
  place,
  cards,
  loadout,
  loadoutMax,
  actions,
  rest,
}: {
  place: CardPlace;
  /** The pile's cards. */
  cards: HeldCard[];
  /** The loadout, which a recall into a full loadout picks from. */
  loadout: HeldCard[];
  loadoutMax: number;
  actions?: PileActions;
  rest?: boolean;
}) {
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [makingRoom, setMakingRoom] = useState(false);
  const title = place === 'loadout' ? 'Loadout' : 'Vault';
  const count = cards.length;
  const shown = count === 0 ? null : (cards[at % count] ?? null);
  const full = loadout.length >= loadoutMax;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMakingRoom(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const next = () => {
    if (count > 1) setAt((current) => (current + 1) % count);
    setMakingRoom(false);
  };

  const footer = (card: HeldCard): ReactNode => {
    if (actions === undefined) return undefined;
    // A loadout card goes to the vault only to make room for one coming back (D-67): the vault's
    // card asks which, so the loadout has no button of its own.
    if (place === 'loadout') return undefined;
    if (makingRoom) {
      return (
        <div
          role="group"
          aria-label={`Make room for ${card.name}`}
          className="space-y-1"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <p className="text-xs text-muted-foreground">
            The loadout is full. Put which card in the vault?
          </p>
          <div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
            {loadout.map((held) => (
              <Button
                key={held.id}
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => actions.onMove(card.id, 'loadout', held.id))}
              >
                Put {held.name} in the vault
              </Button>
            ))}
          </div>
          <Button
            size="xs"
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={() => {
              setMakingRoom(false);
            }}
          >
            Cancel
          </Button>
        </div>
      );
    }
    return (
      <Button
        size="xs"
        variant="outline"
        className="h-auto w-full py-1 whitespace-normal"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          if (full) setMakingRoom(true);
          else void run(() => actions.onMove(card.id, 'loadout'));
        }}
      >
        Bring {card.name} to the loadout ({recallCostLabel(card, rest)})
      </Button>
    );
  };

  return (
    <section aria-label={title} className="space-y-1.5" style={{ width: SIDE_CARD.widthPx }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {place === 'loadout' ? `${String(count)} of ${String(loadoutMax)}` : String(count)}
          </span>
        </h3>
        {count > 1 && (
          <Button size="xs" variant="ghost" aria-label={`Next card in the ${place}`} onClick={next}>
            {(at % count) + 1} of {count}
            <ChevronRightIcon aria-hidden />
          </Button>
        )}
      </div>
      {place === 'vault' && rest === true && (
        <p className="text-xs font-medium text-emerald-700">Rest: swaps are free</p>
      )}
      {shown === null ? (
        <div
          className="flex items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground"
          style={{ width: SIDE_CARD.widthPx, height: SIDE_CARD.heightPx }}
        >
          {place === 'loadout' ? 'No cards in the loadout' : 'The vault is empty'}
        </div>
      ) : (
        <div className="relative" style={{ width: SIDE_CARD.widthPx, height: SIDE_CARD.heightPx }}>
          {/* The cards under the top one: their edges show, so it reads as a pile. */}
          {Array.from({ length: Math.min(count - 1, 3) }, (_, n) => (
            <div
              key={n}
              aria-hidden
              className="absolute inset-0 rounded-xl border-2 bg-card shadow-sm"
              style={{ transform: `translate(${String((n + 1) * 4)}px, ${String((n + 1) * 4)}px)` }}
            />
          ))}
          <div
            className={`relative transition-transform ${count > 1 ? 'cursor-pointer hover:-translate-y-1 hover:shadow-lg' : ''}`}
            onClick={next}
          >
            <CardFrame
              label={`${shown.name}, a ${shown.domainName} card`}
              corner={
                <>
                  <span>{shown.domainName}</span>
                  <span>Level {shown.level}</span>
                </>
              }
              name={shown.name}
              meta={`${cardTypeLabel(shown.type)} · Recall cost ${String(shown.recallCost)}`}
              footer={footer(shown)}
            >
              {shown.warning !== null && (
                <p role="status" className="text-xs text-amber-700">
                  {shown.warning}.
                </p>
              )}
              {isEmptyRichText(shown.feature) ? (
                <p className="text-muted-foreground">No feature written yet.</p>
              ) : (
                <RichTextView value={shown.feature} />
              )}
            </CardFrame>
          </div>
        </div>
      )}
      <FieldError message={error} />
    </section>
  );
}

/** The loadout pile above the vault pile: what lies to the left of the sheet page. */
export function DomainPiles({
  cards,
  loadoutMax,
  actions,
  rest,
}: {
  cards: Pick<SheetCards, 'loadout' | 'vault'>;
  loadoutMax: number;
  actions?: PileActions;
  rest?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {(['loadout', 'vault'] as const).map((place) => (
        <CardPile
          key={place}
          place={place}
          cards={cards[place]}
          loadout={cards.loadout}
          loadoutMax={loadoutMax}
          actions={actions}
          rest={rest}
        />
      ))}
    </div>
  );
}

/** The subclass card above the ancestry card: what lies to the right of the sheet page. */
export function FeatureSideCards({ cards, ruleset }: { cards: SheetCards; ruleset: Ruleset }) {
  if (cards.subclass === null && cards.species.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      {cards.subclass !== null && <SubclassCard subclass={cards.subclass} ruleset={ruleset} />}
      <AncestryCard species={cards.species} />
    </div>
  );
}
