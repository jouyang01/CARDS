/**
 * Seats and order shaping: who controls which characters, and how each player's
 * 1–2 `UnitOrders` become the two per-team `PlayerOrders` `resolveTurn` takes.
 *
 * **Why this is in the engine.** It began as client hot-seat plumbing, but it is
 * pure order-shaping over plain data with no rendering and no I/O in it, and M3
 * needs the *same* answer server-side — the Durable Object merges the same way,
 * from the same seats, or client and server disagree about whose orders those
 * were. `@cards/server` may not import the client (ARCHITECTURE), so the shared
 * thing lives here. Ruled by the Analyzer, review 2026-09-03.
 *
 * It changes nothing about the engine's contract: `resolveTurn` still sees two
 * teams and nothing about players (ARCHITECTURE "Teams vs. players"). This is
 * the layer *above* that, which is why it is a separate module rather than part
 * of `resolve.ts`.
 */

import type { GameState, PlayerOrders, TeamId, UnitOrders } from './types.js';

/** One player's control: the characters (by unitId) they order this match. */
export interface Seat {
  seatId: string;
  team: TeamId;
  unitIds: string[];
}

/**
 * Split each team's units across the given number of players, ≤ 2 characters
 * per player, as evenly as possible (GAME_SPEC §1). E.g. a 4-unit team with 3
 * players → 2 + 1 + 1; a 2-unit team with 1 player → 2 (the 3-player 2v2 split).
 * `playersPerTeam` is clamped to `[ceil(units/2), units]`.
 */
export function deriveSeats(state: GameState, playersPerTeam: [number, number]): Seat[] {
  const seats: Seat[] = [];
  for (const team of [0, 1] as const) {
    const ids = state.units.filter((u) => u.owner === team).map((u) => u.unitId);
    const minPlayers = Math.ceil(ids.length / 2);
    const players = Math.max(minPlayers, Math.min(playersPerTeam[team], ids.length));
    const doubles = ids.length - players; // this many players control 2 characters
    let i = 0;
    for (let pl = 0; pl < players; pl++) {
      const count = pl < doubles ? 2 : 1;
      seats.push({ seatId: `t${team}-p${pl}`, team, unitIds: ids.slice(i, i + count) });
      i += count;
    }
  }
  return seats;
}

/**
 * Merge per-seat orders into the two per-team `PlayerOrders`. A seat with no
 * submitted orders contributes nothing (its characters hold). Units are kept in
 * seat then submission order — deterministic.
 */
export function mergeSeatOrders(
  seats: readonly Seat[],
  ordersBySeat: ReadonlyMap<string, UnitOrders[]>,
): [PlayerOrders, PlayerOrders] {
  const teams: [UnitOrders[], UnitOrders[]] = [[], []];
  for (const seat of seats) {
    const orders = ordersBySeat.get(seat.seatId) ?? [];
    teams[seat.team].push(...orders);
  }
  return [
    { team: 0, units: teams[0] },
    { team: 1, units: teams[1] },
  ];
}

/** The seats belonging to a team, in order (the order-entry sequence for a turn). */
export function seatsForTeam(seats: readonly Seat[], team: TeamId): Seat[] {
  return seats.filter((s) => s.team === team);
}
