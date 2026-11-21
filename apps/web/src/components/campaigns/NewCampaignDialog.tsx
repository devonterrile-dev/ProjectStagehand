import { CAMPAIGN_NAME_MAX, campaignNameSchema, type Campaign } from '@stagehand/shared';
import { useState, type SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

export interface NewCampaign {
  name: string;
  /** A campaign the user runs, whose gameplay records the new one copies (F4.3, 19.14). */
  copyGameplayFrom?: string;
}

interface NewCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The campaigns the user runs as GM: where gameplay records can be copied from. */
  sources: readonly Pick<Campaign, 'id' | 'name'>[];
  /** Creates it. The dialog closes when it resolves and shows the error if it rejects. */
  onCreate: (campaign: NewCampaign) => Promise<unknown>;
}

/**
 * "New campaign": its name, and its gameplay records (F4.3, 19.14): start fresh with the ten
 * default domains, or copy another campaign's once. The choice shows only when the user runs
 * another campaign.
 */
export function NewCampaignDialog({ open, onOpenChange, ...form }: NewCampaignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so the form starts fresh every time. */}
        <NewCampaignForm
          {...form}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewCampaignForm({
  sources,
  onCreate,
  onDone,
}: Pick<NewCampaignDialogProps, 'sources' | 'onCreate'> & { onDone: () => void }) {
  const [name, setName] = useState('');
  const [copying, setCopying] = useState(false);
  const [from, setFrom] = useState(sources[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = campaignNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onCreate({
        name: parsed.data,
        ...(copying && from !== '' ? { copyGameplayFrom: from } : {}),
      });
      onDone();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <DialogHeader>
        <DialogTitle>New campaign</DialogTitle>
        <DialogDescription>You&apos;ll be its GM. You can rename it later.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="new-campaign-name">Campaign name</Label>
        <Input
          id="new-campaign-name"
          value={name}
          maxLength={CAMPAIGN_NAME_MAX}
          autoFocus
          aria-invalid={error !== null}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      {sources.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Gameplay records</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="gameplay"
              className="mt-0.5"
              checked={!copying}
              onChange={() => {
                setCopying(false);
              }}
            />
            <span>
              Start fresh
              <span className="block text-muted-foreground">The ten default domains.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="gameplay"
              className="mt-0.5"
              checked={copying}
              onChange={() => {
                setCopying(true);
              }}
            />
            <span>
              Copy from another campaign
              <span className="block text-muted-foreground">
                Its domains, cards and stat blocks, copied once: changes later stay apart.
              </span>
            </span>
          </label>
          {copying && (
            <NativeSelect
              aria-label="Copy gameplay records from"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </fieldset>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={saving}>
          Create campaign
        </Button>
      </DialogFooter>
    </form>
  );
}
