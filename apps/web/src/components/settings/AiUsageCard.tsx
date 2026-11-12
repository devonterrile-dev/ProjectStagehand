import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  formatTokens,
  formatUsd,
  formatWhen,
  IMPORT_MODE_LABELS,
  IMPORT_STATUS_LABELS,
  plural,
  totalTokens,
} from '@/lib/ai-import';
import { useUsage } from '@/lib/queries';

/**
 * The GM's AI import usage (§10 cost guardrails): totals, then each import with its tokens
 * and cost at the listed prices. Anthropic's Console has the real bill.
 */
export function AiUsageCard() {
  const usage = useUsage();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg">AI import usage</h2>
        </CardTitle>
        <CardDescription>
          Tokens and estimated cost of your imports, at Anthropic&apos;s list prices. Your Anthropic
          Console has the real bill.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage.isPending && <p className="text-muted-foreground">Loading…</p>}
        {usage.isError && (
          <p role="alert" className="text-destructive">
            Could not load your usage: {usage.error.message}
          </p>
        )}
        {usage.isSuccess && usage.data.totals.imports === 0 && (
          <p className="text-sm text-muted-foreground">No imports yet.</p>
        )}
        {usage.isSuccess && usage.data.totals.imports > 0 && (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Imports</dt>
                <dd className="font-medium">{formatTokens(usage.data.totals.imports)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tokens in</dt>
                <dd className="font-medium">
                  {formatTokens(
                    usage.data.totals.usage.inputTokens +
                      usage.data.totals.usage.cacheReadTokens +
                      usage.data.totals.usage.cacheWriteTokens,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tokens out</dt>
                <dd className="font-medium">
                  {formatTokens(usage.data.totals.usage.outputTokens)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Estimated cost</dt>
                <dd className="font-medium">{formatUsd(usage.data.totals.estimatedCostUsd)}</dd>
              </div>
            </dl>
            <ul className="divide-y border-t text-sm">
              {usage.data.imports.map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {formatWhen(row.createdAt)} · {row.campaignName} ·{' '}
                    {IMPORT_MODE_LABELS[row.mode]} ·{' '}
                    <span className="text-muted-foreground">
                      {IMPORT_STATUS_LABELS[row.status]}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {formatTokens(totalTokens(row.usage))} tokens ·{' '}
                    {formatUsd(row.estimatedCostUsd)}
                  </span>
                </li>
              ))}
            </ul>
            {usage.data.totals.imports > usage.data.imports.length && (
              <p className="text-xs text-muted-foreground">
                Showing the newest {plural(usage.data.imports.length, 'import')}; the totals count
                them all.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
