import { AiUsageCard } from '@/components/settings/AiUsageCard';
import { AnthropicKeyCard } from '@/components/settings/AnthropicKeyCard';
import { useProviderCredentials } from '@/lib/queries';

/** Account-level settings (F1.7): for now, the GM's own AI provider keys. */
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
          <AnthropicKeyCard
            credential={credentials.data.find((credential) => credential.provider === 'anthropic')}
          />
        )}
      </section>
      <AiUsageCard />
    </div>
  );
}
