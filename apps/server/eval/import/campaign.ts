/**
 * A pretend campaign for the eval (F1.9b): the records a case starts with, and every
 * proposal of each step applied as if the GM accepted them all. It feeds the same context
 * pack builder the server uses, so the model sees what it would see in the app.
 */
import { randomUUID } from 'node:crypto';

import {
  emptyRichText,
  type ImportProposalDraft,
  type RecordType,
  type RichText,
} from '@stagehand/shared';

import { emptyContextPack, fieldSpecsOf, type ContextPack } from '../../src/ai-import/context';
import {
  buildContextPack,
  type PackSourceLink,
  type PackSourceRecord,
} from '../../src/ai-import/context-pack';
import { markdownToRichText } from '../../src/ai-import/markdown';

import type { EvalRecord } from './types';

const richText = (markdown: string | undefined): RichText =>
  markdown === undefined ? emptyRichText() : markdownToRichText(markdown, () => null).doc;

export class EvalCampaign {
  readonly records = new Map<string, PackSourceRecord>();
  readonly links: PackSourceLink[] = [];

  /** A campaign holding `records`; rich text fields are written as Markdown. */
  static from(records: readonly EvalRecord[] = []): EvalCampaign {
    const campaign = new EvalCampaign();
    const ids = new Map(records.map((record) => [record.key, randomUUID()]));
    const idOf = (key: string) => {
      const id = ids.get(key);
      if (id === undefined) throw new Error(`eval campaign: no record with key "${key}"`);
      return id;
    };
    for (const record of records) {
      const specs = fieldSpecsOf(record.type);
      const fields = Object.fromEntries(
        Object.entries(record.fields ?? {}).map(([key, value]) => [
          key,
          specs[key]?.kind === 'rich' && typeof value === 'string' ? richText(value) : value,
        ]),
      );
      const id = idOf(record.key);
      campaign.records.set(id, {
        id,
        type: record.type,
        name: record.name,
        parentId: record.area === undefined ? null : idOf(record.area),
        tags: record.tags ?? [],
        publicDescription: richText(record.publicDescription),
        gmNotes: richText(record.gmNotes),
        fields,
      });
      for (const link of record.links ?? []) {
        campaign.links.push({
          fromId: id,
          toId: idOf(link.to),
          fieldKey: link.field,
          label: null,
        });
      }
    }
    return campaign;
  }

  get isEmpty(): boolean {
    return this.records.size === 0;
  }

  /** The campaign's records as name and type, for the duplicate check. */
  names(): { id: string; type: RecordType; name: string }[] {
    return [...this.records.values()].map(({ id, type, name }) => ({ id, type, name }));
  }

  /** The first record whose name matches. */
  find(name: RegExp): PackSourceRecord | undefined {
    return [...this.records.values()].find((record) => name.test(record.name));
  }

  /** What the model is told about the campaign, as `prepareImport` builds it. */
  pack(mode: 'bootstrap' | 'add' | 'fill', text: string, fillTargetId: string | null): ContextPack {
    if (mode === 'bootstrap') return emptyContextPack();
    return buildContextPack({
      records: [...this.records.values()],
      links: this.links,
      text,
      fillTargetId,
    }).pack;
  }

  /** Applies every proposal as an accepted one, like a commit with nothing rejected. */
  apply(proposals: readonly ImportProposalDraft[]): void {
    for (const proposal of proposals) {
      if (proposal.action !== 'create') continue;
      const { payload } = proposal;
      this.records.set(payload.id, {
        id: payload.id,
        type: payload.type,
        name: payload.name,
        parentId: payload.parentId,
        tags: payload.tags,
        publicDescription: payload.publicDescription,
        gmNotes: payload.gmNotes,
        fields: payload.fields,
      });
      for (const [fieldKey, ids] of Object.entries(payload.links)) {
        for (const toId of ids)
          this.links.push({ fromId: payload.id, toId, fieldKey, label: null });
      }
      for (const link of payload.otherLinks) {
        this.links.push({
          fromId: payload.id,
          toId: link.recordId,
          fieldKey: null,
          label: link.label,
        });
      }
    }
    for (const proposal of proposals) {
      if (proposal.action === 'update') {
        const record = this.records.get(proposal.payload.recordId);
        if (record === undefined) continue;
        const { name, publicDescription, gmNotes, addTags, fields } = proposal.payload;
        if (name !== undefined) record.name = name;
        if (publicDescription !== undefined) record.publicDescription = publicDescription;
        if (gmNotes !== undefined) record.gmNotes = gmNotes;
        if (addTags !== undefined) record.tags = [...new Set([...record.tags, ...addTags])];
        if (fields !== undefined) record.fields = { ...record.fields, ...fields };
      } else if (proposal.action === 'link') {
        const { fromId, toId, fieldKey, label } = proposal.payload;
        this.links.push({ fromId, toId, fieldKey, label });
      }
    }
  }
}
