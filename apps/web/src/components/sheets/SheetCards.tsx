import { traitLabel, type HeldCard, type Ruleset, type SheetCards } from '@stagehand/shared';
import { useState } from 'react';

import { FieldError } from '@/components/FieldError';
import { FeatureList } from '@/components/gameplay/ClassViews';
import { DomainCardView } from '@/components/gameplay/DomainCardView';
import { ArmorView, Facts, GearCard, WeaponView } from '@/components/gameplay/GearViews';
import { hopeFeatureLabel } from '@/components/gameplay/labels';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * A PC's feature cards (F4.7, governance §8): the class, the subclass cards held, the species,
 * the equipped gear and the domain cards. Drawn from the sheet's `cards`, worked out by the
 * server from the linked records; the site's sheet pages and the table both show them.
 */

/** The class, subclass, species and gear cards, in a grid; nothing when none is linked. */
export function FeatureCards({ cards, ruleset }: { cards: SheetCards; ruleset: Ruleset }) {
  const { class: cls, subclass, species, gear } = cards;
  const mixed = species.length > 1;
  const any =
    cls !== null ||
    subclass !== null ||
    species.length > 0 ||
    gear.primary !== null ||
    gear.secondary !== null ||
    gear.armor !== null;
  if (!any) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cls !== null && (
        <GearCard label={`${cls.name}, the class`} corner="Class" name={cls.name}>
          <section aria-label="Hope feature" className="space-y-1">
            <h2 className="text-sm font-semibold">Hope feature</h2>
            <p className="text-sm whitespace-pre-line">
              <strong>{hopeFeatureLabel(cls.hopeFeature)}</strong>
              {cls.hopeFeature.text !== '' && `: ${cls.hopeFeature.text}`}
            </p>
          </section>
          <FeatureList title="Class features" features={cls.classFeatures} />
        </GearCard>
      )}
      {subclass !== null && (
        <GearCard
          label={`${subclass.name}, the subclass`}
          corner={`${subclass.className} subclass`}
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
        </GearCard>
      )}
      {species.map((one) => (
        <GearCard
          key={one.id}
          label={`${one.name}, ${mixed ? 'half of a mixed ancestry' : 'the species'}`}
          corner={mixed ? 'Mixed ancestry' : 'Species'}
          name={one.name}
        >
          <FeatureList title="Features" features={one.features} />
        </GearCard>
      ))}
      {gear.primary !== null && <WeaponView weapon={gear.primary} ruleset={ruleset} />}
      {gear.secondary !== null && <WeaponView weapon={gear.secondary} ruleset={ruleset} />}
      {gear.armor !== null && <ArmorView armor={gear.armor} ruleset={ruleset} />}
    </div>
  );
}

/** What moving cards can do: as the GM (free), as the PC's player (by the rules), or nothing. */
export interface CardActions {
  who: 'gm' | 'player';
  onMove: (cardId: string, to: 'loadout' | 'vault', swapOut?: string) => Promise<unknown>;
  onRemove?: (cardId: string) => Promise<unknown>;
}

/**
 * The loadout and the vault (§9 "Domain card loadout"). With `actions`, each card has Move and,
 * for the GM, Remove; a recall into a full loadout first asks which card goes to the vault.
 */
export function HeldCards({
  cards,
  loadoutMax,
  actions,
}: {
  cards: Pick<SheetCards, 'loadout' | 'vault'>;
  loadoutMax: number;
  actions?: CardActions;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalling, setRecalling] = useState<HeldCard | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const full = cards.loadout.length >= loadoutMax;
  const costOf = (card: HeldCard) =>
    actions?.who === 'gm' || card.recallCost === 0
      ? 'free'
      : `${String(card.recallCost)} Stress, free during Rest`;

  const list = (title: string, place: 'loadout' | 'vault', held: HeldCard[], empty: string) => (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-base font-semibold">
        {title}
        {place === 'loadout' && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {held.length} of {loadoutMax}
          </span>
        )}
      </h3>
      {held.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {held.map((card) => (
            <li key={card.id} className="space-y-2">
              <DomainCardView card={card} />
              {card.warning !== null && (
                <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
                  {card.warning}.
                </p>
              )}
              {actions !== undefined && (
                <div className="flex flex-wrap gap-2">
                  {place === 'loadout' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => actions.onMove(card.id, 'vault'))}
                    >
                      Put {card.name} in the vault
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (full) setRecalling(card);
                        else void run(() => actions.onMove(card.id, 'loadout'));
                      }}
                    >
                      Bring {card.name} to the loadout ({costOf(card)})
                    </Button>
                  )}
                  {actions.onRemove !== undefined && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        const remove = actions.onRemove;
                        if (remove !== undefined) void run(() => remove(card.id));
                      }}
                    >
                      Remove {card.name}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      {list('Loadout', 'loadout', cards.loadout, 'No cards in the loadout.')}
      {list('Vault', 'vault', cards.vault, 'The vault is empty.')}
      <FieldError message={error} />
      {recalling !== null && actions !== undefined && (
        <SwapDialog
          card={recalling}
          loadout={cards.loadout}
          cost={costOf(recalling)}
          onClose={() => {
            setRecalling(null);
          }}
          onSwap={async (swapOut) => {
            await actions.onMove(recalling.id, 'loadout', swapOut);
            setRecalling(null);
          }}
        />
      )}
    </div>
  );
}

/** A full loadout: which card goes to the vault to make room. */
function SwapDialog({
  card,
  loadout,
  cost,
  onClose,
  onSwap,
}: {
  card: HeldCard;
  loadout: HeldCard[];
  cost: string;
  onClose: () => void;
  onSwap: (swapOut: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make room for {card.name}</DialogTitle>
          <DialogDescription>
            The loadout is full. Pick a card to put in the vault. Bringing {card.name} back costs{' '}
            {cost}.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="sr-only">Card to put in the vault</legend>
          {loadout.map((held) => (
            <label key={held.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="swap-out"
                value={held.id}
                checked={choice === held.id}
                onChange={() => {
                  setChoice(held.id);
                }}
              />
              {held.name}
            </label>
          ))}
        </fieldset>
        <FieldError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={choice === null || busy}
            onClick={() => {
              if (choice === null) return;
              setBusy(true);
              setError(null);
              onSwap(choice).catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : 'That didn’t work.');
                setBusy(false);
              });
            }}
          >
            Swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
