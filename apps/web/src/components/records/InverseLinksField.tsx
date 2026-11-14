import {
  RECORD_TYPE_LABELS,
  type InverseLinkField,
  type RecordSummary,
  type RecordType,
} from '@stagehand/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useBacklinks } from '@/lib/queries';
import { useRecordNavigation } from '@/lib/record-navigation';

import { NewRecordDialog } from './NewRecordDialog';
import { RecordChip } from './RecordChip';

interface InverseLinksFieldProps {
  campaignId: string;
  recordId: string;
  recordType: RecordType;
  /** Its key in `INVERSE_LINK_FIELDS`, e.g. `propsHere`. */
  fieldKey: string;
  inverse: InverseLinkField;
  records: RecordSummary[];
  disabled: boolean;
}

/**
 * A list shown here but stored on other records (F1.10, D-41): a Spot's "Props here" is
 * every Prop whose Spot is this one. It is read from the backlinks, so it can never disagree
 * with the Props themselves; a Prop is moved by changing its own Spot. "New prop here"
 * creates a Prop already linked to this record.
 */
export function InverseLinksField({
  campaignId,
  recordId,
  recordType,
  fieldKey,
  inverse,
  records,
  disabled,
}: InverseLinksFieldProps) {
  const { data } = useBacklinks(campaignId, recordId, true);
  const navigation = useRecordNavigation();
  const [creating, setCreating] = useState(false);
  const typeLabel = RECORD_TYPE_LABELS[inverse.from];
  const listed = (data?.links ?? [])
    .filter(
      (link) =>
        link.kind === 'field' &&
        link.fieldKey === inverse.field &&
        link.record.type === inverse.from,
    )
    .map((link) => link.record)
    .sort((a, b) => a.name.localeCompare(b.name));
  const labelId = `inverse-${fieldKey}`;

  return (
    <div className="space-y-2" role="group" aria-labelledby={labelId}>
      <Label id={labelId}>{inverse.label}</Label>
      {listed.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={inverse.label}>
          {listed.map((record) => (
            <li key={record.id}>
              <RecordChip recordId={record.id} name={record.name} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          None yet. A {typeLabel.toLowerCase()} is placed here from its own page.
        </p>
      )}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCreating(true);
          }}
        >
          <PlusIcon aria-hidden />
          New {typeLabel.toLowerCase()} here
        </Button>
      )}
      <NewRecordDialog
        campaignId={campaignId}
        initialType={inverse.from}
        initialLinks={{ [inverse.field]: [recordId] }}
        records={records}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(created) => {
          void navigation.open(created.id);
        }}
        placedAt={
          records.find((record) => record.id === recordId)?.name ?? RECORD_TYPE_LABELS[recordType]
        }
      />
    </div>
  );
}
