import { CAMPAIGN_NAME_MAX, campaignNameSchema } from '@stagehand/shared';
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

/** What the dialog needs from a Zod string schema (the web app doesn't import zod itself). */
interface NameSchema {
  safeParse(
    value: string,
  ):
    | { success: true; data: string }
    | { success: false; error: { issues: readonly { message: string }[] } };
}

interface CampaignNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  initialName?: string;
  /** The field's label. Defaults to "Campaign name". */
  label?: string;
  /** Validates and trims the name. Defaults to the campaign name rules. */
  schema?: NameSchema;
  maxLength?: number;
  /** Saves the validated name. The dialog closes when it resolves and shows the error if it rejects. */
  onSave: (name: string) => Promise<unknown>;
}

/**
 * One dialog for naming something: a campaign ("New campaign", "Rename"), and with its own
 * `label`, `schema` and `maxLength`, a new PC or stat block.
 */
export function CampaignNameDialog({ open, onOpenChange, ...form }: CampaignNameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so the form starts fresh every time. */}
        <NameForm
          {...form}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  title,
  description,
  submitLabel,
  initialName = '',
  label = 'Campaign name',
  schema = campaignNameSchema,
  maxLength = CAMPAIGN_NAME_MAX,
  onSave,
  onDone,
}: Omit<CampaignNameDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = schema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(parsed.data);
      onDone();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="name-dialog-name">{label}</Label>
        <Input
          id="name-dialog-name"
          value={name}
          maxLength={maxLength}
          autoFocus
          aria-invalid={error !== null}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={saving}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
