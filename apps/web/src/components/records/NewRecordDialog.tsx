import {
  createRecordRequestSchema,
  RECORD_NAME_MAX,
  RECORD_TYPE_LABELS,
  RECORD_TYPES,
  recordTypeSchema,
  type CampaignRecord,
  type RecordSummary,
  type RecordType,
} from '@stagehand/shared';
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
import { useCreateRecord } from '@/lib/queries';

import { AreaSelect } from './AreaSelect';

interface NewRecordDialogProps {
  campaignId: string;
  initialType: RecordType;
  /** Every record summary in the campaign; Spots need an Area from it. */
  records: RecordSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (record: CampaignRecord) => void;
}

/** GM: a type and a name. Everything else is filled in on the record's own page. */
export function NewRecordDialog({ open, onOpenChange, ...props }: NewRecordDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so the form starts fresh every time. */}
        <NewRecordForm
          {...props}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewRecordForm({
  campaignId,
  initialType,
  records,
  onCreated,
  onDone,
}: Omit<NewRecordDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const create = useCreateRecord(campaignId);
  const areas = records.filter((record) => record.type === 'area');
  const [type, setType] = useState<RecordType>(initialType);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const needsArea = type === 'spot';
  const noAreas = needsArea && areas.length === 0;

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createRecordRequestSchema.safeParse(
      needsArea ? { type, name, parentId } : { type, name },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    try {
      const record = await create.mutateAsync(parsed.data);
      onDone();
      onCreated(record);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Something went wrong');
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <DialogHeader>
        <DialogTitle>New record</DialogTitle>
        <DialogDescription>
          Pick a type and a name. Everything else is filled in on the record&apos;s page.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="record-type">Type</Label>
        <NativeSelect
          id="record-type"
          value={type}
          onChange={(event) => {
            setType(recordTypeSchema.parse(event.target.value));
          }}
        >
          {RECORD_TYPES.map((option) => (
            <option key={option} value={option}>
              {RECORD_TYPE_LABELS[option]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="record-name">Name</Label>
        <Input
          id="record-name"
          value={name}
          maxLength={RECORD_NAME_MAX}
          autoFocus
          aria-invalid={error !== null}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      {needsArea && (
        <div className="space-y-2">
          <Label htmlFor="record-area">Area</Label>
          {noAreas ? (
            <p className="text-sm text-muted-foreground">
              Create an Area first. Every Spot belongs to one.
            </p>
          ) : (
            <AreaSelect
              id="record-area"
              areas={areas}
              value={parentId}
              placeholder="Choose an area…"
              onChange={setParentId}
            />
          )}
        </div>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="submit" disabled={create.isPending || noAreas}>
          Create record
        </Button>
      </DialogFooter>
    </form>
  );
}
