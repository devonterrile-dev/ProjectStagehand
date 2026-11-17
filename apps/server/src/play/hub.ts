/**
 * Who is connected to each campaign's live session (F3.3, governance §13). Kept in memory: it
 * is true only while this process runs, and after a restart every browser reconnects and joins
 * again. The stage itself is in the database.
 *
 * One person may have several connections (two tabs, or a tab and the Discord Activity); they
 * are listed once and take one seat.
 */
import { SESSION_MAX_PLAYERS, type Presence, type PresenceMember } from '@stagehand/shared';

interface Seat {
  member: PresenceMember;
  /** The ids of this person's connections. */
  sockets: Set<string>;
}

export class PlayHub {
  /** Campaign id → user id → their seat. */
  readonly #campaigns = new Map<string, Map<string, Seat>>();

  /**
   * Seats a connection. False when the session already has its 6 players (§3) and this is not
   * one of them; the GM always gets in, and so does another connection of someone seated.
   */
  enter(campaignId: string, member: PresenceMember, socketId: string): boolean {
    const seats = this.#campaigns.get(campaignId) ?? new Map<string, Seat>();
    const seat = seats.get(member.userId);
    if (seat !== undefined) {
      // Their name or PC may have changed since they first came in; whether they are talking
      // is this room's to know, not the new connection's.
      seat.member = { ...member, speaking: seat.member.speaking };
      seat.sockets.add(socketId);
      return true;
    }

    if (member.role === 'player') {
      let players = 0;
      for (const other of seats.values()) if (other.member.role === 'player') players += 1;
      if (players >= SESSION_MAX_PLAYERS) return false;
    }
    seats.set(member.userId, { member, sockets: new Set([socketId]) });
    this.#campaigns.set(campaignId, seats);
    return true;
  }

  /** Forgets a connection. True when that was the person's last one, so they are gone. */
  leave(campaignId: string, userId: string, socketId: string): boolean {
    const seats = this.#campaigns.get(campaignId);
    const seat = seats?.get(userId);
    if (seats === undefined || seat === undefined) return false;

    seat.sockets.delete(socketId);
    if (seat.sockets.size > 0) return false;
    seats.delete(userId);
    if (seats.size === 0) this.#campaigns.delete(campaignId);
    return true;
  }

  /**
   * Whether someone seated is talking (F3.7). True when that changed, so presence goes out
   * again; false for someone not seated, or no change. It goes with their seat.
   */
  setSpeaking(campaignId: string, userId: string, speaking: boolean): boolean {
    const seat = this.#campaigns.get(campaignId)?.get(userId);
    if (seat === undefined || seat.member.speaking === speaking) return false;
    seat.member = { ...seat.member, speaking };
    return true;
  }

  /** Everyone connected to the campaign's session: the GM first, then players by name. */
  presence(campaignId: string): Presence {
    const seats = this.#campaigns.get(campaignId);
    if (seats === undefined) return [];
    return [...seats.values()]
      .map((seat) => seat.member)
      .sort(
        (a, b) =>
          Number(b.role === 'gm') - Number(a.role === 'gm') ||
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }) ||
          a.userId.localeCompare(b.userId),
      );
  }

  /** Empties a campaign's room: its session ended. */
  clear(campaignId: string): void {
    this.#campaigns.delete(campaignId);
  }
}
