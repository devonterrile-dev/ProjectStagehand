/**
 * Domains (F4.3, governance §8 "Domains and domain cards"). Part of the campaign data-access
 * layer: every query is scoped to `scope.campaignId`. Every member reads them; callers check
 * `assertGm` and `assertWritable` before a change.
 */
import {
  domainSchema,
  domainSummarySchema,
  type CreateDomainRequest,
  type Domain,
  type DomainSummary,
  type UpdateDomainRequest,
} from '@stagehand/shared';
import { and, asc, count, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client';
import { domainCards, domains } from '../db/schema';
import { isUniqueViolation } from '../db/pg-errors';
import { httpError } from '../http/errors';

import { cardsOf, DOMAIN_NOT_FOUND } from './domain-cards';
import type { DbOrTx } from './members';
import type { CampaignScope } from './scope';

type DomainRow = typeof domains.$inferSelect;

const TAKEN = 'A domain with that name already exists';
/** How many of the cards in the way a refused delete names. */
const NAMED = 5;

function scoped(scope: CampaignScope, domainId: string) {
  return and(eq(domains.id, domainId), eq(domains.campaignId, scope.campaignId));
}

async function toDomain(db: DbOrTx, scope: CampaignScope, row: DomainRow): Promise<Domain> {
  const cards = await cardsOf(db, scope, row.id);
  return domainSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    cardCount: cards.length,
    cards,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Every domain of the campaign, by name, with how many cards each has. */
export async function listDomains(db: Database, scope: CampaignScope): Promise<DomainSummary[]> {
  const rows = await db
    .select({
      id: domains.id,
      name: domains.name,
      description: domains.description,
      cardCount: count(domainCards.id),
      updatedAt: domains.updatedAt,
    })
    .from(domains)
    .leftJoin(
      domainCards,
      and(eq(domainCards.domainId, domains.id), eq(domainCards.campaignId, domains.campaignId)),
    )
    .where(eq(domains.campaignId, scope.campaignId))
    .groupBy(domains.id)
    .orderBy(asc(sql`lower(${domains.name})`), asc(domains.createdAt));
  return rows.map((row) =>
    domainSummarySchema.parse({ ...row, updatedAt: row.updatedAt.toISOString() }),
  );
}

/** A domain with its cards. */
export async function getDomain(
  db: Database,
  scope: CampaignScope,
  domainId: string,
): Promise<Domain> {
  const [row] = await db.select().from(domains).where(scoped(scope, domainId));
  if (row === undefined) throw httpError(404, DOMAIN_NOT_FOUND);
  return toDomain(db, scope, row);
}

/** Runs a write that may give a domain a name it already has: 409 in our words if so. */
async function namedOnce<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw httpError(409, TAKEN);
    throw error;
  }
}

export async function createDomain(
  db: Database,
  scope: CampaignScope,
  request: CreateDomainRequest,
): Promise<Domain> {
  const [row] = await namedOnce(() =>
    db
      .insert(domains)
      .values({ campaignId: scope.campaignId, ...request })
      .returning(),
  );
  if (row === undefined) throw new Error('domain insert returned no row');
  return toDomain(db, scope, row);
}

export async function updateDomain(
  db: Database,
  scope: CampaignScope,
  domainId: string,
  patch: UpdateDomainRequest,
): Promise<Domain> {
  const [row] = await namedOnce(() =>
    db.update(domains).set(patch).where(scoped(scope, domainId)).returning(),
  );
  if (row === undefined) throw httpError(404, DOMAIN_NOT_FOUND);
  return toDomain(db, scope, row);
}

/** "Fireball, Ward and 3 more cards". */
function namesOf(names: readonly string[], total: number): string {
  const shown = names.slice(0, NAMED);
  const more = total - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${String(more)} more cards`;
  if (shown.length === 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''}`;
}

/** Deletes a domain no card uses; otherwise 409, naming the cards in the way. */
export async function deleteDomain(
  db: Database,
  scope: CampaignScope,
  domainId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: domains.id })
      .from(domains)
      .where(scoped(scope, domainId))
      .for('update');
    if (current === undefined) throw httpError(404, DOMAIN_NOT_FOUND);

    const cards = await cardsOf(tx, scope, domainId);
    if (cards.length > 0) {
      const names = namesOf(
        cards.map((card) => card.name),
        cards.length,
      );
      throw httpError(409, `Used by ${names}. Move or delete them first.`);
    }
    await tx.delete(domains).where(scoped(scope, domainId));
  });
}
