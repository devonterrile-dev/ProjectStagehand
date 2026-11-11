import {
  RECORD_TYPES,
  searchTerms,
  type Campaign,
  type RecordSummary,
  type RecordType,
} from '@stagehand/shared';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { AreaSelect } from '@/components/records/AreaSelect';
import { NewRecordDialog } from '@/components/records/NewRecordDialog';
import { PlayersNote } from '@/components/records/PlayersNote';
import { RecordList } from '@/components/records/RecordList';
import { RecordTypeFilter } from '@/components/records/RecordTypeFilter';
import { TagFilter } from '@/components/records/TagFilter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useCampaign, useRecordSearch, useRecords } from '@/lib/queries';
import {
  filtersToParams,
  hasSearchFilters,
  parseRecordFilters,
  recordPath,
  type RecordFilters,
} from '@/lib/records';
import { CampaignNotFound } from '@/pages/CampaignPage';

/** How long typing pauses before the search runs. */
const SEARCH_DEBOUNCE_MS = 250;

/** `/campaigns/:campaignId/records`: the GM's records, searched and filtered (F1.6b). */
export function RecordsPage() {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) return <CampaignNotFound />;
  return <RecordsView campaign={campaign} />;
}

/** Every tag used in the campaign, sorted. */
function tagsOf(records: readonly RecordSummary[]): string[] {
  return [...new Set(records.flatMap((record) => record.tags))].sort((a, b) => a.localeCompare(b));
}

function RecordsView({ campaign }: { campaign: Campaign }) {
  const isGm = campaign.role === 'gm';
  const isArchived = campaign.archivedAt !== null;
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseRecordFilters(searchParams);
  const filtering = hasSearchFilters(filters);
  const all = useRecords(campaign.id, undefined, isGm);
  const search = useRecordSearch(
    campaign.id,
    {
      ...(filters.q === '' ? {} : { q: filters.q }),
      ...(filters.tags.length === 0 ? {} : { tags: filters.tags }),
      ...(filters.areaId === null ? {} : { areaId: filters.areaId }),
    },
    isGm && filtering,
  );
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  // The search box types ahead of the URL, which follows after a pause.
  const [text, setText] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    // The URL changed (back button, Clear filters): follow it, unless it is just catching up.
    setSyncedQ(filters.q);
    if (filters.q !== text.trim()) setText(filters.q);
  }
  useEffect(() => {
    const next = text.trim();
    if (next === filters.q) return;
    const timer = window.setTimeout(() => {
      setSearchParams((current) => filtersToParams({ ...parseRecordFilters(current), q: next }), {
        replace: true,
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, filters.q, setSearchParams]);

  const apply = (next: RecordFilters) => {
    setSearchParams(filtersToParams(next));
  };
  const clearFilters = () => {
    setText('');
    apply({ type: filters.type, q: '', tags: [], areaId: null });
  };

  const records = all.data;
  const matches = filtering ? search.data : records;
  const counts = Object.fromEntries(RECORD_TYPES.map((t) => [t, 0])) as Record<RecordType, number>;
  for (const record of matches ?? []) counts[record.type] += 1;
  const shown = (matches ?? []).filter(
    (record) => filters.type === null || record.type === filters.type,
  );
  const areas = (records ?? []).filter((record) => record.type === 'area');

  return (
    <div className="space-y-4">
      <Link
        to={`/campaigns/${campaign.id}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← {campaign.name}
      </Link>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>
            <h1 className="text-2xl">Records</h1>
          </CardTitle>
          {isGm && !isArchived && (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
              }}
            >
              <PlusIcon aria-hidden />
              New record
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!isGm && <PlayersNote />}
          {isGm && (
            <>
              <div className="relative">
                <SearchIcon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  aria-label="Search records"
                  placeholder="Search names, tags, descriptions and GM notes"
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
              <RecordTypeFilter
                value={filters.type}
                counts={counts}
                total={matches?.length ?? 0}
                onChange={(type) => {
                  apply({ ...filters, type, areaId: type === 'spot' ? filters.areaId : null });
                }}
              />
              <TagFilter
                tags={tagsOf(records ?? [])}
                selected={filters.tags}
                onToggle={(tag) => {
                  apply({
                    ...filters,
                    tags: filters.tags.includes(tag)
                      ? filters.tags.filter((other) => other !== tag)
                      : [...filters.tags, tag],
                  });
                }}
              />
              {filters.type === 'spot' && areas.length > 0 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="records-area" className="text-sm text-muted-foreground">
                    Area
                  </label>
                  <div className="w-64">
                    <AreaSelect
                      id="records-area"
                      areas={areas}
                      value={filters.areaId ?? ''}
                      placeholder="All areas"
                      onChange={(areaId) => {
                        apply({ ...filters, areaId: areaId === '' ? null : areaId });
                      }}
                    />
                  </div>
                </div>
              )}
              {filtering && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-sm"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              )}
            </>
          )}
          {isGm && all.isPending && <p className="text-muted-foreground">Loading records…</p>}
          {isGm && all.isError && (
            <p role="alert">Could not load the records. Try again in a moment.</p>
          )}
          {isGm && filtering && search.isError && (
            <p role="alert">Could not search the records. Try again in a moment.</p>
          )}
          {isGm && records !== undefined && filtering && search.isPending && (
            <p className="text-muted-foreground">Searching…</p>
          )}
          {isGm && records !== undefined && matches !== undefined && (
            <RecordList
              campaignId={campaign.id}
              records={shown}
              type={filters.type}
              terms={searchTerms(filters.q)}
              {...(filtering ? { onClearFilters: clearFilters } : {})}
            />
          )}
        </CardContent>
      </Card>

      {creating && records !== undefined && (
        <NewRecordDialog
          campaignId={campaign.id}
          initialType={filters.type ?? 'npc'}
          records={records}
          open
          onOpenChange={(open) => {
            if (!open) setCreating(false);
          }}
          onCreated={(record) => {
            void navigate(recordPath(campaign.id, record.id));
          }}
        />
      )}
    </div>
  );
}
