/**
 * The running session, shared by the live stage (`play-sessions.ts`) and rolls (`rolls.ts`, F3.6):
 * finding it, holding it for a change, and writing to its log.
 */
import type { SessionLogKind } from '@stagehand/shared';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../db/client';
import { playSessions, sessionEvents } from '../db/schema';
import { httpError } from '../http/errors';

import type { CampaignScope } from './scope';

export type SessionRow = typeof playSessions.$inferSelect;
/** A transaction: everything that changes a stage runs in one, holding the session row. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const NO_SESSION = 'No session is running';

/** `campaign_id = scope.campaignId and ended_at is null`: the campaign's running session. */
export function running(scope: CampaignScope) {
  return and(eq(playSessions.campaignId, scope.campaignId), isNull(playSessions.endedAt));
}

/** The running session, held until the transaction ends, so changes to one stage go in turn. */
export async function lockRunning(tx: Tx, scope: CampaignScope): Promise<SessionRow> {
  const [session] = await tx.select().from(playSessions).where(running(scope)).for('update');
  if (session === undefined) throw httpError(409, NO_SESSION);
  return session;
}

/** Appends one line to the session's log (§8 `session_events`). */
export async function logEvent(
  tx: Tx,
  scope: CampaignScope,
  session: { id: string },
  kind: SessionLogKind,
  fields: { actorUserId?: string | null; recordId?: string | null; data?: Record<string, unknown> },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(sessionEvents)
    .values({
      playSessionId: session.id,
      campaignId: scope.campaignId,
      kind,
      actorUserId: fields.actorUserId ?? null,
      recordId: fields.recordId ?? null,
      data: fields.data ?? {},
    })
    .returning({ id: sessionEvents.id });
  if (row === undefined) throw new Error('session event insert returned no row');
  return row;
}
