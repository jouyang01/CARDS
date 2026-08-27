import { describe, expect, it } from 'vitest';
import { buildCatalystPool, type CatalystData } from '../src/catalysts.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, TurnEvent, UnitOrders } from '../src/types.js';

/**
 * TELEPORT-FLAG — a `moveStep` says whether the unit ARRIVED or CROSSED.
 *
 * The engine treats every step the same; this flag is purely for the renderer,
 * which has no other way to tell a blink from a walk once the step is one square
 * long. A blink that lands next door emits the identical `{from, to}` a walked
 * step would, so `animate.ts` used to slide it — the "Wisp's blink should be a
 * teleport, not a slide" report. `teleport(): true` closes that: an arriving
 * step carries the mark, a crossed one does not, and the client jumps the former
 * and slides the latter regardless of distance.
 *
 * This is a presentation contract living on an event, exactly like `sourceUnitId`
 * on `damage` — it changes no outcome (determinism is unaffected), so it is
 * asserted here on the log rather than on any state.
 */

const OPEN: MapDef = makeMap(Array.from({ length: 11 }, () => '.'.repeat(11)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'tp', name: 'TP', archetype: 'firepower', maxHp: 100,
  abilities: [
    // A blink: a square-shaped dash that teleports.
    ability({ id: 'blink', phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
    // A charge: a walked dash with a path — the contrast case.
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, effects: [{ kind: 'damage', amount: 1 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { tp: CHAR };
const CATALYSTS = buildCatalystPool({ prep: [], blast: [], dash: [] } as unknown as CatalystData);

const run = (s: GameState, u0: UnitOrders[]): TurnEvent[] =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: [] }], roster, CATALYSTS).events;
const lone = (pos = { x: 5, y: 5 }): GameState =>
  makeState([makeUnit('a', 0, pos, { characterId: 'tp' })]);
const steps = (events: TurnEvent[]) =>
  events.filter((e): e is Extract<TurnEvent, { type: 'moveStep' }> => e.type === 'moveStep');

describe('TELEPORT-FLAG', () => {
  it('a blink that lands one square away is still marked a teleport', () => {
    // The exact case geometry cannot see: |to - from| == 1 looks like a walk.
    const events = run(lone({ x: 5, y: 5 }), [{ unitId: 'a', ability: { abilityId: 'blink', target: [{ x: 6, y: 5 }] } }]);
    const move = steps(events);
    expect(move).toHaveLength(1);
    expect(move[0]!.to).toEqual({ x: 6, y: 5 });
    expect(move[0]!.teleport, 'an adjacent blink still arrives, not crosses').toBe(true);
  });

  it('a blink across open board carries it too', () => {
    const events = run(lone({ x: 5, y: 5 }), [{ unitId: 'a', ability: { abilityId: 'blink', target: [{ x: 9, y: 5 }] } }]);
    expect(steps(events).every((s) => s.teleport === true)).toBe(true);
  });

  it('a walked charge does NOT — every step crosses the ground', () => {
    const events = run(lone({ x: 1, y: 5 }), [{ unitId: 'a', ability: { abilityId: 'charge', target: [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }] } }]);
    const move = steps(events);
    expect(move.length, 'a path charge walks square by square').toBeGreaterThan(1);
    expect(move.some((s) => s.teleport === true), 'none of a charge is a teleport').toBe(false);
  });

  it('a plain Move-phase step is a walk, not a teleport', () => {
    const events = run(lone({ x: 5, y: 5 }), [{ unitId: 'a', movePath: [{ x: 6, y: 5 }] }]);
    const move = steps(events);
    expect(move.length).toBeGreaterThan(0);
    expect(move.every((s) => s.teleport !== true)).toBe(true);
  });
});
