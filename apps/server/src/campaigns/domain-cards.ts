/**
 * Domain cards (F4.3, governance §8 "Domains and domain cards"). Part of the campaign
 * data-access layer: every query is scoped to `scope.campaignId`. Every member reads them;
 * callers check `assertGm` and `assertWritable` before a change. Sheets holding a card will
 * keep it from being deleted (F4.7).
 */
import {
  domainCardSchema,
  domainCardSummarySchema,
  type CreateDomainCardRequest,
  type DomainCard,
  type DomainCardSummary,
  type UpdateDomainCardRequest,
} from '@stagehand/shared';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { domainCards, domains } from '../db/schema';
import { httpError } from '../http/errors';

import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

const NOT_FOUND = 'Domain card not found';
export const DOMAIN_NOT_FOUND = 'Domain not found';

/** 404 unless `domainId` is a domain of this campaign. */
export async function requireDomain(
  db: DbOrTx,
  scope: CampaignScope,
  domainId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.id, domainId), eq(domains.campaignId, scope.campaignId)));
  if (row === undefined) throw httpError(404, DOMAIN_NOT_FOUND);
}

function scoped(scope: CampaignScope, cardId: string) {
  return and(eq(domainCards.id, cardId), eq(domainCards.campaignId, scope.campaignId));
}

/** A card with its domain's name, as every read returns it. */
const withDomain = {
  card: domainCards,
  domainName: domains.name,
};
const domainJoin = and(
  eq(domains.id, domainCards.domainId),
  eq(domains.campaignId, domainCards.campaignId),
);

type CardRow = typeof domainCards.$inferSelect;

function toSummary(row: CardRow, domainName: string): DomainCardSummary {
  return domainCardSummarySchema.parse({
    id: row.id,
    name: row.name,
    domainId: row.domainId,
    domainName,
    level: row.level,
    recallCost: row.recallCost,
    type: row.type,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toCard(row: CardRow, domainName: string): DomainCard {
  return domainCardSchema.parse({
    ...toSummary(row, domainName),
    feature: row.feature,
    createdAt: row.createdAt.toISOString(),
  });
}

/** The campaign's cards, or one domain's: by domain, then level, then name. */
export async function cardsOf(
  db: DbOrTx,
  scope: CampaignScope,
  domainId?: string,
): Promise<DomainCardSummary[]> {
  const rows = await db
    .select(withDomain)
    .from(domainCards)
    .innerJoin(domains, domainJoin)
    .where(
      and(
        eq(domainCards.campaignId, scope.campaignId),
        domainId === undefined ? undefined : eq(domainCards.domainId, domainId),
      ),
    )
    .orderBy(
      asc(sql`lower(${domains.name})`),
      asc(domainCards.level),
      asc(sql`lower(${domainCards.name})`),
      asc(domainCards.createdAt),
    );
  return rows.map((row) => toSummary(row.card, row.domainName));
}

async function readCard(db: DbOrTx, scope: CampaignScope, cardId: string): Promise<DomainCard> {
  const [row] = await db
    .select(withDomain)
    .from(domainCards)
    .innerJoin(domains, domainJoin)
    .where(scoped(scope, cardId));
  if (row === undefined) throw httpError(404, NOT_FOUND);
  return toCard(row.card, row.domainName);
}

export async function getDomainCard(
  db: Database,
  scope: CampaignScope,
  cardId: string,
): Promise<DomainCard> {
  return readCard(db, scope, cardId);
}

/** Creates a card in one of this campaign's domains. */
export async function createDomainCard(
  db: Database,
  scope: CampaignScope,
  request: CreateDomainCardRequest,
): Promise<DomainCard> {
  return db.transaction(async (tx) => {
    await requireDomain(tx, scope, request.domainId);
    const [row] = await tx
      .insert(domainCards)
      .values({ campaignId: scope.campaignId, ...request })
      .returning({ id: domainCards.id });
    if (row === undefined) throw new Error('domain card insert returned no row');
    return readCard(tx, scope, row.id);
  });
}

/** Applies a partial update; a new domain must be one of this campaign's. Last write wins. */
export async function updateDomainCard(
  db: Database,
  scope: CampaignScope,
  cardId: string,
  patch: UpdateDomainCardRequest,
): Promise<DomainCard> {
  return db.transaction(async (tx) => {
    if (patch.domainId !== undefined) await requireDomain(tx, scope, patch.domainId);
    const [row] = await tx
      .update(domainCards)
      .set(patch)
      .where(scoped(scope, cardId))
      .returning({ id: domainCards.id });
    if (row === undefined) throw httpError(404, NOT_FOUND);
    return readCard(tx, scope, row.id);
  });
}

export async function deleteDomainCard(
  db: Database,
  scope: CampaignScope,
  cardId: string,
): Promise<void> {
  const removed = await db
    .delete(domainCards)
    .where(scoped(scope, cardId))
    .returning({ id: domainCards.id });
  if (removed.length === 0) throw httpError(404, NOT_FOUND);
}
