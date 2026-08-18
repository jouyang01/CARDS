/**
 * M3-RECONNECT (client half) — the ticket, and how hard to try.
 *
 * The server holds a disconnected seat for its original occupant and lets it
 * back in by **naming the seat** (an identity-matched reclaim). So the client's
 * whole job is to remember which seat it was, hand that back on the next
 * handshake, and decide when to stop trying — three decisions, all of them
 * rules rather than plumbing, which is why they are here and not inline in
 * `main.ts`.
 *
 * Pure and storage-agnostic: the store is injected (`ticketsIn(localStorage)`),
 * and the backoff is a function of an attempt number rather than a timer. The
 * one place that reads a real clock or a real `Storage` is the shell in
 * `main.ts`, where a shell belongs.
 */

/** Where a seat id is remembered, namespaced so two rooms cannot collide. */
export const TICKET_PREFIX = 'cards.seat.';

/** Room codes are case-insensitive to a player; the key must not be. */
export const ticketKey = (code: string): string => `${TICKET_PREFIX}${code.toUpperCase()}`;

/** The three things this client does with a remembered seat. */
export interface TicketStore {
  get(code: string): string | undefined;
  put(code: string, seatId: string): void;
  clear(code: string): void;
}

/** The subset of `Storage` a ticket needs. A plain object satisfies it. */
export type TicketStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * A ticket store over any `Storage`-shaped thing.
 *
 * Every call is wrapped, because storage **throws** in the two places it is most
 * likely to be used: a private-browsing context and a page with cookies
 * disabled. A reconnect that could not be attempted is a worse outcome than one
 * that is not remembered, but a match that dies on `localStorage` throwing is
 * worse than both.
 */
export function ticketsIn(storage: TicketStorage | undefined): TicketStore {
  return {
    get(code) {
      try {
        return storage?.getItem(ticketKey(code)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    put(code, seatId) {
      try {
        storage?.setItem(ticketKey(code), seatId);
      } catch { /* nothing to do — the reconnect simply will not be offered */ }
    },
    clear(code) {
      try {
        storage?.removeItem(ticketKey(code));
      } catch { /* as above */ }
    },
  };
}

/**
 * How many times a dropped client tries before it gives up and says so.
 *
 * Finite on purpose. A client that retried forever would sit on a "reconnecting…"
 * banner over a room that was torn down an hour ago, which reads exactly like
 * the freeze M3-CONN-STATE exists to stop.
 */
export const RECONNECT_ATTEMPTS = 5;

/** The first delay. Doubling from here, so the five attempts span ~15 seconds. */
export const RECONNECT_BASE_MS = 500;

/**
 * How long to wait before attempt `n` (1-based), or `undefined` once the
 * attempts are spent.
 *
 * Exponential rather than a fixed interval: the overwhelmingly common cause is
 * a momentary drop that the first retry fixes, and the rarer one is a server
 * that is coming back up and does not need five hits a second while it does.
 */
export function reconnectDelayMs(attempt: number): number | undefined {
  if (attempt < 1 || attempt > RECONNECT_ATTEMPTS) return undefined;
  return RECONNECT_BASE_MS * 2 ** (attempt - 1);
}

/**
 * Is a reconnect worth attempting at all?
 *
 * Only with a ticket, and only from a socket that actually dropped. A client
 * that never got a seat has nothing to reclaim, and one that is still connected
 * has nothing to reconnect to — and retrying either would turn an ordinary
 * refusal (a full room, a bad code) into an endless loop of the same refusal.
 */
export function shouldReconnect(
  phase: 'connecting' | 'lobby' | 'match' | 'reconnecting' | 'closed',
  ticket: string | undefined,
  attempt: number,
): boolean {
  if (ticket === undefined) return false;
  if (phase !== 'closed' && phase !== 'reconnecting') return false;
  return reconnectDelayMs(attempt) !== undefined;
}
