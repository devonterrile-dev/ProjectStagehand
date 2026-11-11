import { anthropicApiKeySchema, type ProviderCredential } from '@stagehand/shared';
import { useState, type SubmitEvent } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeleteAnthropicKey, useSaveAnthropicKey } from '@/lib/queries';

export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The GM's Anthropic key (F1.7). The key is read straight from the form on submit and the
 * field is cleared afterwards, so it never sits in React state; afterwards only the last
 * four characters are shown, which is all the server ever sends back.
 */
export function AnthropicKeyCard({ credential }: { credential: ProviderCredential | undefined }) {
  const save = useSaveAnthropicKey();
  const remove = useDeleteAnthropicKey();
  const [replacing, setReplacing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const showForm = credential === undefined || replacing;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = new FormData(form).get('apiKey');
    const parsed = anthropicApiKeySchema.safeParse(typeof raw === 'string' ? raw : '');
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That is not an Anthropic API key');
      return;
    }
    setError(null);
    setSaved(false);
    save.mutate(parsed.data, {
      onSuccess: () => {
        setReplacing(false);
        setSaved(true);
      },
      onError: (saveError) => {
        setError(saveError.message);
      },
      onSettled: () => {
        // Drop the key from the field and from the mutation's remembered variables.
        form.reset();
        save.reset();
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg">Anthropic API key</h2>
        </CardTitle>
        <CardDescription>
          AI import (turning your notes into records) runs on your own Anthropic account, so you pay
          Anthropic directly for what you use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {credential !== undefined && (
          <div className="space-y-3">
            <p>
              Key ending in <span className="font-mono">…{credential.lastFour}</span>, added{' '}
              {dateFormat.format(new Date(credential.createdAt))}.
            </p>
            {saved && error === null && (
              <p role="status" className="text-sm text-muted-foreground">
                Saved. Anthropic accepted the key.
              </p>
            )}
            {!replacing && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setReplacing(true);
                    setSaved(false);
                    setError(null);
                  }}
                >
                  Replace key
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirmingRemove(true);
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        )}

        {showForm && (
          <form className="space-y-2" onSubmit={handleSubmit} noValidate>
            <Label htmlFor="anthropic-key">
              {credential === undefined ? 'Your API key' : 'New API key'}
            </Label>
            <Input
              id="anthropic-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              aria-invalid={error !== null}
              aria-describedby="anthropic-key-help"
              disabled={save.isPending}
            />
            <p id="anthropic-key-help" className="text-xs text-muted-foreground">
              Create one in the{' '}
              <a href={ANTHROPIC_KEYS_URL} target="_blank" rel="noreferrer" className="underline">
                Anthropic Console
              </a>
              . Stagehand checks it with Anthropic before saving it, and stores it encrypted.
            </p>
            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {save.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                Checking with Anthropic…
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={save.isPending}>
                Save key
              </Button>
              {replacing && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    setReplacing(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}

        <div className="space-y-1 border-t pt-4 text-sm text-muted-foreground">
          <p>
            When you run AI import in a campaign you GM, Stagehand sends your notes and the
            campaign&apos;s records, private fields included, to Anthropic using this key. That
            happens under your Anthropic account and Anthropic&apos;s terms.
          </p>
          <p>
            The key is used only for your own imports. Nobody else can see or use it, and Stagehand
            never shows it again, not even to you.
          </p>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title="Remove your Anthropic key?"
        description="Stagehand deletes the key. AI import won't work until you add a key again. The key itself still works in the Anthropic Console; delete it there too if you no longer need it."
        confirmLabel="Remove key"
        onConfirm={async () => {
          await remove.mutateAsync();
          setSaved(false);
        }}
      />
    </Card>
  );
}
