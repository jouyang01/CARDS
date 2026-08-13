import { describe, expect, it } from 'vitest';
import { validateCharacter, validateMap } from '../src/validate.js';
import { BENEFICIAL_KINDS, HARMFUL_KINDS, NEUTRAL_KINDS } from '../src/resolve.js';
import { MAX_ABILITY_RANGE } from '../src/constants.js';
import { EFFECT_KINDS, type CharacterDef, type MapDef } from '../src/types.js';

import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import kestrel from '../../../data/characters/kestrel.json';
import cinder from '../../../data/characters/cinder.json';
import lumen from '../../../data/characters/lumen.json';
import thorn from '../../../data/characters/thorn.json';
import aegis from '../../../data/characters/aegis.json';
import ravok from '../../../data/characters/ravok.json';
import duelArena from '../../../data/maps/duel-arena.json';

const characters = [vex, bastion, wisp, kestrel, cinder, lumen, thorn, aegis, ravok] as unknown as CharacterDef[];
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

  it('every non-support character has a dash-phase escape or reposition tool', () => {
    // Design guardrail for the mind-game: damage/tank/trickster kits need a Dash
    // answer. Support may trade mobility for sustain (R6) — Thorn ships with no
    // dash (Lumen still has one). Flagged for the Analyzer to confirm intended.
    for (const c of characters) {
      if (c.archetype === 'support') continue;
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

  it('rejects a chargeHits value other than "first"/"all" (R1b)', () => {
    const c = structuredClone(kestrel) as unknown as CharacterDef;
    (c.ultimate as { chargeHits?: string }).chargeHits = 'some';
    expect(validateCharacter(c).some((e) => e.includes('chargeHits must be'))).toBe(true);
  });

  it('rejects chargeHits on a non-path ability (R1b)', () => {
    const c = structuredClone(vex) as unknown as CharacterDef;
    const line = c.abilities.find((a) => a.shape === 'line')!;
    (line as { chargeHits?: string }).chargeHits = 'all';
    expect(validateCharacter(c).some((e) => e.includes('only valid on a "path"'))).toBe(true);
  });
});

describe('non-ultimate range is capped at 8 (M2)', () => {
  it('rejects a non-ultimate ability above the cap but exempts the ultimate', () => {
    const over = structuredClone(vex) as unknown as CharacterDef;
    over.abilities[0]!.range = MAX_ABILITY_RANGE + 1;
    expect(validateCharacter(over).some((e) => e.includes('non-ultimate range must be'))).toBe(true);

    // Lance of Dawn is range 99 by design — the shipped roster must stay valid.
    expect((vex as unknown as CharacterDef).ultimate.range).toBeGreaterThan(MAX_ABILITY_RANGE);
    expect(validateCharacter(vex as unknown as CharacterDef)).toEqual([]);
  });

  it('accepts a non-ultimate exactly at the cap (Rail Shot stays 8)', () => {
    const at = structuredClone(vex) as unknown as CharacterDef;
    at.abilities[0]!.range = MAX_ABILITY_RANGE;
    expect(validateCharacter(at)).toEqual([]);
  });

  it('every shipped non-ultimate ability is within the cap', () => {
    for (const c of characters) {
      for (const a of c.abilities) {
        expect(a.range, `${c.id}.${a.id} range`).toBeLessThanOrEqual(MAX_ABILITY_RANGE);
      }
    }
  });
});

describe('effect polarity table is total (R7)', () => {
  it('every EFFECT_KIND appears in exactly one polarity row', () => {
    for (const kind of EFFECT_KINDS) {
      const rows = [HARMFUL_KINDS, BENEFICIAL_KINDS, NEUTRAL_KINDS].filter((s) => s.has(kind)).length;
      expect(rows, `${kind} must be in exactly one polarity row`).toBe(1);
    }
  });

  it('the three rows cover EFFECT_KINDS with no extras', () => {
    expect(HARMFUL_KINDS.size + BENEFICIAL_KINDS.size + NEUTRAL_KINDS.size).toBe(EFFECT_KINDS.length);
  });
});
