import { describe, expect, it } from 'vitest';
import { createMatch, formatsSupportedByMap, validateMapForFormat } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { CharacterDef, GameState, MapDef } from '../src/types.js';
import duelArena from '../../../data/maps/duel-arena.json';

const ARENA = duelArena as unknown as MapDef;
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

const mkChar = (id: string): CharacterDef => ({
  id, name: id, archetype: 'firepower', maxHp: 100,
  abilities: Array.from({ length: 4 }, (_, i) => ({
    id: `${id}-a${i}`, name: 'a', phase: 'blast', shape: 'self', range: 0, cooldown: 0, energyGain: 0,
    effects: [{ kind: 'might', duration: 1 }], description: 'x',
  })),
  ultimate: { id: `${id}-ult`, name: 'u', phase: 'blast', shape: 'self', range: 0, cooldown: 0, energyGain: 0, effects: [{ kind: 'might', duration: 1 }], description: 'x' },
});

describe('createMatch — multi-unit placement', () => {
  const map = makeMap(['.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], {
    spawns: [[{ x: 0, y: 0 }, { x: 0, y: 2 }], [{ x: 8, y: 8 }, { x: 8, y: 6 }]],
  });

  it('places each team on its spawn squares in map order, with unique ids and the format', () => {
    const state = createMatch(map, '2v2', [[mkChar('vex'), mkChar('wisp')], [mkChar('bastion'), mkChar('nyx')]]);
    expect(state.format).toBe('2v2');
    expect(state.units.map((u) => [u.unitId, u.owner, u.pos])).toEqual([
      ['vex-t0-0', 0, { x: 0, y: 0 }],
      ['wisp-t0-1', 0, { x: 0, y: 2 }],
      ['bastion-t1-0', 1, { x: 8, y: 8 }],
      ['nyx-t1-1', 1, { x: 8, y: 6 }],
    ]);
    expect(state.units.every((u) => u.hp === u.maxHp && u.alive)).toBe(true);
  });

  it('is deterministic', () => {
    const a = createMatch(map, '2v2', [[mkChar('vex'), mkChar('wisp')], [mkChar('bastion'), mkChar('nyx')]]);
    const b = createMatch(map, '2v2', [[mkChar('vex'), mkChar('wisp')], [mkChar('bastion'), mkChar('nyx')]]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('throws when a team has more characters than spawn squares', () => {
    expect(() => createMatch(map, '4v4', [[mkChar('a'), mkChar('b'), mkChar('c'), mkChar('d')], [mkChar('e')]])).toThrow();
  });
});

describe('map/format validation', () => {
  it('requires spawns-per-team >= characters-per-team', () => {
    const twoSpawns = makeMap(['....', '....', '....', '....'], { spawns: [[{ x: 0, y: 0 }, { x: 0, y: 1 }], [{ x: 3, y: 3 }, { x: 3, y: 2 }]] });
    expect(validateMapForFormat(twoSpawns, '2v2')).toEqual([]);
    expect(validateMapForFormat(twoSpawns, '4v4').length).toBeGreaterThan(0);
    expect(formatsSupportedByMap(twoSpawns, ['1v1', '2v2', '4v4'])).toEqual(['1v1', '2v2']);
  });

  it('the real duel-arena supports every format (4 spawns per side)', () => {
    expect(formatsSupportedByMap(ARENA, ['1v1', '2v2', '4v4'])).toEqual(['1v1', '2v2', '4v4']);
  });
});

describe('respawn to the first unoccupied team spawn square', () => {
  it('uses the second spawn when the first is held by a living ally', () => {
    const map = makeMap(['.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], {
      spawns: [[{ x: 0, y: 0 }, { x: 0, y: 2 }], [{ x: 8, y: 8 }, { x: 8, y: 6 }]],
    });
    const a1 = makeUnit('a1', 0, { x: 0, y: 0 }); // living ally sitting on spawn[0]
    const a2 = makeUnit('a2', 0, { x: 5, y: 5 }, { alive: false, hp: 0, respawnIn: 1 }); // due to respawn now
    const enemy = makeUnit('E', 1, { x: 8, y: 8 });
    const { state, events } = resolveTurn(makeState([a1, a2, enemy]), map, [{ player: 0, units: [] }, { player: 1, units: [] }], {} as Roster);
    expect(unit(state, 'a1').pos).toEqual({ x: 0, y: 0 }); // ally held its spawn
    expect(unit(state, 'a2').alive).toBe(true);
    expect(unit(state, 'a2').pos).toEqual({ x: 0, y: 2 }); // respawned to the first free spawn
    expect(events.some((e) => e.type === 'respawn' && e.unitId === 'a2')).toBe(true);
  });
});
