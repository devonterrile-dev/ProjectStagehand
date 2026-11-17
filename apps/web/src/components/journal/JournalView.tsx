import {
  RECORD_TYPES,
  searchTerms,
  type Campaign,
  type CreateEntryRequest,
  type RecordType,
} from '@stagehand/shared';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RecordTypeFilter } from '@/components/records/RecordTypeFilter';
import { ENTRIES_FILTER, entriesParams, entryPath, matchesWords } from '@/lib/journal';
import { useCreateEntry, useEntries, useJournalRecords } from '@/lib/queries';
import { filtersToParams, parseRecordFilters } from '@/lib/records';

import { NewEntryDialog } from './EntryForm';
import { EntryList, JournalRecordList } from './JournalList';

/** How long typing pauses before the search runs. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * What a player sees where the GM's records are (F3.5): the journal. The GM's layout without
 * tags: a search over names and public descriptions, the record types that have something
 * revealed, and the players' own entries first, which a player can add to.
 */
export function JournalView({ campaign }: { campaign: Campaign }) {
  const isArchived = campaign.archivedAt !== null;
  const [searchParams, setSearchParams] = useSearchParams();
  const showEntries = searchParams.get('type') === ENTRIES_FILTER;
  const filters = parseRecordFilters(searchParams);
  const q = filters.q;
  const all = useJournalRecords(campaign.id, {});
  const search = useJournalRecords(campaign.id, { q }, q !== '');
  const entries = useEntries(campaign.id);
  const create = useCreateEntry(campaign.id);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  // The search box types ahead of the URL, which follows after a pause.
  const [text, setText] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    if (q !== text.trim()) setText(q);
  }
  useEffect(() => {
    const next = text.trim();
    if (next === q) return;
    const timer = window.setTimeout(() => {
      setSearchParams(
        (current) =>
          current.get('type') === ENTRIES_FILTER
            ? entriesParams(next)
            : filtersToParams({ ...parseRecordFilters(current), q: next }),
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, q, setSearchParams]);

  const chooseType = (type: RecordType | null) => {
    setSearchParams(filtersToParams({ type, q, tags: [], areaId: null }));
  };
  const chooseEntries = () => {
    setSearchParams(entriesParams(q));
  };

  const matches = q === '' ? all.data : search.data;
  const counts = Object.fromEntries(RECORD_TYPES.map((t) => [t, 0])) as Record<RecordType, number>;
  for (const record of matches ?? []) counts[record.type] += 1;
  const shownRecords = (matches ?? []).filter(
    (record) => filters.type === null || record.type === filters.type,
  );
  const shownEntries = (entries.data ?? []).filter(
    (entry) => q === '' || matchesWords(`${entry.title}\n${entry.description}`, q),
  );

  const onCreate = (input: CreateEntryRequest) => {
    create.mutate(input, {
      onSuccess: (entry) => {
        setCreating(false);
        void navigate(entryPath(campaign.id, entry.id));
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search the journal"
            placeholder="Search names and descriptions"
            className="pl-9"
            value={text}
            maxLength={200}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && text !== '') {
                event.preventDefault();
                setText('');
              }
            }}
          />
        </div>
        {!isArchived && (
          <Button
            size="sm"
            onClick={() => {
              create.reset();
              setCreating(true);
            }}
          >
            <PlusIcon aria-hidden />
            New entry
          </Button>
        )}
      </div>

      <RecordTypeFilter
        value={filters.type}
        counts={counts}
        total={matches?.length ?? 0}
        onChange={chooseType}
        entries={{ count: shownEntries.length, selected: showEntries, onSelect: chooseEntries }}
        hideEmpty
      />

      {(all.isError || search.isError || entries.isError) && (
        <p role="alert">Could not load the journal. Try again in a moment.</p>
      )}
      {showEntries ? (
        entries.data === undefined ? (
          <p className="text-muted-foreground">Loading entries…</p>
        ) : (
          <EntryList
            campaignId={campaign.id}
            entries={shownEntries}
            terms={searchTerms(q)}
            searching={q !== ''}
          />
        )
      ) : matches === undefined ? (
        <p className="text-muted-foreground">Loading the journal…</p>
      ) : (
        <JournalRecordList
          campaignId={campaign.id}
          records={shownRecords}
          type={filters.type}
          terms={searchTerms(q)}
          searching={q !== ''}
        />
      )}

      <NewEntryDialog
        open={creating}
        onOpenChange={setCreating}
        busy={create.isPending}
        error={create.isError ? create.error.message : null}
        onCreate={onCreate}
      />
    </div>
  );
}
