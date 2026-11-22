import {
  completesMulticlass,
  levelUpEffects,
  levelUpProblem,
  levelUpState,
  rulesetFor,
  traitLabel,
  type Campaign,
  type ClassRecord,
  type ClassSummary,
  type DomainCardSummary,
  type LevelUpColumns,
  type LevelUpListOption,
  type LevelUpPick,
  type LevelUpRequest,
  type PlayerCharacterSheet,
} from '@stagehand/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { CardPreview } from '@/components/build/GuideSteps';
import { FieldError } from '@/components/FieldError';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useClass, useClasses, useDomainCards, useLevelUp } from '@/lib/queries';
import { characterPath } from '@/lib/records';

import {
  clearLevelUpDraft,
  loadLevelUpDraft,
  NEW_LEVEL_UP_DRAFT,
  saveLevelUpDraft,
  type LevelUpDraft,
} from './draft';

const STEPS = ['Options', 'Domain cards', 'Review'] as const;

/** An id no query asks for: what `useClass` gets for a sheet without a linked class. */
const NO_CLASS = '00000000-0000-4000-8000-000000000000';

const signedValue = (value: number) =>
  value > 0 ? `+${String(value)}` : value < 0 ? `−${String(-value)}` : '0';

/** The sheet as the guide reads it: the player's view, which the GM's also has. */
type LevelUpSheet = Pick<
  PlayerCharacterSheet,
  | 'id'
  | 'name'
  | 'level'
  | 'traits'
  | 'hpMax'
  | 'hpCurrent'
  | 'stressMax'
  | 'hopeBonus'
  | 'evasion'
  | 'proficiency'
  | 'minorThreshold'
  | 'majorThreshold'
  | 'severeThreshold'
  | 'links'
  | 'levelUp'
  | 'cards'
  | 'builtAt'
  | 'armor'
>;

/**
 * The level-up guide (F4.9, governance §9 "Leveling up", D-68): two options from the tier
 * lists, the new domain card (and an extra one, and a swap), and a review of every change, worked
 * out by the same shared rules the server checks with. The picks stay in this browser until
 * Finish sends them.
 */
export function LevelUpGuide({ campaign, sheet }: { campaign: Campaign; sheet: LevelUpSheet }) {
  const ruleset = rulesetFor(campaign.rulesetVersion);
  const view = campaign.role === 'gm' ? 'gm' : 'player';
  const navigate = useNavigate();
  const state = levelUpState(
    sheet.levelUp.history,
    sheet.level,
    ruleset,
    sheet.links.multiclassClassId !== null,
  );
  const [draft, setDraft] = useState<LevelUpDraft>(
    () => loadLevelUpDraft(sheet.id, state.nextLevel) ?? { ...NEW_LEVEL_UP_DRAFT, picks: [] },
  );
  const change = (patch: Partial<LevelUpDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  useEffect(() => {
    saveLevelUpDraft(sheet.id, state.nextLevel, draft);
  }, [sheet.id, state.nextLevel, draft]);

  const cls = useClass(campaign.id, sheet.links.classId ?? NO_CLASS).data;
  const classes = useClasses(campaign.id).data;
  const picked = useClass(campaign.id, draft.multiclassClassId ?? NO_CLASS).data;
  const secondClass = picked?.id === draft.multiclassClassId ? picked : null;
  const allCards = useDomainCards(campaign.id).data;
  const finish = useLevelUp(campaign.id, sheet.id, view);
  const domainIds = cls?.domains.map((domain) => domain?.id ?? null) ?? [];
  const held = [...sheet.cards.loadout, ...sheet.cards.vault];
  const heldIds = held.map((card) => card.id);
  const pickCount = ruleset.levelUpPicks ?? 2;
  const extraWanted = draft.picks.some((pick) => pick.option === 'domainCard');

  // Completing Multiclass picks a second class (F4.10).
  const completing = completesMulticlass(
    { picks: draft.picks, cardId: '', extraCardId: null, swap: null },
    state,
  );
  const second =
    completing !== null &&
    draft.multiclassClassId !== null &&
    draft.multiclassDomainId !== null &&
    draft.multiclassSubclassId !== null
      ? {
          classId: draft.multiclassClassId,
          domainId: draft.multiclassDomainId,
          subclassId: draft.multiclassSubclassId,
        }
      : null;
  const request: LevelUpRequest = {
    picks: draft.picks,
    cardId: draft.cardId ?? '',
    extraCardId: extraWanted ? draft.extraCardId : null,
    swap:
      draft.swapOutId !== null && draft.swapInId !== null
        ? { outId: draft.swapOutId, inId: draft.swapInId }
        : null,
    // Only a level-up completing Multiclass names a second class.
    ...(second === null ? {} : { multiclass: second }),
  };
  const multiclassDomainId = second?.domainId ?? sheet.links.multiclassDomainId;
  const context = {
    traits: sheet.traits,
    subclassCards: sheet.links.subclassId === null ? null : sheet.links.subclassCards,
    domainIds,
    cards: allCards ?? [],
    heldIds,
    classId: sheet.links.classId,
    classes: (classes ?? []).map((one) => ({
      id: one.id,
      name: one.name,
      domainIds: one.domains.map((domain) => domain?.id ?? null),
      subclassIds: secondClass?.id === one.id ? secondClass.subclasses.map((sub) => sub.id) : [],
    })),
    multiclass:
      sheet.links.multiclassClassId === null
        ? null
        : {
            domainId: sheet.links.multiclassDomainId,
            subclassId: sheet.links.multiclassSubclassId,
            subclassCards: sheet.links.multiclassSubclassCards,
          },
  };
  const fullProblem =
    allCards === undefined || cls == null
      ? 'Loading…'
      : draft.cardId === null
        ? 'Pick your new domain card'
        : levelUpProblem({ ...request, cardId: draft.cardId }, state, context, ruleset);

  const optionsProblem =
    draft.picks.length !== pickCount
      ? `Pick ${String(pickCount)} options (${String(draft.picks.length)} picked)`
      : draft.picks.some(
            (pick) =>
              pick.option === 'traits' &&
              (pick.traits === undefined ||
                pick.traits[0] === '' ||
                pick.traits[1] === '' ||
                pick.traits[0] === pick.traits[1]),
          )
        ? 'Pick two different traits to raise'
        : completing !== null && second === null
          ? 'Pick your second class, one of its domains and a subclass'
          : null;
  const cardsProblem =
    draft.cardId === null
      ? 'Pick your new domain card'
      : extraWanted && draft.extraCardId === null
        ? 'Pick your extra domain card'
        : (draft.swapOutId === null) !== (draft.swapInId === null)
          ? 'Pick both cards of the swap, or none'
          : null;
  const problems = [optionsProblem, cardsProblem, fullProblem];
  const step = Math.min(draft.step, STEPS.length - 1);
  const problem = problems[step] ?? null;
  const firstOpen = problems.findIndex((one) => one !== null);

  async function submit() {
    if (draft.cardId === null) return;
    try {
      await finish.mutateAsync({ ...request, cardId: draft.cardId });
      clearLevelUpDraft(sheet.id, state.nextLevel);
      void navigate(characterPath(campaign.id, sheet.id));
    } catch {
      // The refusal shows below the review.
    }
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((name, index) => (
            <li key={name}>
              <Button
                size="sm"
                variant={index === step ? 'default' : 'outline'}
                aria-current={index === step ? 'step' : undefined}
                disabled={firstOpen !== -1 && index > firstOpen}
                onClick={() => {
                  change({ step: index });
                }}
              >
                {index + 1}. {name}
              </Button>
            </li>
          ))}
        </ol>
      </nav>

      {state.entersTier && (
        <p className="rounded-md border border-amber-500/60 bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/40">
          Level {state.nextLevel} starts tier {state.nextTier}: proficiency +
          {ruleset.proficiency?.perTier ?? 1}, and trait marks are cleared.
          {state.losing.length > 0 &&
            ` Half-marked options from tier ${String(state.tier)} are lost unless you finish them now.`}
        </p>
      )}

      <section aria-labelledby="level-up-step" className="space-y-4">
        <h2 id="level-up-step" className="text-xl font-semibold">
          {STEPS[step]}
        </h2>
        {step === 0 && (
          <>
            <OptionsStep
              lists={state.lists}
              picks={draft.picks}
              pickCount={pickCount}
              markedTraits={state.markedTraits}
              traits={sheet.traits}
              ruleset={ruleset}
              subclassNames={{
                main: sheet.cards.subclass?.name ?? null,
                multiclass: sheet.cards.multiclass?.subclass?.name ?? null,
              }}
              onChange={(picks) => {
                change({ picks });
              }}
            />
            {completing !== null && (
              <MulticlassChoice
                classes={classes ?? []}
                ownClassId={sheet.links.classId}
                ownDomainIds={domainIds}
                second={secondClass}
                draft={draft}
                change={change}
              />
            )}
          </>
        )}
        {step === 1 && (
          <CardsStep
            campaignId={campaign.id}
            draft={draft}
            change={change}
            nextLevel={state.nextLevel}
            cards={allCards}
            domainIds={domainIds}
            multiclassDomainId={multiclassDomainId}
            held={held}
            heldIds={heldIds}
            extraWanted={extraWanted}
          />
        )}
        {step === 2 && fullProblem === null && draft.cardId !== null && (
          <Review
            ruleset={ruleset}
            sheet={sheet}
            request={{ ...request, cardId: draft.cardId }}
            state={state}
            names={(id) => allCards?.find((card) => card.id === id)?.name ?? ''}
            secondClass={
              second === null || secondClass === null
                ? null
                : [
                    secondClass.name,
                    secondClass.domains.find((domain) => domain?.id === second.domainId)?.name,
                    secondClass.subclasses.find((sub) => sub.id === second.subclassId)?.name,
                  ]
                    .filter((part) => part !== undefined)
                    .join(', ')
            }
          />
        )}
      </section>

      {problem !== null && <p className="text-sm text-muted-foreground">{problem}</p>}
      <FieldError message={finish.error?.message ?? null} />

      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={step === 0}
          onClick={() => {
            change({ step: step - 1 });
          }}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            disabled={problem !== null}
            onClick={() => {
              change({ step: step + 1 });
            }}
          >
            Next
          </Button>
        ) : (
          <Button disabled={fullProblem !== null || finish.isPending} onClick={() => void submit()}>
            {finish.isPending ? 'Levelling up…' : `Level up to ${String(state.nextLevel)}`}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Marks as boxes: filled for marks made, empty for those left, crossed for one lost. */
function MarkBoxes({ option }: { option: LevelUpListOption }) {
  return (
    <span aria-hidden className="flex gap-0.5">
      {Array.from({ length: option.total }, (_, index) => (
        <span
          key={index}
          className={`inline-block size-3.5 rounded-sm border ${
            index < option.used
              ? 'border-stone-700 bg-stone-700'
              : index < option.used + option.left
                ? 'border-stone-500'
                : 'border-stone-300 bg-stone-200'
          }`}
        />
      ))}
    </span>
  );
}

/** Step 1: two picks from the tier lists. */
function OptionsStep({
  lists,
  picks,
  pickCount,
  markedTraits,
  traits,
  ruleset,
  subclassNames,
  onChange,
}: {
  /** The subclasses a subclass pick may upgrade; `multiclass` null without a second (F4.10). */
  subclassNames: { main: string | null; multiclass: string | null };
  lists: ReturnType<typeof levelUpState>['lists'];
  picks: LevelUpPick[];
  pickCount: number;
  markedTraits: readonly string[];
  traits: Record<string, number>;
  ruleset: ReturnType<typeof rulesetFor>;
  onChange: (picks: LevelUpPick[]) => void;
}) {
  const takenOf = (tier: number, option: string) =>
    picks.filter((pick) => pick.tier === tier && pick.option === option).length;
  const traitsTaken = picks.flatMap((pick) => pick.traits ?? []);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Pick {pickCount} options, from your tier&apos;s list or a lower one. Each box is one mark:
        filled boxes are taken. A two-mark option applies once both its boxes are marked in the same
        tier: take it twice now, or once now and once at a later level-up in this tier.
      </p>
      {lists.map((list) => (
        <section
          key={list.tier}
          aria-label={`Tier ${String(list.tier)} options`}
          className="space-y-2"
        >
          <h3 className="font-semibold">Tier {list.tier}</h3>
          <ul className="space-y-1.5">
            {list.options.map((option) => {
              const taken = takenOf(list.tier, option.id);
              const full = picks.length >= pickCount;
              const blocked = !option.pickable || full || taken >= option.left;
              return (
                <li key={option.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <MarkBoxes option={option} />
                  <span className="min-w-0 flex-1">
                    {option.label}
                    {option.halfMarked && (
                      <span className="ml-2 text-xs text-amber-700">
                        (half marked: this pick completes it)
                      </span>
                    )}
                    {option.crossedOut && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (crossed out by multiclassing)
                      </span>
                    )}
                    {option.lost && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (a half mark was lost)
                      </span>
                    )}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={blocked}
                    aria-label={`Take ${option.label} from tier ${String(list.tier)}`}
                    onClick={() => {
                      onChange([
                        ...picks,
                        option.id === 'traits'
                          ? { tier: list.tier, option: option.id, traits: ['', ''] }
                          : { tier: list.tier, option: option.id },
                      ]);
                    }}
                  >
                    Take
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section aria-label="Your picks" className="space-y-2">
        <h3 className="font-semibold">
          Your picks ({picks.length} of {pickCount})
        </h3>
        {picks.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <ul className="space-y-3">
          {picks.map((pick, index) => {
            const label =
              lists
                .find((list) => list.tier === pick.tier)
                ?.options.find((one) => one.id === pick.option)?.label ?? pick.option;
            return (
              <li key={index} className="space-y-2 rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    Tier {pick.tier}: {label}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      onChange(picks.filter((_, at) => at !== index));
                    }}
                  >
                    Remove
                  </Button>
                </div>
                {pick.option === 'subclass' && subclassNames.multiclass !== null && (
                  <div className="max-w-sm space-y-1">
                    <Label htmlFor={`level-up-subclass-${String(index)}`}>
                      Upgrade which subclass
                    </Label>
                    <NativeSelect
                      id={`level-up-subclass-${String(index)}`}
                      value={pick.target ?? 'main'}
                      onChange={(event) => {
                        const target = event.target.value === 'multiclass' ? 'multiclass' : 'main';
                        onChange(picks.map((one, at) => (at === index ? { ...one, target } : one)));
                      }}
                    >
                      <option value="main">{subclassNames.main ?? 'Your subclass'}</option>
                      <option value="multiclass">{subclassNames.multiclass} (multiclass)</option>
                    </NativeSelect>
                  </div>
                )}
                {pick.option === 'traits' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([0, 1] as const).map((slot) => (
                      <div key={slot} className="space-y-1">
                        <Label htmlFor={`level-up-trait-${String(index)}-${String(slot)}`}>
                          {slot === 0 ? 'First trait' : 'Second trait'}
                        </Label>
                        <NativeSelect
                          id={`level-up-trait-${String(index)}-${String(slot)}`}
                          value={pick.traits?.[slot] ?? ''}
                          onChange={(event) => {
                            const chosen: [string, string] = [...(pick.traits ?? ['', ''])];
                            chosen[slot] = event.target.value;
                            onChange(
                              picks.map((one, at) =>
                                at === index ? { ...one, traits: chosen } : one,
                              ),
                            );
                          }}
                        >
                          <option value="">Pick a trait</option>
                          {ruleset.traits.map((trait) => {
                            const value = traits[trait.id] ?? 0;
                            const unavailable =
                              markedTraits.includes(trait.id) ||
                              (traitsTaken.includes(trait.id) &&
                                pick.traits?.[slot] !== trait.id) ||
                              value >= ruleset.traitModifier.max;
                            return (
                              <option key={trait.id} value={trait.id} disabled={unavailable}>
                                {traitLabel(ruleset, trait.id)} {signedValue(value)}
                                {markedTraits.includes(trait.id) ? ' (marked)' : ''}
                              </option>
                            );
                          })}
                        </NativeSelect>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * Completing Multiclass (F4.10): another class, one of its two domains the PC hasn't, and one of
 * its subclasses, whose foundation the PC takes.
 */
function MulticlassChoice({
  classes,
  ownClassId,
  ownDomainIds,
  second,
  draft,
  change,
}: {
  classes: ClassSummary[];
  ownClassId: string | null;
  ownDomainIds: (string | null)[];
  second: ClassRecord | null;
  draft: LevelUpDraft;
  change: (patch: Partial<LevelUpDraft>) => void;
}) {
  const domains = (second?.domains ?? []).flatMap((domain) => (domain === null ? [] : [domain]));
  return (
    <section aria-label="Multiclass" className="space-y-3 rounded-md border px-4 py-3">
      <h3 className="font-semibold">Your second class</h3>
      <p className="text-sm text-muted-foreground">
        You gain its class features, one of its domains, and the foundation of one of its
        subclasses.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="level-up-multiclass-class">Second class</Label>
          <NativeSelect
            id="level-up-multiclass-class"
            value={draft.multiclassClassId ?? ''}
            onChange={(event) => {
              change({
                multiclassClassId: event.target.value === '' ? null : event.target.value,
                multiclassDomainId: null,
                multiclassSubclassId: null,
              });
            }}
          >
            <option value="">Pick a class</option>
            {classes
              .filter((one) => one.id !== ownClassId)
              .map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="level-up-multiclass-domain">Its domain</Label>
          <NativeSelect
            id="level-up-multiclass-domain"
            value={draft.multiclassDomainId ?? ''}
            disabled={second === null}
            onChange={(event) => {
              change({ multiclassDomainId: event.target.value === '' ? null : event.target.value });
            }}
          >
            <option value="">Pick a domain</option>
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id} disabled={ownDomainIds.includes(domain.id)}>
                {domain.name}
                {ownDomainIds.includes(domain.id) ? ' (already yours)' : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="level-up-multiclass-subclass">Its subclass</Label>
          <NativeSelect
            id="level-up-multiclass-subclass"
            value={draft.multiclassSubclassId ?? ''}
            disabled={second === null}
            onChange={(event) => {
              change({
                multiclassSubclassId: event.target.value === '' ? null : event.target.value,
              });
            }}
          >
            <option value="">Pick a subclass</option>
            {(second?.subclasses ?? []).map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
    </section>
  );
}

/** Step 2: the new card, an extra card with its option, and an optional swap. */
function CardsStep({
  campaignId,
  draft,
  change,
  nextLevel,
  cards,
  domainIds,
  multiclassDomainId,
  held,
  heldIds,
  extraWanted,
}: {
  /** The multiclass domain, whose cards go up to half the level, rounded up (F4.10). */
  multiclassDomainId: string | null;
  campaignId: string;
  draft: LevelUpDraft;
  change: (patch: Partial<LevelUpDraft>) => void;
  nextLevel: number;
  cards: DomainCardSummary[] | undefined;
  domainIds: (string | null)[];
  held: { id: string; name: string; level: number }[];
  heldIds: string[];
  extraWanted: boolean;
}) {
  if (cards === undefined) return <p className="text-muted-foreground">Loading cards…</p>;
  const multiLimit = Math.ceil(nextLevel / 2);
  const fits = (card: DomainCardSummary, maxLevel: number) =>
    domainIds.includes(card.domainId)
      ? card.level <= maxLevel
      : card.domainId === multiclassDomainId && card.level <= Math.min(maxLevel, multiLimit);
  const open = (maxLevel: number, except: (string | null)[]) =>
    cards
      .filter(
        (card) => fits(card, maxLevel) && !heldIds.includes(card.id) && !except.includes(card.id),
      )
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  const newCards = open(nextLevel, [draft.extraCardId, draft.swapInId]);
  const extraCards = open(nextLevel, [draft.cardId, draft.swapInId]);
  const out = held.find((card) => card.id === draft.swapOutId);
  const swapCards = out === undefined ? [] : open(out.level, [draft.cardId, draft.extraCardId]);

  const choose = (
    name: string,
    options: DomainCardSummary[],
    value: string | null,
    onPick: (cardId: string) => void,
  ) =>
    options.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        No cards of your class&apos;s domains fit. Ask your GM to add some.
      </p>
    ) : (
      <ul className="grid gap-4 md:grid-cols-2">
        {options.map((card) => (
          <li key={card.id} className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="radio"
                name={name}
                checked={value === card.id}
                onChange={() => {
                  onPick(card.id);
                }}
              />
              Take {card.name} (level {card.level})
            </label>
            <CardPreview campaignId={campaignId} card={card} />
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-6">
      <section aria-label="New card" className="space-y-2">
        <h3 className="font-semibold">Your new card</h3>
        <p className="text-sm text-muted-foreground">
          One card of level {nextLevel} or lower from your class&apos;s domains. It goes in your
          loadout if there is room, otherwise your vault.
          {multiclassDomainId !== null &&
            ` Cards from your multiclass domain go up to level ${String(multiLimit)}: half your level, rounded up.`}
        </p>
        {choose('level-up-card', newCards, draft.cardId, (cardId) => {
          change({ cardId });
        })}
      </section>

      {extraWanted && (
        <section aria-label="Extra card" className="space-y-2">
          <h3 className="font-semibold">Your extra card</h3>
          {choose('level-up-extra', extraCards, draft.extraCardId, (extraCardId) => {
            change({ extraCardId });
          })}
        </section>
      )}

      <section aria-label="Swap a card" className="space-y-2">
        <h3 className="font-semibold">Swap a card (optional)</h3>
        <p className="text-sm text-muted-foreground">
          Trade a card you hold for another of the same level or lower.
        </p>
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="level-up-swap-out">Card to give up</Label>
          <NativeSelect
            id="level-up-swap-out"
            value={draft.swapOutId ?? ''}
            onChange={(event) => {
              change({
                swapOutId: event.target.value === '' ? null : event.target.value,
                swapInId: null,
              });
            }}
          >
            <option value="">No swap</option>
            {held.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name} (level {card.level})
              </option>
            ))}
          </NativeSelect>
        </div>
        {out !== undefined &&
          choose('level-up-swap-in', swapCards, draft.swapInId, (swapInId) => {
            change({ swapInId });
          })}
      </section>
    </div>
  );
}

/** Step 3: every change, before and after, as the server will make it. */
function Review({
  sheet,
  request,
  state,
  names,
  ruleset,
  secondClass,
}: {
  sheet: LevelUpSheet;
  request: LevelUpRequest;
  state: ReturnType<typeof levelUpState>;
  names: (cardId: string) => string;
  ruleset: ReturnType<typeof rulesetFor>;
  /** "Ranger, Bone, Beastbound": the second class taken now (F4.10). */
  secondClass: string | null;
}) {
  const before: LevelUpColumns = {
    level: sheet.level,
    traits: sheet.traits,
    hpMax: sheet.hpMax,
    hpCurrent: sheet.hpCurrent,
    stressMax: sheet.stressMax,
    hopeBonus: sheet.hopeBonus,
    evasion: sheet.evasion,
    proficiency: sheet.proficiency,
    subclassCards: sheet.links.subclassCards,
    minorThreshold: sheet.minorThreshold,
    majorThreshold: sheet.majorThreshold,
    severeThreshold: sheet.severeThreshold,
    multiclassSubclassCards: sheet.links.multiclassSubclassCards,
  };
  const typed = sheet.links.armorId === null && !(sheet.builtAt !== null && sheet.armor === null);
  const after = levelUpEffects(request, state, before, typed, ruleset);
  const rows: [string, string, string][] = [
    ['Level', String(before.level), String(after.level)],
    ['Proficiency', String(before.proficiency), String(after.proficiency)],
    ['HP slots', String(before.hpMax), String(after.hpMax)],
    ['Stress slots', String(before.stressMax), String(after.stressMax)],
    ['Evasion', String(before.evasion), String(after.evasion)],
    ['Hope bonus', `+${String(before.hopeBonus)}`, `+${String(after.hopeBonus)}`],
    ['Subclass cards', String(before.subclassCards), String(after.subclassCards)],
    [
      'Multiclass subclass cards',
      String(sheet.links.multiclassSubclassId === null ? 0 : before.multiclassSubclassCards),
      String(sheet.links.multiclassSubclassId === null ? 0 : after.multiclassSubclassCards),
    ],
    ...ruleset.traits.map((trait): [string, string, string] => [
      traitLabel(ruleset, trait.id),
      signedValue(before.traits[trait.id] ?? 0),
      signedValue(after.traits[trait.id] ?? 0),
    ]),
  ];
  const changed = rows.filter(([, from, to]) => from !== to);
  const cards = [
    `New: ${names(request.cardId)}`,
    ...(request.extraCardId === null ? [] : [`Extra: ${names(request.extraCardId)}`]),
    ...(request.swap === null
      ? []
      : [`Swap: ${names(request.swap.outId)} for ${names(request.swap.inId)}`]),
  ];
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
        {changed.map(([label, from, to]) => (
          <div key={label} className="contents">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-medium">
              {from} → {to}
            </dd>
          </div>
        ))}
        {secondClass !== null && (
          <div className="contents">
            <dt className="text-sm text-muted-foreground">Second class</dt>
            <dd className="font-medium">{secondClass}</dd>
          </div>
        )}
        <div className="contents">
          <dt className="text-sm text-muted-foreground">Thresholds</dt>
          <dd className="font-medium">+1 each, with the level</dd>
        </div>
        <div className="contents">
          <dt className="text-sm text-muted-foreground">Domain cards</dt>
          <dd className="font-medium">{cards.join(' · ')}</dd>
        </div>
      </dl>
    </div>
  );
}
