/**
 * M3-WAIT-STATE / M3-CONN-STATE — what a networked client shows when it is not
 * the player's turn to act, and when the socket has gone.
 *
 * Pure, and small on purpose: the whole item is one sentence of text and one
 * boolean, and both are derived from numbers the server already sends. The
 * reason it is a module rather than three lines in the controller is
 * **M3-HIDDEN**: this is the one string that mentions the other team, and the
 * rule is that it may say *how many* of them are ready and never *which*.
 * Written down where a test can hold it.
 */

/**
 * The lock state as the Decision payload reports it — own team per-seat, the
 * enemy as a bare count (M3-LOCKLIST, ruled).
 *
 * Note the asymmetry in the *types*, not just the values: `own` is a list of
 * ids and `enemyReady` is a number, so there is no enemy id in scope to leak
 * even by accident. A shape that carried both as lists would make the rule a
 * matter of remembering.
 */
export interface WaitView {
  /** This client's own seat id, so it can say "you" rather than name itself. */
  seatId: string;
  /** Own-team seat ids that have locked in. */
  own: string[];
  /** How many seats this team has. */
  ownOf: number;
  enemyReady: number;
  enemyOf: number;
}

/**
 * The waiting line, or `undefined` when there is nothing to wait for.
 *
 * `undefined` is the signal the caller acts on — it means "this client is still
 * deciding", so the HUD stays armed. Any string means the turn is sent and the
 * board is locked.
 */
export function waitingLabel(view: WaitView | undefined): string | undefined {
  if (view === undefined) return undefined;
  if (!view.own.includes(view.seatId)) return undefined; // not locked in yet
  const teammates = view.ownOf - 1;
  const teammatesReady = view.own.filter((id) => id !== view.seatId).length;
  const parts = ['Locked in'];
  if (teammates > 0) parts.push(`your team ${teammatesReady + 1}/${view.ownOf}`);
  // The enemy is a count and can only ever be a count — see `WaitView`.
  parts.push(view.enemyReady >= view.enemyOf && view.enemyOf > 0
    ? 'resolving…'
    : `waiting for ${view.enemyOf - view.enemyReady} opponent(s)`);
  return parts.join(' · ');
}

/**
 * DEATH-HANG — the banner for a seat whose every character is currently down.
 *
 * *"Something breaks when a character dies, the lock-in is not possible and the
 * timer bar goes away."* There was genuinely nothing to order, and the client
 * said so by going quiet — which is indistinguishable from having crashed. The
 * turn is not over and the match is not stuck; this seat simply has no move to
 * make, and the difference between that and a freeze is entirely whether it is
 * written on the screen.
 *
 * Here rather than in the controller for the same reason `waitingLabel` is: the
 * strings a player reads while they cannot act are the ones worth having a test
 * hold.
 */
export function downedLabel(down: number, total: number): string {
  const who = total > 1 && down < total ? `${down} of your ${total} characters are` : 'You are';
  return `${who} down — respawning. Nothing to order this turn; the turn resolves without you.`;
}

/** Is this client locked in — the board disarmed, the turn already sent? */
export const isWaiting = (view: WaitView | undefined): boolean => waitingLabel(view) !== undefined;

/**
 * M3-CONN-STATE / M3-RECONNECT — the banner for a socket that has gone away.
 *
 * A dropped connection used to set `phase: 'closed'` and nothing else, so the
 * board simply stopped responding — indistinguishable, to a player, from the
 * game having frozen. Ruled: **say it happened.**
 *
 * Two sentences now, because there are two situations and telling them apart is
 * the whole value of saying anything. `reconnecting` means a reclaim is in
 * flight and the right thing to do is nothing; `closed` means it is not coming
 * back on its own. A single "connection lost" for both would leave a player
 * reloading over a rejoin that was about to succeed — and, worse, sitting
 * patiently through one that never will.
 */
export function connectionLabel(
  phase: 'connecting' | 'lobby' | 'match' | 'reconnecting' | 'closed',
): string | undefined {
  if (phase === 'reconnecting') return 'Connection lost — reconnecting…';
  return phase === 'closed' ? 'Connection lost — the match is paused. Reload to rejoin.' : undefined;
}
