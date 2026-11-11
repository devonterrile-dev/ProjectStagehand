import {
  RECORD_TYPE_LABELS,
  searchTerms,
  type Character,
  type RecordMatch,
  type RecordSummary,
  type StatBlockSummary,
} from '@stagehand/shared';
import { cn } from 'cn';
import { SearchIcon } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMatch, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { settlePendingSaves } from '@/lib/pending-saves';
import {
  useCampaign,
  useCharacters,
  useRecordSearch,
  useRecords,
  useStatBlocks,
} from '@/lib/queries';
import { readRecent, type RecentItem } from '@/lib/recent-items';
import {
  characterPath,
  filterRecords,
  MATCH_FIELD_LABELS,
  optionId,
  recordPath,
  statBlockPath,
} from '@/lib/records';

import { Highlight } from './Highlight';

const RECORDS_SHOWN = 8;
const OTHERS_SHOWN = 5;
const RECENT_SHOWN = 5;
/** Typing pauses this long before the records search runs. */
const SEARCH_DEBOUNCE_MS = 150;

interface JumpItem {
  key: string;
  name: string;
  /** "NPC", "Stat block", "Character". */
  detail: string;
  /** A Spot's Area. */
  parentName: string | null;
  match: RecordMatch | null;
  href: string;
}

interface JumpGroup {
  label: string;
  items: JumpItem[];
}

const recordItem = (
  campaignId: string,
  record: RecordSummary & { match?: RecordMatch | null },
): JumpItem => ({
  key: `record:${record.id}`,
  name: record.name,
  detail: RECORD_TYPE_LABELS[record.type],
  parentName: record.parentName,
  match: record.match ?? null,
  href: recordPath(campaignId, record.id),
});

const statBlockItem = (campaignId: string, block: StatBlockSummary): JumpItem => ({
  key: `statBlock:${block.id}`,
  name: block.name,
  detail: 'Stat block',
  parentName: null,
  match: null,
  href: statBlockPath(campaignId, block.id),
});

const characterItem = (campaignId: string, pc: Character): JumpItem => ({
  key: `character:${pc.id}`,
  name: pc.name,
  detail: 'Character',
  parentName: null,
  match: null,
  href: characterPath(campaignId, pc.id),
});

/** "⌘K" on Apple devices, "Ctrl K" elsewhere. */
function shortcutLabel(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';
}

/**
 * Quick jump (F1.6b): a header button and Ctrl/Cmd+K, inside a campaign, for its GM only.
 * Finds records by search (D-25) and stat blocks and PCs by name; with nothing typed it
 * lists what the GM opened lately.
 */
export function QuickJump() {
  const match = useMatch('/campaigns/:campaignId/*');
  const campaignId = match?.params.campaignId;
  if (campaignId === undefined || campaignId === '') return null;
  return <CampaignQuickJump key={campaignId} campaignId={campaignId} />;
}

function CampaignQuickJump({ campaignId }: { campaignId: string }) {
  const { data: campaign } = useCampaign(campaignId);
  if (campaign?.role !== 'gm') return null;
  return <GmQuickJump campaignId={campaignId} />;
}

function GmQuickJump({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Capture, so it works while typing anywhere, the rich text editor included.
    const onKeyDown = (event: KeyboardEvent) => {
      const modified = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
      if (!modified || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-muted-foreground"
        onClick={() => {
          setOpen(true);
        }}
      >
        <SearchIcon aria-hidden />
        Search
        <kbd
          aria-hidden
          className="hidden rounded border bg-muted px-1.5 font-mono text-[0.7rem] sm:inline"
        >
          {shortcutLabel()}
        </kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="top-[12%] translate-y-0 gap-0 p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Quick jump</DialogTitle>
          <QuickJumpPanel
            campaignId={campaignId}
            onDone={() => {
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface JumpLists {
  records: readonly RecordSummary[] | undefined;
  statBlocks: readonly StatBlockSummary[] | undefined;
  characters: readonly Character[] | undefined;
}

/** A recent item with its current name, or null once it has been deleted. */
function resolveRecent(campaignId: string, { kind, id }: RecentItem, lists: JumpLists) {
  switch (kind) {
    case 'record': {
      const record = lists.records?.find((item) => item.id === id);
      return record === undefined ? null : recordItem(campaignId, record);
    }
    case 'statBlock': {
      const block = lists.statBlocks?.find((item) => item.id === id);
      return block === undefined ? null : statBlockItem(campaignId, block);
    }
    case 'character': {
      const pc = lists.characters?.find((item) => item.id === id);
      return pc === undefined ? null : characterItem(campaignId, pc);
    }
  }
}

function QuickJumpPanel({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const listId = useId();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [recent] = useState(() => readRecent(campaignId));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(text.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text]);

  const { data: records } = useRecords(campaignId, undefined, true);
  const { data: statBlocks } = useStatBlocks(campaignId, true);
  const { data: characters } = useCharacters(campaignId, true);
  const found = useRecordSearch(campaignId, { q, limit: RECORDS_SHOWN }, q !== '');

  const query = text.trim();
  const terms = searchTerms(query);
  const groups: JumpGroup[] =
    query === ''
      ? [
          {
            label: 'Recent',
            items: recent
              .map((item) => resolveRecent(campaignId, item, { records, statBlocks, characters }))
              .filter((item) => item !== null)
              .slice(0, RECENT_SHOWN),
          },
        ]
      : [
          {
            label: 'Records',
            items: (found.data ?? []).map((record) => recordItem(campaignId, record)),
          },
          {
            label: 'Stat blocks',
            items: filterRecords(statBlocks ?? [], query, { limit: OTHERS_SHOWN }).map((block) =>
              statBlockItem(campaignId, block),
            ),
          },
          {
            label: 'Characters',
            items: filterRecords(characters ?? [], query, { limit: OTHERS_SHOWN }).map((pc) =>
              characterItem(campaignId, pc),
            ),
          },
        ];
  const shownGroups = groups.filter((group) => group.items.length > 0);
  const items = shownGroups.flatMap((group) => group.items);
  /** Where each group's options start in `items`. */
  const offsets = shownGroups.map((_, groupIndex) =>
    shownGroups.slice(0, groupIndex).reduce((total, group) => total + group.items.length, 0),
  );
  const current = Math.min(active, items.length - 1);
  const searching = query !== '' && (q !== query || found.isFetching) && items.length === 0;

  async function choose(item: JumpItem, newTab: boolean) {
    if (newTab) {
      window.open(item.href, '_blank', 'noopener');
      onDone();
      return;
    }
    // Like a record's "Open" (F1.5b): send the page's edits first, and stay if they failed.
    const saved = await settlePendingSaves();
    onDone();
    if (saved) await navigate(item.href);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + items.length) % items.length);
    } else if (event.key === 'Enter') {
      const item = items[current];
      if (item !== undefined) {
        event.preventDefault();
        void choose(item, event.ctrlKey || event.metaKey);
      }
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 border-b px-3">
        <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-label="Search records, stat blocks and characters"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length > 0 ? optionId(listId, current) : undefined}
          autoComplete="off"
          maxLength={200}
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Search records, stat blocks and characters"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-2">
        {query === '' && items.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Search records, stat blocks and characters
          </p>
        )}
        {searching && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Searching…</p>
        )}
        {query !== '' && !searching && items.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</p>
        )}
        <div id={listId} role="listbox" aria-label="Results">
          {shownGroups.map((group, groupIndex) => {
            const headingId = `${listId}-group-${String(groupIndex)}`;
            return (
              <div key={group.label} role="group" aria-labelledby={headingId} className="mb-1">
                <div
                  id={headingId}
                  role="presentation"
                  className="px-2 py-1 text-xs font-medium text-muted-foreground"
                >
                  {group.label}
                </div>
                {group.items.map((item, inGroup) => {
                  const itemIndex = (offsets[groupIndex] ?? 0) + inGroup;
                  return (
                    <div
                      key={item.key}
                      id={optionId(listId, itemIndex)}
                      role="option"
                      aria-selected={itemIndex === current}
                      className={cn(
                        'cursor-pointer rounded-sm px-2 py-1.5 text-sm',
                        itemIndex === current && 'bg-accent text-accent-foreground',
                      )}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        void choose(item, event.ctrlKey || event.metaKey);
                      }}
                      onMouseEnter={() => {
                        setActive(itemIndex);
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">
                          <Highlight text={item.name} terms={terms} />
                          {item.parentName !== null && (
                            <span className="text-muted-foreground"> · {item.parentName}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.detail}
                        </span>
                      </div>
                      {item.match !== null && (
                        <div className="truncate text-xs text-muted-foreground">
                          {MATCH_FIELD_LABELS[item.match.field]}:{' '}
                          <Highlight text={item.match.snippet} terms={terms} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        ↑ ↓ to move · Enter to open · Ctrl+Enter for a new tab · Esc to close
      </p>
    </div>
  );
}
