import { AiUsageCard } from '@/components/settings/AiUsageCard';
import { ProviderKeyCard } from '@/components/settings/ProviderKeyCard';
import { useProviderCredentials } from '@/lib/queries';

/**
 * Account-level settings: the GM's own AI provider keys, Anthropic for AI import (F1.7) and
 * OpenRouter for visuals (F2.2), and what AI import has cost.
 */
export function SettingsPage() {
  const credentials = useProviderCredentials();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section aria-label="AI keys" className="space-y-3">
        {credentials.isPending && <p className="text-muted-foreground">Loading…</p>}
        {credentials.isError && (
          <p role="alert" className="text-destructive">
            Could not load your keys: {credentials.error.message}
          </p>
        )}
        {credentials.isSuccess && (
          <>
            <ProviderKeyCard
              provider="anthropic"
              credential={credentials.data.find((c) => c.provider === 'anthropic')}
            />
            <ProviderKeyCard
              provider="openrouter"
              credential={credentials.data.find((c) => c.provider === 'openrouter')}
            />
          </>
        )}
      </section>
      <AiUsageCard />
    </div>
  );
}
