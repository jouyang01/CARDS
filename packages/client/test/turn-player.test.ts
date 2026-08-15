import { describe, expect, it } from 'vitest';
import { resolveTurn, type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster, type UnitOrders } from '@cards/engine';
import { createTurnPlayer, cuesOfPhase } from '../src/turn-player.js';
import { playEvents, type ViewState } from '../src/playback.js';

/**
 * A3's required invariant: **skipping lands on a `ViewState` identical to
 * watching**. Both paths fold the same events through `applyEvent`, so a player
 * who skips the animation is never shown a different board.
 */

const OPEN: MapDef = { id: 't', name: 't', width: 13, height: 13, walls: [], cover: [], brush: [], spawns: [[{ x: 1, y: 6 }], [{ x: 11, y: 6 }]] };
const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'square', range: 8, cooldown: 0, energyGain: 0, effects: [], description: over.id, ...over,
});
const char: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shoot', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'guard', phase: 'prep', shape: 'self', range: 0, effects: [{ kind: 'shield', amount: 30, duration: 2 }] }),
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, energyGain: 8, effects: [{ kind: 'damage', amount: 15 }, { kind: 'knockback', amount: 1 }] }),
    ability({ id: 'ping', shape: 'line', range: 6, energyGain: 4, effects: [{ kind: 'damage', amount: 5 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'square', range: 8, effects: [{ kind: 'damage', amount: 40 }] }),
};
const roster: Roster = { 'test-char': char };

const mkUnit = (unitId: string, owner: 0 | 1, x: number, y: number, over: Partial<GameState['units'][number]> = {}) =>
  ({ unitId, characterId: 'test-char', owner, pos: { x, y }, hp: 100, maxHp: 100, energy: 0, alive: true, respawnIn: 0, cooldowns: {}, statuses: [], catalysts: [], catalystsUsed: [], ...over });
const mkState = (units: GameState['units'], over: Partial<GameState> = {}): GameState =>
  ({ turn: 1, units, traps: [], delayed: [], decoys: [], powerups: [], kills: [0, 0], format: '2v2', status: 'active', suddenDeath: false, ...over });
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);

/** A comparable snapshot of everything the board shows. */
const snapshot = (v: ViewState) => ({
  units: [...v.units.entries()].sort(([a], [b]) => a.localeCompare(b)),
  decoys: [...v.decoys.entries()].sort(([a], [b]) => a.localeCompare(b)),
  kills: v.kills, status: v.status, winner: v.winner,
});

/** A busy turn: shields, a charge with knockback, mutual fire, a death, and moves. */
function busyTurn() {
  const a = mkUnit('a', 0, 1, 6);
  const b = mkUnit('b', 0, 1, 9, { hp: 10 });
  const e = mkUnit('e', 1, 4, 6);
  const e2 = mkUnit('e2', 1, 5, 9);
  const prev = mkState([a, b, e, e2]);
  const result = run(prev, [
    { unitId: 'a', ability: { abilityId: 'charge', target: [{ x: 2, y: 6 }, { x: 3, y: 6 }] } },
    { unitId: 'b', ability: { abilityId: 'guard', target: [] } },
  ], [
    { unitId: 'e2', ability: { abilityId: 'shoot', target: [{ x: 0, y: 9 }] } }, // kills b (10 hp)
    { unitId: 'e', movePath: [{ x: 5, y: 5 }] },
  ]);
  return { prev, ...result };
}

describe('A3: skip lands exactly where watching lands', () => {
  it('skipping immediately equals folding the whole log', () => {
    const { prev, events } = busyTurn();
    const player = createTurnPlayer(prev, events);
    player.skip();
    expect(snapshot(player.view)).toEqual(snapshot(playEvents(prev, events)));
    expect(player.done()).toBe(true);
  });

  it('watching every phase equals skipping', () => {
    const { prev, events } = busyTurn();
    const watched = createTurnPlayer(prev, events);
    while (watched.advancePhase() !== undefined) { /* play it through */ }

    const skipped = createTurnPlayer(prev, events);
    skipped.skip();
    expect(snapshot(watched.view)).toEqual(snapshot(skipped.view));
  });

  it('skipping PART-WAY through still lands on the same final state', () => {
    const { prev, events } = busyTurn();
    const player = createTurnPlayer(prev, events);
    player.advancePhase(); // watch Prep
    player.advancePhase(); // watch Dash
    player.skip(); // bail out of the rest
    expect(snapshot(player.view)).toEqual(snapshot(playEvents(prev, events)));
  });

  it('a skipped turn matches the engine board, unit for unit', () => {
    const { prev, events, state } = busyTurn();
    const player = createTurnPlayer(prev, events);
    player.skip();
    for (const u of state.units) {
      const v = player.view.units.get(u.unitId)!;
      expect(v.pos, `${u.unitId} pos`).toEqual(u.pos);
      expect(v.hp, `${u.unitId} hp`).toBe(u.hp);
      expect(v.alive, `${u.unitId} alive`).toBe(u.alive);
    }
    expect(player.view.kills).toEqual(state.kills);
  });

  it('skip is idempotent and safe to call twice', () => {
    const { prev, events } = busyTurn();
    const player = createTurnPlayer(prev, events);
    player.skip();
    const once = snapshot(player.view);
    player.skip();
    expect(snapshot(player.view)).toEqual(once);
  });
});

describe('A3: phase progression is driven by the caller, not by animation', () => {
  it('advancePhase walks the sacred order then reports done', () => {
    const { prev, events } = busyTurn();
    const player = createTurnPlayer(prev, events);
    const seen = [];
    for (let step = player.advancePhase(); step !== undefined; step = player.advancePhase()) seen.push(step.phase);
    expect(seen).toEqual(['prep', 'dash', 'blast', 'move']);
    expect(player.advancePhase()).toBeUndefined();
    expect(player.done()).toBe(true);
  });

  it('each phase hands the caller its own cues to animate', () => {
    const { prev, events } = busyTurn();
    const player = createTurnPlayer(prev, events);
    const dash = [player.advancePhase(), player.advancePhase()][1]!;
    expect(dash.phase).toBe('dash');
    expect(dash.cues.some((c) => c.kind === 'phase' && c.phase === 'dash')).toBe(true);
    // Cues handed out for a phase never belong to another phase's banner.
    for (const c of dash.cues) if (c.kind === 'phase') expect(c.phase).toBe('dash');
  });

  it('cuesOfPhase partitions the timeline with no overlap and no loss', () => {
    const { prev, events } = busyTurn();
    const { cues } = createTurnPlayer(prev, events);
    const parts = (['prep', 'dash', 'blast', 'move'] as const).map((p) => cuesOfPhase(cues, p));
    expect(parts.reduce((n, p) => n + p.length, 0)).toBe(cues.length); // every cue placed once
    for (let i = 1; i < parts.length; i++) {
      const prevEnd = Math.max(...parts[i - 1]!.map((c) => c.t));
      const thisStart = Math.min(...parts[i]!.map((c) => c.t));
      expect(thisStart).toBeGreaterThanOrEqual(prevEnd - 1e-9);
    }
  });

  it('does not mutate the pre-turn state it snapshots', () => {
    const { prev, events } = busyTurn();
    const before = JSON.stringify(prev);
    const player = createTurnPlayer(prev, events);
    player.skip();
    expect(JSON.stringify(prev)).toBe(before);
  });
});
