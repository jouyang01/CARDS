import { describe, expect, it } from 'vitest';
import { ULT_COST, type GameState, type StatusInstance, type TeamId, type UnitState } from '@cards/engine';
import { clock, scoreReadout, tally, topbar } from '../src/scoreboard.js';

/**
 * UI-TOPBAR (ar-parity §4.4) — the match strip.
 *
 * SCORE1 already computed every number in it. What was missing was the
 * *arrangement*: the old strip listed all eight units in one undifferentiated
 * row, so "how is my team doing" meant reading names. AR's answer is that your
 * side sits on your side — friendly portraits, both scores with the clock
 * between them, enemy portraits — and the ordering is the content.
 *
 * Which makes the interesting property a relative one: the strip is built from
 * the viewer's point of view, so the same state seen from the other seat must
 * come out as the exact mirror. That is the test the rest hang off.
 */

const unit = (id: string, owner: TeamId, over: Partial<UnitState> = {}): UnitState => ({
  unitId: id, characterId: 'c', owner, pos: { x: 1, y: 1 }, hp: 80, maxHp: 100, energy: 0,
  alive: true, respawnIn: 0, cooldowns: {}, statuses: [] as StatusInstance[],
  catalysts: [], catalystsUsed: [], ...over,
});

const state = (units: UnitState[], over: Partial<GameState> = {}): GameState => ({
  turn: 3, units, traps: [], delayed: [], decoys: [], powerups: [], lastKnown: [],
  kills: [2, 1], format: '2v2', status: 'active', suddenDeath: false, ...over,
});

const names = (id: string): string => id.toUpperCase();
const bar = (s: GameState, viewer: TeamId) => topbar(scoreReadout(s, names), viewer);

const FOUR = [unit('ana', 0), unit('bo', 0), unit('cy', 1), unit('di', 1)];

describe('UI-TOPBAR: your side is on your side', () => {
  it('splits the portraits by the viewer, not by team number', () => {
    const seen = bar(state(FOUR), 0);
    expect(seen.friendly.map((p) => p.unitId)).toEqual(['ana', 'bo']);
    expect(seen.enemy.map((p) => p.unitId)).toEqual(['cy', 'di']);
  });

  it('and the other seat sees the exact mirror', () => {
    const seen = bar(state(FOUR), 1);
    expect(seen.friendly.map((p) => p.unitId)).toEqual(['cy', 'di']);
    expect(seen.enemy.map((p) => p.unitId)).toEqual(['ana', 'bo']);
    expect(seen.friendlyTeam).toBe(1);
    expect(seen.enemyTeam).toBe(0);
  });

  it('the scores swap with the sides', () => {
    expect(bar(state(FOUR), 0)).toMatchObject({ friendlyKills: 2, enemyKills: 1 });
    expect(bar(state(FOUR), 1)).toMatchObject({ friendlyKills: 1, enemyKills: 2 });
  });

  it('the clock does not — it is the same match from both chairs', () => {
    const a = bar(state(FOUR), 0);
    const b = bar(state(FOUR), 1);
    expect([a.turn, a.turnLimit, a.killTarget]).toEqual([b.turn, b.turnLimit, b.killTarget]);
  });

  it('works in a format with one character a side', () => {
    // Never hardcode a team size: 1v1 is a supported dev format and 4v4 is a
    // supported real one.
    const duel = state([unit('ana', 0), unit('cy', 1)], { format: '1v1' });
    expect(bar(duel, 0).friendly).toHaveLength(1);
    expect(bar(duel, 0).enemy).toHaveLength(1);
  });
});

describe('UI-TOPBAR: a portrait is the attrition read', () => {
  it('carries a mini HP bar as a percentage', () => {
    const seen = bar(state([unit('ana', 0, { hp: 25, maxHp: 100 })]), 0);
    expect(seen.friendly[0]).toMatchObject({ hp: 25, maxHp: 100, hpPct: 25 });
  });

  it('rounds rather than truncating, so 1 HP is not an empty bar', () => {
    const seen = bar(state([unit('ana', 0, { hp: 1, maxHp: 95 })]), 0);
    expect(seen.friendly[0]!.hpPct).toBe(1);
  });

  it('a downed unit reads zero and shows how long until it is back', () => {
    // The bar is "how much fight is left in them", and while they are down the
    // answer is none — the useful number is the countdown.
    const seen = bar(state([unit('ana', 0, { alive: false, hp: 0, respawnIn: 2 })]), 0);
    expect(seen.friendly[0]).toMatchObject({ alive: false, hpPct: 0, respawnIn: 2 });
  });

  it('an alive unit never reports a respawn count', () => {
    expect(bar(state([unit('ana', 0)]), 0).friendly[0]!.respawnIn).toBe(0);
  });

  it('flags a charged ultimate, the same warning the nameplate gives', () => {
    // The top strip is where you scan for "who can delete me this turn".
    const charged = bar(state([unit('ana', 0, { energy: ULT_COST })]), 0);
    expect(charged.friendly[0]!.ultReady).toBe(true);
    const nearly = bar(state([unit('ana', 0, { energy: ULT_COST - 1 })]), 0);
    expect(nearly.friendly[0]!.ultReady).toBe(false);
  });

  it('takes its initial from the display name, not the unit id', () => {
    expect(bar(state([unit('ana', 0)]), 0).friendly[0]).toMatchObject({ name: 'ANA', initial: 'A' });
  });
});

describe('UI-TOPBAR: the centre block', () => {
  it('shows kills against the format target', () => {
    const seen = bar(state(FOUR), 0);
    expect(seen.killTarget).toBeGreaterThan(0);
    expect(tally(seen.friendlyKills, seen.killTarget)).toBe(`2 / ${seen.killTarget}`);
  });

  it('turn X of Y stays load-bearing — it is the anti-stall clock', () => {
    const seen = bar(state(FOUR), 0);
    expect(clock(seen.turn, seen.turnLimit)).toBe(`Turn 3 of ${seen.turnLimit}`);
  });

  it('sudden death is carried so it can replace the clock', () => {
    // The one thing in the strip that changes how a turn should be played, so
    // it takes the clock's place rather than sitting beside it.
    expect(bar(state(FOUR, { suddenDeath: true }), 0).suddenDeath).toBe(true);
  });
});
