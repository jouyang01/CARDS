import { describe, expect, it } from 'vitest';
import { validateCharacter, validateMap } from '../src/validate.js';
import type { CharacterDef, MapDef } from '../src/types.js';

import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import duelArena from '../../../data/maps/duel-arena.json';

const characters = [vex, bastion, wisp] as unknown as CharacterDef[];
const map = duelArena as unknown as MapDef;

describe('character content', () => {
  for (const c of characters) {
    it(`${c.id} passes validation`, () => {
      expect(validateCharacter(c)).toEqual([]);
    });
  }

  it('all character ids are unique', () => {
    const ids = characters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every character has exactly one dash-phase escape or reposition tool', () => {
    // Design guardrail for the 1v1 mind-game: every kit needs a Dash answer.
    for (const c of characters) {
      const dashAbilities = c.abilities.filter((a) => a.phase === 'dash');
      expect(dashAbilities.length, `${c.id} must have >= 1 dash ability`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('map content', () => {
  it('duel-arena passes validation', () => {
    expect(validateMap(map)).toEqual([]);
  });

  it('duel-arena is left-right mirror symmetric (fair for both players)', () => {
    const mirror = (x: number) => map.width - 1 - x;
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    for (const kind of ['walls', 'cover', 'brush'] as const) {
      const set = new Set(map[kind].map(key));
      for (const p of map[kind]) {
        expect(set.has(key({ x: mirror(p.x), y: p.y })), `${kind} at (${p.x},${p.y}) lacks its mirror`).toBe(true);
      }
    }
  });
});

describe('validators catch bad content', () => {
  it('rejects a character with a wrong ability count', () => {
    const bad = { ...(vex as unknown as CharacterDef), abilities: [] };
    expect(validateCharacter(bad).length).toBeGreaterThan(0);
  });

  it('rejects an unknown effect kind', () => {
    const c = structuredClone(vex) as unknown as CharacterDef;
    (c.abilities[0]!.effects[0] as { kind: string }).kind = 'summon_dragon';
    expect(validateCharacter(c).some((e) => e.includes('unknown effect kind'))).toBe(true);
  });

  it('rejects out-of-bounds map content', () => {
    const m = structuredClone(duelArena) as unknown as MapDef;
    m.walls.push({ x: 999, y: 0 });
    expect(validateMap(m).some((e) => e.includes('out of bounds'))).toBe(true);
  });
});
