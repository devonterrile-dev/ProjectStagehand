import {
  inverseLinkFieldsOf,
  RECORD_FIELD_SPECS,
  type Backlink,
  type FieldSpec,
  type RecordRef,
  type RecordType,
} from '@stagehand/shared';
import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBacklinks } from '@/lib/queries';
import { useRecordNavigation } from '@/lib/record-navigation';
import { characterPath } from '@/lib/records';

/** How a link reads from its source: the field's label, or the relationship typed. */
function linkLabel(link: Backlink): string | null {
  if (link.kind === 'other') return link.label;
  const specs: Record<string, FieldSpec | undefined> = RECORD_FIELD_SPECS[link.record.type];
  return (link.fieldKey === null ? undefined : specs[link.fieldKey]?.label) ?? null;
}

/** Field and other links from the same record, as one entry. */
function bySource(links: readonly Backlink[]): { record: RecordRef; labels: string[] }[] {
  const groups = new Map<string, { record: RecordRef; labels: string[] }>();
  for (const link of links) {
    const group = groups.get(link.record.id) ?? { record: link.record, labels: [] };
    const label = linkLabel(link);
    if (label !== null) group.labels.push(label);
    groups.set(link.record.id, group);
  }
  return [...groups.values()];
}

/**
 * A link to another record. A plain click waits for the open record's autosave first; a
 * modified click (new tab or window) is left to the browser.
 */
function RecordLink({ record }: { record: RecordRef }) {
  const navigation = useRecordNavigation();
  return (
    <Link
      to={navigation.hrefOf(record.id)}
      className="font-medium underline-offset-2 hover:underline"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        void navigation.open(record.id);
      }}
    >
      {record.name}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="space-y-1 text-sm" aria-label={title}>
        {children}
      </ul>
    </section>
  );
}

/** Links the record's own form already lists, such as a Spot's "Props here" (D-41). */
function shownOnForm(type: RecordType, link: Backlink): boolean {
  return inverseLinkFieldsOf(type).some(
    ([, inverse]) =>
      link.kind === 'field' && link.fieldKey === inverse.field && link.record.type === inverse.from,
  );
}

/** Everything pointing at the record (D-24): links, mentions, and PCs carrying an Item. */
export function BacklinksPanel({
  campaignId,
  recordId,
  recordType,
}: {
  campaignId: string;
  recordId: string;
  recordType: RecordType;
}) {
  const { data: loaded, isPending, isError } = useBacklinks(campaignId, recordId, true);
  const data =
    loaded === undefined || loaded === null
      ? loaded
      : { ...loaded, links: loaded.links.filter((link) => !shownOnForm(recordType, link)) };

  let body: ReactNode;
  if (isPending) {
    body = <p className="text-sm text-muted-foreground">Loading…</p>;
  } else if (isError || data === null || data === undefined) {
    body = <p className="text-sm text-muted-foreground">Could not load backlinks.</p>;
  } else if (
    data.links.length === 0 &&
    data.mentions.length === 0 &&
    data.inventories.length === 0
  ) {
    body = <p className="text-sm text-muted-foreground">Nothing links here yet.</p>;
  } else {
    body = (
      <div className="space-y-4">
        {data.links.length > 0 && (
          <Section title="Linked from">
            {bySource(data.links).map(({ record, labels }) => (
              <li key={record.id}>
                <RecordLink record={record} />
                {labels.length > 0 && (
                  <span className="text-muted-foreground"> · {labels.join(', ')}</span>
                )}
              </li>
            ))}
          </Section>
        )}
        {data.mentions.length > 0 && (
          <Section title="Mentioned in">
            {data.mentions.map((record) => (
              <li key={record.id}>
                <RecordLink record={record} />
              </li>
            ))}
          </Section>
        )}
        {data.inventories.length > 0 && (
          <Section title="In inventory of">
            {data.inventories.map((pc) => (
              <li key={pc.id}>
                <Link
                  to={characterPath(campaignId, pc.id)}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {pc.name}
                </Link>
              </li>
            ))}
          </Section>
        )}
      </div>
    );
  }

  return (
    <Card aria-label="Backlinks">
      <CardHeader>
        <CardTitle className="text-base">Backlinks</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
