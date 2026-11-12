import type {
  Campaign,
  CommitImportResponse,
  ImportDetail,
  ImportProposal,
  RecordSummary,
} from '@stagehand/shared';
import { AI_IMPORT_LIMITS } from '@stagehand/shared';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  formatTokens,
  formatUsd,
  formatWhen,
  groupProposals,
  importPath,
  plural,
  reviewCounts,
  totalTokens,
} from '@/lib/ai-import';
import {
  useAcceptAllProposals,
  useAnswerImportQuestions,
  useCommitImport,
  useDiscardImport,
  useGenerateImportRecords,
  useRetryImport,
} from '@/lib/queries';
import { recordPath } from '@/lib/records';

import { ProposalCard } from './ProposalCard';
import { proposedSummary, ReviewContext, type Review } from './review-context';

/** While the model works: the page polls (`useImport`), so this just reassures. */
export function RunningImport({ detail }: { detail: ImportDetail }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const startedAt = detail.stepStartedAt ?? detail.createdAt;
  const seconds = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  const elapsed = `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="space-y-4">
      <EarlierAnswers conversation={detail.conversation} />
      <Card>
        <CardContent className="space-y-2 pt-6" role="status">
          <p className="font-medium">
            {detail.phase === 'questions'
              ? 'Claude is reading your notes and thinking of questions…'
              : 'Claude is writing the records…'}
          </p>
          <p className="text-sm text-muted-foreground">
            This can take a few minutes ({elapsed} so far). You can leave this page and come back:
            the import keeps running, and this page fills in when it is ready.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** The rounds of questions the GM has already answered, folded away (D-30). */
export function EarlierAnswers({ conversation }: { conversation: ImportDetail['conversation'] }) {
  if (conversation.length === 0) return null;
  return (
    <details className="rounded-md border px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Your earlier answers ({plural(conversation.length, 'round')})
      </summary>
      <ol className="mt-3 space-y-4">
        {conversation.map((round, index) => (
          <li key={index} className="space-y-1">
            <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
              {round.questions.map((question, at) => (
                <li key={at}>{question}</li>
              ))}
            </ul>
            {round.answer === null ? (
              <p className="italic text-muted-foreground">Not answered.</p>
            ) : (
              <p className="whitespace-pre-wrap">{round.answer}</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The model's questions, before any records (D-30): the GM answers them, which may bring more
 * questions, or goes on to the records. One step of the import is always kept for those.
 */
export function QuestionsStep({ campaign, detail }: { campaign: Campaign; detail: ImportDetail }) {
  const answer = useAnswerImportQuestions(campaign.id, detail.id);
  const generate = useGenerateImportRecords(campaign.id, detail.id);
  const discard = useDiscardImport(campaign.id, detail.id);
  const [text, setText] = useState('');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const fieldId = useId();

  const readOnly = campaign.archivedAt !== null;
  const busy = answer.isPending || generate.isPending || discard.isPending;
  const tooLong = text.length > AI_IMPORT_LIMITS.answerMaxChars;
  const roundsLeft = detail.steps < AI_IMPORT_LIMITS.stepsPerImport - 1;
  const error = answer.error ?? generate.error ?? discard.error;

  return (
    <div className="space-y-4">
      <EarlierAnswers conversation={detail.conversation} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">Claude&apos;s questions</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal space-y-1 pl-6 text-sm">
            {detail.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ol>
          {!readOnly && (
            <>
              <div className="space-y-2">
                <Label htmlFor={fieldId}>Your answers</Label>
                <Textarea
                  id={fieldId}
                  className="min-h-32"
                  value={text}
                  disabled={busy}
                  aria-describedby={`${fieldId}-hint`}
                  placeholder="Answer in any order, and skip what doesn't matter."
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                />
                <p
                  id={`${fieldId}-hint`}
                  className={`text-xs ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {formatTokens(text.length)} / {formatTokens(AI_IMPORT_LIMITS.answerMaxChars)}{' '}
                  characters.{' '}
                  {roundsLeft
                    ? 'Submit your answers and Claude may ask more, or generate the records now; anything in the box goes along.'
                    : 'This import has room for one more step: generate the records now.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || tooLong || !roundsLeft || text.trim() === ''}
                  onClick={() => {
                    answer.mutate(text.trim());
                  }}
                >
                  Submit answers
                </Button>
                <Button
                  size="sm"
                  disabled={busy || tooLong}
                  onClick={() => {
                    generate.mutate(text.trim());
                  }}
                >
                  Generate records
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingDiscard(true);
                  }}
                >
                  Discard
                </Button>
              </div>
            </>
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title="Discard this import?"
        description="Nothing from it will be saved. It stays in the list of past imports."
        confirmLabel="Discard"
        onConfirm={() => discard.mutateAsync()}
      />
    </div>
  );
}

/** A failed import: why, the raw problems (§10 step 4), and a way to try again. */
export function FailedImport({ detail }: { detail: ImportDetail }) {
  const discard = useDiscardImport(detail.campaignId, detail.id);
  const retry = useRetryImport(detail.campaignId, detail.id);
  const error = detail.error;
  const busy = discard.isPending || retry.isPending;
  const actionError = retry.error ?? discard.error;
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <EarlierAnswers conversation={detail.conversation} />
        <p role="alert" className="font-medium text-destructive">
          {error?.message ?? 'This import failed.'}
        </p>
        {error !== null && error.details.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              What went wrong ({plural(error.details.length, 'problem')})
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-6 font-mono text-xs">
              {error.details.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-sm text-muted-foreground">Nothing was saved.</p>
        <div className="flex flex-wrap gap-2">
          {detail.status === 'failed' && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                retry.mutate(undefined);
              }}
            >
              Try again
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to={importPath(detail.campaignId, { from: detail.id })}>
              Edit notes and start over
            </Link>
          </Button>
          {detail.status === 'failed' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                discard.mutate();
              }}
            >
              Discard
            </Button>
          )}
        </div>
        {actionError !== null && (
          <p role="alert" className="text-sm text-destructive">
            {actionError.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** What a commit saved, with links to the records it made or changed. */
function CommitResult({
  result,
  campaignId,
}: {
  result: CommitImportResponse;
  campaignId: string;
}) {
  const list = (refs: CommitImportResponse['created']) => (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {refs.map((ref) => (
        <li key={ref.id}>
          <Link to={recordPath(campaignId, ref.id)} className="underline">
            {ref.name}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <Card role="status" aria-label="Saved">
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg">Saved</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {result.created.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Created {plural(result.created.length, 'record')}</p>
            {list(result.created)}
          </div>
        )}
        {result.updated.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Changed {plural(result.updated.length, 'record')}</p>
            {list(result.updated)}
          </div>
        )}
        {result.linksAdded > 0 && <p>Added {plural(result.linksAdded, 'link')}.</p>}
        {result.skipped.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Skipped {plural(result.skipped.length, 'proposal')}</p>
            <ul className="list-disc pl-6">
              {result.skipped.map((skip) => (
                <li key={skip.proposalId}>{skip.reason}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  proposals,
  children,
}: {
  title: string;
  proposals: readonly ImportProposal[];
  children: ReactNode;
}) {
  if (proposals.length === 0) return null;
  const counts = reviewCounts(proposals);
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="flex flex-wrap items-baseline gap-2 text-xl font-semibold">
        {title}
        <span className="text-sm font-normal text-muted-foreground">
          {proposals.length} · {counts.accepted} accepted · {counts.pending} pending
        </span>
      </h2>
      {children}
    </section>
  );
}

/**
 * The review (§10 step 5): the model's questions, then the proposals grouped by kind, with
 * Accept all, Save accepted and Discard. Saved and discarded imports show read-only.
 */
export function ImportReview({
  campaign,
  detail,
  records,
}: {
  campaign: Campaign;
  detail: ImportDetail;
  records: RecordSummary[];
}) {
  const acceptAll = useAcceptAllProposals(campaign.id, detail.id);
  const commit = useCommitImport(campaign.id, detail.id);
  const discard = useDiscardImport(campaign.id, detail.id);
  const [confirming, setConfirming] = useState<'save' | 'discard' | null>(null);

  const readOnly = detail.status !== 'ready' || campaign.archivedAt !== null;
  const review = useMemo<Review>(() => {
    const proposed = Object.values(detail.refs)
      .filter((ref) => ref.proposed)
      .map(proposedSummary);
    const byId = new Map(
      [...records, ...proposed].map((summary) => [summary.id, summary] as const),
    );
    const areas = [...records, ...proposed]
      .filter((summary) => summary.type === 'area')
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      campaignId: campaign.id,
      importId: detail.id,
      refs: detail.refs,
      records,
      byId,
      areas,
      readOnly,
    };
  }, [campaign.id, detail.id, detail.refs, records, readOnly]);

  const groups = groupProposals(detail.proposals);
  const counts = reviewCounts(detail.proposals);
  const busy = acceptAll.isPending || commit.isPending || discard.isPending;
  const actionError =
    acceptAll.error ?? (confirming === null ? commit.error : null) ?? discard.error;

  const empty = detail.proposals.length === 0;

  return (
    <ReviewContext.Provider value={review}>
      <div className="space-y-6">
        {commit.isSuccess && !empty && (
          <CommitResult result={commit.data} campaignId={campaign.id} />
        )}

        <EarlierAnswers conversation={detail.conversation} />

        {detail.status === 'committed' && !commit.isSuccess && !empty && (
          <p className="rounded-md border bg-muted px-4 py-3 text-sm">
            Saved {detail.committedAt === null ? '' : formatWhen(detail.committedAt)}. The cards
            below show what was proposed and what you decided.
          </p>
        )}
        {detail.status === 'discarded' && (
          <p className="rounded-md border bg-muted px-4 py-3 text-sm">
            Discarded. Nothing from this import was saved.
          </p>
        )}

        {detail.questions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-lg">Claude&apos;s questions</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-6 text-sm">
                {detail.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                {detail.phase === 'questions'
                  ? 'This import was discarded before Claude wrote any records.'
                  : 'Claude left these open. Settle them by editing the cards, or in a later import.'}
              </p>
            </CardContent>
          </Card>
        )}

        {empty &&
          (detail.status === 'committed' ? (
            <p role="status" className="rounded-md border bg-muted px-4 py-3 text-sm">
              Closed. Nothing needed saving.
            </p>
          ) : detail.status === 'ready' ? (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <p>Claude found nothing to add or change from these notes.</p>
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        commit.mutate();
                      }}
                    >
                      Close import
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setConfirming('discard');
                      }}
                    >
                      Discard
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : detail.phase === 'records' ? (
            <p className="text-muted-foreground">Claude proposed nothing for these notes.</p>
          ) : null)}

        {!readOnly && !empty && (
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
            <p className="text-sm" role="status">
              {counts.accepted} accepted · {counts.rejected} rejected · {counts.pending} pending
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || counts.pending === 0}
                onClick={() => {
                  acceptAll.mutate();
                }}
              >
                Accept all
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  commit.reset();
                  if (counts.pending > 0) setConfirming('save');
                  else commit.mutate();
                }}
              >
                Save accepted
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setConfirming('discard');
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        )}
        {actionError !== null && (
          <p role="alert" className="text-sm text-destructive">
            {actionError.message}
          </p>
        )}

        <Section title="New records" proposals={groups.creates}>
          {groups.creates.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </Section>
        <Section title="Changes to existing records" proposals={groups.updates}>
          {groups.updates.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </Section>
        <Section title="Links" proposals={groups.links}>
          {groups.links.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </Section>

        <p className="text-xs text-muted-foreground">
          {formatTokens(totalTokens(detail.usage))} tokens ({formatTokens(detail.usage.inputTokens)}{' '}
          in, {formatTokens(detail.usage.outputTokens)} out) · about{' '}
          {formatUsd(detail.estimatedCostUsd)} · {detail.model} · prompt v{detail.promptVersion}
          {detail.attempts > 1 ? ' · answered on the second try' : ''}
        </p>
      </div>

      <ConfirmDialog
        open={confirming === 'save'}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Save the accepted proposals?"
        description={`${plural(counts.pending, 'proposal is', 'proposals are')} still pending and won't be saved. ${plural(counts.accepted, 'accepted proposal')} will be saved.`}
        confirmLabel="Save accepted"
        onConfirm={() => commit.mutateAsync()}
      />
      <ConfirmDialog
        open={confirming === 'discard'}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Discard this import?"
        description="Nothing from it will be saved. It stays in the list of past imports."
        confirmLabel="Discard"
        onConfirm={() => discard.mutateAsync()}
      />
    </ReviewContext.Provider>
  );
}
