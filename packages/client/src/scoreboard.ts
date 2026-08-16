/**
 * The scoreboard (SCORE1, ar-parity §7.5) — what the match currently stands at,
 * and what each character contributed to it.
 *
 * **Pure, and a pure consumer**, on the same contract as `playback.ts` and
 * `combat-log.ts`: kills, deaths, HP, energy and the turn number are already in
 * `GameState`, and damage/healing totals are *not* — but every one of them is in
 * the event log, which is the rendering contract. So the useful half needs no
 * engine change at all. Nothing here recomputes an outcome; it adds up what the
 * events already stated.
 *
 * The one rule worth stating: **a total is only ever incremented from an event
 * that named a source.** A0 and A0-heal put `sourceUnitId` on `damage`, `heal`
 * and `statusApplied`, so "who dealt this" is answered by the log rather than
 * guessed from who was acting — which is the only reason a DoT tick lands on the
 * right ledger three turns after the ability that lit it.
 */

import { ULT_COST, getFormat, type FormatId, type GameState, type TurnEvent } from '@cards/engine';

/** One character's running contribution to the match. */
export interface UnitTotals {
  unitId: string;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  /** Healing plus shielding granted to anyone, self included. */
  supportGiven: number;
}

/** Per-unit totals, keyed by unitId. Accumulated across the whole match. */
export type MatchTotals = ReadonlyMap<string, UnitTotals>;

const blank = (unitId: string): UnitTotals =>
  ({ unitId, kills: 0, deaths: 0, damageDealt: 0, damageTaken: 0, supportGiven: 0 });

/** An empty ledger — one row per unit, so a character with no turn still shows. */
export function initTotals(state: GameState): MatchTotals {
  return new Map(state.units.map((u) => [u.unitId, blank(u.unitId)]));
}

/**
 * Fold one resolved turn's events into the ledger, returning a new map.
 *
 * `damage` is counted twice on purpose — once as dealt and once as taken —
 * because they are different questions and a shield makes them different
 * numbers: `amount` is what reached HP and `absorbed` is what a shield ate, and
 * both were dealt. Self-damage (friendly fire, FF1) lands on both ledgers of the
 * same unit, which is exactly what happened.
 *
 * A `death` event's `killer` is a **team**, not a unit, so a kill is credited to
 * the unit named by the `damage` that immediately preceded it — the same
 * attribution the combat log reads. That is the only inference in this file, and
 * it is one step: no search, no scoring of "most damage", no guessing.
 */
export function foldTurn(totals: MatchTotals, events: readonly TurnEvent[]): MatchTotals {
  const next = new Map<string, UnitTotals>();
  for (const [id, row] of totals) next.set(id, { ...row });
  const row = (unitId: string): UnitTotals => {
    const existing = next.get(unitId);
    if (existing !== undefined) return existing;
    const fresh = blank(unitId);
    next.set(unitId, fresh);
    return fresh;
  };

  /** Who last damaged whom, so a `death` can be credited to a unit. */
  const lastHitBy = new Map<string, string>();

  for (const e of events) {
    switch (e.type) {
      case 'damage': {
        const dealt = e.amount + e.absorbed;
        row(e.sourceUnitId).damageDealt += dealt;
        row(e.unitId).damageTaken += dealt;
        lastHitBy.set(e.unitId, e.sourceUnitId);
        break;
      }
      case 'heal':
        row(e.sourceUnitId).supportGiven += e.amount;
        break;
      case 'statusApplied':
        // Shielding counts as support given; every other status is an effect
        // with no magnitude to add up.
        if (e.status === 'shield') row(e.sourceUnitId).supportGiven += e.amount ?? 0;
        break;
      case 'death': {
        row(e.unitId).deaths += 1;
        const killer = lastHitBy.get(e.unitId);
        // No preceding damage means nothing in the log names a killer — a
        // friendly-fire kill the engine deliberately credits to nobody, say.
        // Inventing one here would put a point on a scoreboard the engine's own
        // `kills` tally does not have.
        if (killer !== undefined && killer !== e.unitId) row(killer).kills += 1;
        lastHitBy.delete(e.unitId);
        break;
      }
      default:
        break;
    }
  }
  return next;
}

/** One character's row in the in-match strip. */
export interface ScoreRow {
  unitId: string;
  name: string;
  owner: 0 | 1;
  alive: boolean;
  hp: number;
  maxHp: number;
  /** Energy as a percentage of an ultimate, clamped to 100. */
  ultPct: number;
  /** Turns until this unit is back, or 0 when it is alive. */
  respawnIn: number;
}

/** The in-match readout: the tallies and the clock a plan is made against. */
export interface ScoreReadout {
  /** `kills[team]` vs the format's target. */
  kills: [number, number];
  killTarget: number;
  turn: number;
  turnLimit: number;
  /** True once past the turn limit with the kills tied. */
  suddenDeath: boolean;
  rows: ScoreRow[];
}

/** Display names by unit id — the caller owns the roster, this module does not. */
export type UnitNames = (unitId: string) => string;

/**
 * The current readout. Everything here is read straight off the state and the
 * format; nothing is folded, because nothing needs to be.
 */
export function scoreReadout(state: GameState, names: UnitNames): ScoreReadout {
  const format = getFormat(state.format as FormatId);
  return {
    kills: [state.kills[0], state.kills[1]],
    killTarget: format.killsToWin,
    turn: state.turn,
    turnLimit: format.turnLimit,
    suddenDeath: state.suddenDeath,
    rows: state.units.map((u) => ({
      unitId: u.unitId,
      name: names(u.unitId),
      owner: u.owner,
      alive: u.alive,
      hp: u.hp,
      maxHp: u.maxHp,
      ultPct: Math.min(100, Math.floor((u.energy / ULT_COST) * 100)),
      respawnIn: u.alive ? 0 : u.respawnIn,
    })),
  };
}

/**
 * UI-TOPBAR (ar-parity §4.4) — the match strip, laid out the way AR lays it out.
 *
 * AR's top edge reads **friendly portraits · team score · turn · enemy score ·
 * enemy portraits**, and the ordering is the content: your side is on your
 * side. SCORE1 already computed every number in it; what was missing was that
 * the strip listed all eight units in one undifferentiated row, so answering
 * "how is my team doing" meant reading names rather than glancing left.
 *
 * So this is a *rearrangement* of `ScoreReadout`, not a second source of truth,
 * and it takes the viewing team as an argument because "friendly" is a fact
 * about who is looking rather than about the match.
 */
export interface TopbarPortrait {
  unitId: string;
  name: string;
  /** One letter for the portrait plate, until real art exists. */
  initial: string;
  owner: 0 | 1;
  alive: boolean;
  hp: number;
  maxHp: number;
  /** HP as a percentage, for the mini bar. 0 when down. */
  hpPct: number;
  /** Turns until it is back, 0 when alive — the attrition read. */
  respawnIn: number;
  /** Charged, so a portrait can warn about an ult the same way a plate does. */
  ultReady: boolean;
}

export interface TopbarModel {
  friendly: TopbarPortrait[];
  enemy: TopbarPortrait[];
  friendlyTeam: 0 | 1;
  enemyTeam: 0 | 1;
  friendlyKills: number;
  enemyKills: number;
  killTarget: number;
  turn: number;
  turnLimit: number;
  suddenDeath: boolean;
}

const portrait = (row: ScoreRow): TopbarPortrait => ({
  unitId: row.unitId,
  name: row.name,
  initial: (row.name[0] ?? '?').toUpperCase(),
  owner: row.owner,
  alive: row.alive,
  hp: row.hp,
  maxHp: row.maxHp,
  // A dead unit reads 0 rather than its last fraction: the bar is "how much
  // fight is left in them", and the answer while they are down is none.
  hpPct: row.alive ? Math.max(0, Math.min(100, Math.round((row.hp / Math.max(1, row.maxHp)) * 100))) : 0,
  respawnIn: row.respawnIn,
  ultReady: row.ultPct >= 100,
});

/** The strip, from the viewing team's point of view. */
export function topbar(readout: ScoreReadout, viewer: 0 | 1): TopbarModel {
  const enemyTeam: 0 | 1 = viewer === 0 ? 1 : 0;
  return {
    friendly: readout.rows.filter((r) => r.owner === viewer).map(portrait),
    enemy: readout.rows.filter((r) => r.owner === enemyTeam).map(portrait),
    friendlyTeam: viewer,
    enemyTeam,
    friendlyKills: readout.kills[viewer],
    enemyKills: readout.kills[enemyTeam],
    killTarget: readout.killTarget,
    turn: readout.turn,
    turnLimit: readout.turnLimit,
    suddenDeath: readout.suddenDeath,
  };
}

/** How a finished match ended (GAME_SPEC §1). */
export type EndReason = 'killTarget' | 'turnLimit' | 'suddenDeath';

export interface MatchResult {
  /** Absent for a draw — a Double KO has no winner. */
  winner?: 0 | 1;
  draw: boolean;
  kills: [number, number];
  reason: EndReason;
  /** Per-character breakdown, in `state.units` order. */
  rows: (ScoreRow & UnitTotals)[];
}

/**
 * The end-of-match breakdown. `reason` is derived from the state the engine
 * finished in rather than from a flag it does not carry: reaching the kill
 * target is the only way to win before the limit, so anything decided at or past
 * the limit was decided by the clock — and by sudden death if the engine was in
 * it. A **Double KO** is the draw case and keeps no winner at all.
 */
export function matchResult(state: GameState, names: UnitNames): MatchResult {
  const format = getFormat(state.format as FormatId);
  const hitTarget = state.kills[0] >= format.killsToWin || state.kills[1] >= format.killsToWin;
  const reason: EndReason = state.suddenDeath ? 'suddenDeath' : hitTarget ? 'killTarget' : 'turnLimit';
  return {
    winner: state.status === 'draw' ? undefined : state.winner,
    draw: state.status === 'draw',
    kills: [state.kills[0], state.kills[1]],
    reason,
    rows: [],
  };
}

/**
 * The end-of-match breakdown *with* the folded totals attached — the form the
 * end screen actually renders. Split from {@link matchResult} so the outcome
 * half stays testable without a ledger.
 */
export function matchBreakdown(state: GameState, names: UnitNames, totals: MatchTotals): MatchResult {
  const result = matchResult(state, names);
  const readout = scoreReadout(state, names);
  return {
    ...result,
    rows: readout.rows.map((r) => ({ ...r, ...(totals.get(r.unitId) ?? blank(r.unitId)) })),
  };
}

/** "2 / 4" — the tally a player reads to know how close the match is. */
export const tally = (kills: number, target: number): string => `${kills} / ${target}`;

/** "Turn 7 of 16" — the clock the Support anti-stall balance depends on. */
export const clock = (turn: number, limit: number): string => `Turn ${turn} of ${limit}`;

/** A human sentence for how the match ended. */
export function endReasonText(result: MatchResult): string {
  if (result.draw) return 'Double KO — the match is a draw.';
  const team = `Team ${(result.winner ?? 0) + 1}`;
  switch (result.reason) {
    case 'killTarget':
      return `${team} wins on kills, ${result.kills[0]}–${result.kills[1]}.`;
    case 'suddenDeath':
      return `${team} wins in sudden death, ${result.kills[0]}–${result.kills[1]}.`;
    case 'turnLimit':
      return `${team} wins on the turn limit, ${result.kills[0]}–${result.kills[1]}.`;
  }
}
