import { RECORD_TYPE_LABELS, type SceneObject, type StageRecord } from '@stagehand/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { Input } from '@/components/ui/input';
import { recordPath } from '@/lib/records';
import { addRefusal, RECORD_DRAG_TYPE, stageImageUrl } from '@/lib/scenes';

interface SceneTrayProps {
  campaignId: string;
  /** The scene's Spot, whose props, NPCs and items are suggested first; null without one. */
  spotName: string | null;
  suggestions: readonly StageRecord[];
  /** Every placeable record with an image; undefined while they load. */
  records: readonly StageRecord[] | undefined;
  /** What is in the scene now: decides what can still be added. */
  objects: readonly SceneObject[];
  onAdd: (entry: StageRecord) => void;
}

const REFUSALS = {
  full: 'The scene is full',
  'already-placed': 'In the scene',
} as const;

function TrayItem({
  campaignId,
  entry,
  objects,
  onAdd,
}: {
  campaignId: string;
  entry: StageRecord;
  objects: readonly SceneObject[];
  onAdd: (entry: StageRecord) => void;
}) {
  const { record, image } = entry;
  const refusal = addRefusal(objects, entry);
  const type = RECORD_TYPE_LABELS[record.type];

  if (image === null) {
    return (
      <li className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground">
        <span className="size-10 shrink-0 rounded border border-dashed" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{record.name}</span>
          <span className="block text-xs">
            {type} · no image yet · {/* In a new tab, so the builder stays open behind it. */}
            <Link
              to={recordPath(campaignId, record.id)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Open {record.name}
            </Link>
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      {/* Not a <button>: some browsers won't start a drag from one. */}
      <div
        role="button"
        tabIndex={refusal === null ? 0 : -1}
        aria-label={`Add ${record.name}`}
        aria-disabled={refusal !== null}
        draggable={refusal === null}
        className="flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
        onClick={() => {
          if (refusal === null) onAdd(entry);
        }}
        onKeyDown={(event) => {
          if (refusal !== null || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onAdd(entry);
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData(RECORD_DRAG_TYPE, record.id);
          event.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <img
          src={stageImageUrl(campaignId, image)}
          alt=""
          loading="lazy"
          // The row is what is dragged, not the picture alone.
          draggable={false}
          className="size-10 shrink-0 object-contain"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{record.name}</span>
          <span className="block text-xs text-muted-foreground">
            {type}
            {entry.kind === 'puppet' ? ' · puppet' : ''}
            {refusal === 'full' || refusal === 'already-placed' ? ` · ${REFUSALS[refusal]}` : ''}
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * The scene builder's side tray (F3.2, governance §12 "Scene builder" step 2): records with an
 * image, ready to go in the theater by a click or by dragging one in (F3.2c). Props and Items
 * become props, NPCs become puppets. The
 * scene's Spot suggests its own first; one with no image yet is listed with a link to draw it.
 */
export function SceneTray({
  campaignId,
  spotName,
  suggestions,
  records,
  objects,
  onAdd,
}: SceneTrayProps) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const matching = (records ?? []).filter((entry) =>
    entry.record.name.toLowerCase().includes(needle),
  );

  return (
    <aside
      aria-label="Tray"
      className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r p-3 text-sm"
    >
      {spotName !== null && (
        <section aria-label={`Suggested for ${spotName}`} className="space-y-1">
          <h2 className="font-semibold">Suggested for {spotName}</h2>
          {suggestions.length === 0 ? (
            <p className="text-muted-foreground">
              This Spot has no props, NPCs or items linked to it yet.
            </p>
          ) : (
            <ul>
              {suggestions.map((entry) => (
                <TrayItem
                  key={entry.record.id}
                  campaignId={campaignId}
                  entry={entry}
                  objects={objects}
                  onAdd={onAdd}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-label="All records with an image" className="space-y-2">
        <h2 className="font-semibold">All records with an image</h2>
        <p className="text-xs text-muted-foreground">Click one to add it, or drag it in.</p>
        <Input
          type="search"
          aria-label="Search the tray"
          placeholder="Search…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        {records === undefined ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : records.length === 0 ? (
          <p className="text-muted-foreground">
            No Prop, Item or NPC has an image yet. Use Generate visual on a record, then come back.
          </p>
        ) : matching.length === 0 ? (
          <p className="text-muted-foreground">Nothing matches that search.</p>
        ) : (
          <ul>
            {matching.map((entry) => (
              <TrayItem
                key={entry.record.id}
                campaignId={campaignId}
                entry={entry}
                objects={objects}
                onAdd={onAdd}
              />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
