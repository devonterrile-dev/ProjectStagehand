import { providerKeySchemas, type Provider, type ProviderCredential } from '@stagehand/shared';
import { useState, type ReactNode, type SubmitEvent } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeleteProviderKey, useSaveProviderKey } from '@/lib/queries';

export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

interface ProviderCopy {
  /** The provider's name as people know it. */
  name: string;
  title: string;
  description: ReactNode;
  placeholder: string;
  consoleUrl: string;
  /** What the link to the provider's key page says. */
  consoleName: string;
  /** Where the key's data goes, and who can use it. */
  privacy: ReactNode[];
  removeDescription: string;
}

/** Each provider's words; the card itself is the same for both (F1.7, F2.2). */
const COPY: Record<Provider, ProviderCopy> = {
  anthropic: {
    name: 'Anthropic',
    title: 'Anthropic API key',
    description:
      'AI import (turning your notes into records) runs on your own Anthropic account, so you pay Anthropic directly for what you use.',
    placeholder: 'sk-ant-…',
    consoleUrl: ANTHROPIC_KEYS_URL,
    consoleName: 'Anthropic Console',
    privacy: [
      <>
        When you run AI import in a campaign you GM, Stagehand sends your notes and the
        campaign&apos;s records, private fields included, to Anthropic using this key. That happens
        under your Anthropic account and Anthropic&apos;s terms.
      </>,
      <>
        The key is used only for your own imports. Nobody else can see or use it, and Stagehand
        never shows it again, not even to you.
      </>,
    ],
    removeDescription:
      "Stagehand deletes the key. AI import won't work until you add a key again. The key itself still works in the Anthropic Console; delete it there too if you no longer need it.",
  },
  openrouter: {
    name: 'OpenRouter',
    title: 'OpenRouter API key',
    description:
      'Visuals (the art for your puppets, props and backdrops) are generated on your own OpenRouter account, so you pay OpenRouter directly for what you use.',
    placeholder: 'sk-or-…',
    consoleUrl: OPENROUTER_KEYS_URL,
    consoleName: 'OpenRouter Keys page',
    privacy: [
      <>
        When you generate a visual, Stagehand sends the record&apos;s name, appearance and
        description, and the style&apos;s reference images, to OpenRouter using this key. OpenRouter
        passes them to the image model (OpenAI&apos;s gpt-image-2). That happens under your
        OpenRouter account and the terms of OpenRouter and the model&apos;s provider.
      </>,
      <>
        The key is used only for visuals you generate. Nobody else can see or use it, and Stagehand
        never shows it again, not even to you.
      </>,
    ],
    removeDescription:
      "Stagehand deletes the key. Generating visuals won't work until you add a key again. The key itself still works on OpenRouter; delete it there too if you no longer need it.",
  },
};

/**
 * One of the GM's AI provider keys (F1.7 Anthropic, F2.2 OpenRouter). The key is read
 * straight from the form on submit and the field is cleared afterwards, so it never sits in
 * React state; afterwards only the last four characters are shown, which is all the server
 * ever sends back.
 */
export function ProviderKeyCard({
  provider,
  credential,
}: {
  provider: Provider;
  credential: ProviderCredential | undefined;
}) {
  const copy = COPY[provider];
  const save = useSaveProviderKey(provider);
  const remove = useDeleteProviderKey(provider);
  const [replacing, setReplacing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const showForm = credential === undefined || replacing;
  const inputId = `${provider}-key`;
  const helpId = `${provider}-key-help`;
  const titleId = `${provider}-key-title`;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = new FormData(form).get('apiKey');
    const parsed = providerKeySchemas[provider].safeParse(typeof raw === 'string' ? raw : '');
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? `That is not an ${copy.name} API key`);
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
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle>
          <h2 id={titleId} className="text-lg">
            {copy.title}
          </h2>
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
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
                Saved. {copy.name} accepted the key.
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
            <Label htmlFor={inputId}>
              {credential === undefined ? 'Your API key' : 'New API key'}
            </Label>
            <Input
              id={inputId}
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={copy.placeholder}
              aria-invalid={error !== null}
              aria-describedby={helpId}
              disabled={save.isPending}
            />
            <p id={helpId} className="text-xs text-muted-foreground">
              Create one on the{' '}
              <a href={copy.consoleUrl} target="_blank" rel="noreferrer" className="underline">
                {copy.consoleName}
              </a>
              . Stagehand checks it with {copy.name} before saving it, and stores it encrypted.
            </p>
            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {save.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                Checking with {copy.name}…
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
          {copy.privacy.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title={`Remove your ${copy.name} key?`}
        description={copy.removeDescription}
        confirmLabel="Remove key"
        onConfirm={async () => {
          await remove.mutateAsync();
          setSaved(false);
        }}
      />
    </Card>
  );
}
