import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGHT_PCT, MOVE_RANGE, WEAKEN_PCT } from '../src/constants.js';
import {
  CATALYST_PHASES,
  DEFAULT_CATALYSTS,
  buildCatalystPool,
  validateCatalysts,
  type CatalystData,
} from '../src/catalysts.js';
import { createMatch } from '../src/setup.js';
import { hasStatus } from '../src/status.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

/**
 * CAT1 — three catalyst slots, one per phase, each spent once per match.
 *
 * The rulings here fail **silently**, which is why each is measured as an
 * *outcome* rather than an event: a Blast catalyst resolved after the Blast
 * damage step boosts nothing until next turn (Adrenaline and Overdrive become
 * no-ops that still cost you the slot), and the Move a Dash catalyst does or
 * does not consume is invisible unless something asserts where the unit ended
 * up. That second one has since been reversed by owner directive — see
 * CAT-DASH-COST below.
 */

const DATA = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../data/catalysts.json'), 'utf8'),
) as CatalystData;
const POOL = buildCatalystPool(DATA);

const OPEN = makeMap(Array.from({ length: 21 }, () => '.'.repeat(21)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 8,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shot', shape: 'line', range: 8 }),
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, cooldown: 2, energyGain: 4 }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const setup = (): GameState => makeState([
  makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'test-char' }),
  makeUnit('e', 1, { x: 10, y: 10 }, { characterId: 'test-char' }),
]);
const run = (s: GameState, units: UnitOrders[], enemy: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0, units }, { team: 1, units: enemy }], roster, POOL);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const walk = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 5 + i, y: 10 }));
/** Swap a unit's Blast/Dash/Prep slot for the catalyst under test (M3 picks these). */
const withCatalyst = (s: GameState, id: string): GameState => {
  const u = s.units.find((x) => x.unitId === 'a')!;
  const phase = POOL[id]!.phase;
  u.catalysts = u.catalysts.map((c) => (POOL[c]!.phase === phase ? id : c));
  return s;
};

describe('CAT1: the pool is content, and it validates', () => {
  it('data/catalysts.json is structurally sound', () => {
    expect(validateCatalysts(DATA)).toEqual([]);
  });

  it('is a four-per-phase pool (prep still 3 until Regenergy lands), each unique', () => {
    // AR's pool is four per phase and this is heading there. Prep is still 3
    // because its fourth (Regenergy) needs `healOverTime` — it lands with
    // DOT-HOT, at which point this becomes 12 and a flat 4 per phase.
    expect(Object.keys(POOL)).toHaveLength(11);
    expect(DATA.prep).toHaveLength(3);
    expect(DATA.dash).toHaveLength(4);
    expect(DATA.blast).toHaveLength(4);
    for (const phase of CATALYST_PHASES) {
      for (const def of DATA[phase]) expect(def.phase, def.id).toBe(phase);
    }
  });

  it('every one is a free, once-per-match action that grants no energy', () => {
    for (const def of Object.values(POOL)) {
      expect(def.free, def.id).toBe(true);
      expect(def.oncePerMatch, def.id).toBe(true);
      expect(def.energyGain, def.id).toBe(0);
      expect(def.cooldown, def.id).toBe(0);
    }
  });

  it('needs no new EFFECT_KIND — every effect is one the engine already has', () => {
    // The claim the design rests on: the whole pool, zero engine surface.
    // (Regenergy will be the first exception — it lands with DOT-HOT, which
    // adds `healOverTime` deliberately rather than by accident.)
    const kinds = new Set(Object.values(POOL).flatMap((d) => d.effects.map((e) => e.kind)));
    expect([...kinds].sort()).toEqual(
      ['energized', 'haste', 'heal', 'might', 'reveal', 'root', 'shield', 'teleport', 'unstoppable', 'untargetable', 'weaken'],
    );
  });

  it('catches a pool that breaks its own rules', () => {
    const broken: CatalystData = {
      ...DATA,
      prep: [{ ...DATA.prep[0]!, oncePerMatch: false, cooldown: 2 }, DATA.prep[0]!],
    };
    const errs = validateCatalysts(broken).join(' ');
    expect(errs).toMatch(/oncePerMatch/);
    expect(errs).toMatch(/cooldown must be 0/);
    expect(errs).toMatch(/duplicate catalyst id/);
  });

  it('catches a default triad that names something not in the pool', () => {
    const thin: CatalystData = { ...DATA, dash: DATA.dash.filter((d) => d.id !== 'shift') };
    expect(validateCatalysts(thin).join(' ')).toMatch(/default triad names "shift"/);
  });
});

describe('CAT1: every unit starts with the default triad', () => {
  it('createMatch deals Second Wind / Shift / Adrenaline, one per phase', () => {
    const s = createMatch(OPEN, '1v1', [[CHAR], [CHAR]]);
    for (const u of s.units) {
      expect(u.catalysts).toEqual([...DEFAULT_CATALYSTS]);
      expect(u.catalystsUsed).toEqual([]);
      // One per phase, as the ruling requires.
      expect(u.catalysts.map((id) => POOL[id]!.phase)).toEqual([...CATALYST_PHASES]);
    }
  });

  it('keeps the state plain JSON — arrays, not Sets', () => {
    // `structuredClone` and the determinism hash both assume plain JSON; a Set
    // survives neither, and the failure would be a desync, not an exception.
    const s = createMatch(OPEN, '1v1', [[CHAR], [CHAR]]);
    expect(Array.isArray(s.units[0]!.catalysts)).toBe(true);
    expect(Array.isArray(s.units[0]!.catalystsUsed)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('CAT1: catalysts resolve at the START of their phase', () => {
  it('Adrenaline boosts the SAME turn’s Blast — the ruling that fails silently', () => {
    const plain = run(setup(), [{ unitId: 'a', ability: { abilityId: 'shot', target: [{ x: 12, y: 10 }] } }]);
    const boosted = run(setup(), [{
      unitId: 'a',
      ability: { abilityId: 'shot', target: [{ x: 12, y: 10 }] },
      catalyst: { abilityId: 'adrenaline' },
    }]);
    const plainDealt = 100 - unit(plain.state, 'e').hp;
    const boostedDealt = 100 - unit(boosted.state, 'e').hp;
    expect(plainDealt).toBe(20);
    // Resolved after the damage step this would be 20 and the catalyst would be
    // spent for nothing — which is exactly how it would fail.
    expect(boostedDealt).toBe(20 + Math.floor((20 * MIGHT_PCT) / 100));
    expect(hasStatus(unit(boosted.state, 'a'), 'might')).toBe(true);
  });

  it('Suppression weakens enemies within 2, blunting their counter-swing', () => {
    const s = withCatalyst(setup(), 'suppression');
    unit(s, 'e').pos = { x: 5, y: 10 }; // 1 away — inside the r2 circle
    const { state } = run(s, [{ unitId: 'a', catalyst: { abilityId: 'suppression' } }]);
    expect(hasStatus(unit(state, 'e'), 'weaken')).toBe(true);
    // …and not the caster: harmful effects never touch your own team (FF1).
    expect(hasStatus(unit(state, 'a'), 'weaken')).toBe(false);
  });

  it('Suppression aimed with no target still centres on its caster', () => {
    // Its circle is range 0, so the caster's own square is the only legal aim —
    // rejecting an absent one would make it undeclarable.
    const s = withCatalyst(setup(), 'suppression');
    unit(s, 'e').pos = { x: 6, y: 10 };
    const { state } = run(s, [{ unitId: 'a', catalyst: { abilityId: 'suppression', target: [] } }]);
    expect(hasStatus(unit(state, 'e'), 'weaken')).toBe(true);
  });

  it('an enemy outside the radius is untouched', () => {
    const { state } = run(withCatalyst(setup(), 'suppression'), [{ unitId: 'a', catalyst: { abilityId: 'suppression' } }]);
    expect(hasStatus(unit(state, 'e'), 'weaken')).toBe(false); // 6 away
  });

  it('Overdrive’s Might lands on this turn’s Blast and its Haste on the Move after', () => {
    const s = withCatalyst(setup(), 'overdrive');
    unit(s, 'e').pos = { x: 12, y: 10 };
    // Walk NORTH, clear of the shot's row, so the two halves cannot be confused.
    const north = Array.from({ length: MOVE_RANGE }, (_, i) => ({ x: 4, y: 9 - i }));
    const { state, events } = run(s, [{
      unitId: 'a',
      ability: { abilityId: 'shot', target: [{ x: 12, y: 10 }] },
      catalyst: { abilityId: 'overdrive' },
      movePath: north,
    }]);
    expect(100 - unit(state, 'e').hp).toBe(20 + Math.floor((20 * MIGHT_PCT) / 100));
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: 6 });
    // Both halves land in Blast. Overdrive is Might 1 + Haste 1, so both are
    // live for this turn and gone by the end-of-turn tick — hence the events
    // rather than the surviving statuses.
    const applied = events.flatMap((e) =>
      e.type === 'statusApplied' && e.unitId === 'a' && e.abilityId === 'overdrive' ? [e.status] : []);
    expect(applied).toEqual(['might', 'haste']);
  });

  it('a Blast-applied Haste does not let you walk FURTHER the same turn', () => {
    // Worth pinning because it is the one place Overdrive reads weaker than its
    // description: a move path is validated against the pre-turn budget and only
    // ever re-clamped *down* at Move time, so a Haste that lands in Blast cannot
    // extend the walk that follows it — it can only offset a Slow. Raised with
    // the Analyzer (DECISIONS.md); asserted here so the answer is not a surprise.
    const s = withCatalyst(setup(), 'overdrive');
    const long = Array.from({ length: MOVE_RANGE + 2 }, (_, i) => ({ x: 4, y: 9 - i }));
    const { state } = run(s, [{ unitId: 'a', catalyst: { abilityId: 'overdrive' }, movePath: long }]);
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: 10 }); // rejected outright
  });

  it('a Weaken from Suppression bites the same turn it lands', () => {
    // The other side of start-of-phase ordering: the enemy's simultaneous shot
    // is already reduced, not reduced next turn.
    const s = withCatalyst(setup(), 'suppression');
    unit(s, 'e').pos = { x: 5, y: 10 };
    const { state } = run(
      s,
      [{ unitId: 'a', catalyst: { abilityId: 'suppression' } }],
      [{ unitId: 'e', ability: { abilityId: 'shot', target: [{ x: 0, y: 10 }] } }],
    );
    expect(100 - unit(state, 'a').hp).toBe(20 - Math.floor((20 * WEAKEN_PCT) / 100));
  });
});

describe('CAT-DASH-FULL: a Dash catalyst IS your whole active turn', () => {
  /**
   * Owner directive 2026-09-01 — "Dash Catalyst should count as your full
   * action" — superseding 2026-08-28's "it spends your Move".
   *
   * A free ≤3 teleport or a 2-turn Untargetable that cost only a Move was still
   * the strongest thing a turn could do. Priced at the whole action it reads
   * like the once-per-match power it is: no ability, no Move, no Sprint. Prep
   * and Blast catalysts are untouched, and the tests that say so are the ones
   * that stop this leaking out of the Dash colour.
   */
  it('a unit that Shifts 3 in Dash does not also walk in Move', () => {
    const s = setup();
    const { state } = run(s, [{
      unitId: 'a',
      catalyst: { abilityId: 'shift', target: [{ x: 4, y: 7 }] }, // 3 north
      movePath: [{ x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }],
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: 7 }); // the Shift, and only the Shift
    expect(unit(state, 'a').catalystsUsed).toEqual(['shift']);
  });

  it('and the catalyst still resolves — the Move is the price, not a rejection', () => {
    const { state, events } = run(setup(), [{
      unitId: 'a',
      catalyst: { abilityId: 'shift', target: [{ x: 4, y: 7 }] },
      movePath: [{ x: 5, y: 7 }, { x: 6, y: 7 }],
    }]);
    expect(events.some((e) => e.type === 'catalystUsed' && e.catalystId === 'shift')).toBe(true);
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: 7 });
  });

  it('a Dash catalyst that does not reposition costs the Move too', () => {
    // Fade grants Untargetable and moves nobody, and it is still a Dash
    // catalyst. One rule per colour beats two rules per catalyst; DECISIONS
    // 2026-08-28 flags the sub-question for the Designer.
    const { state } = run(withCatalyst(setup(), 'fade'), [{
      unitId: 'a',
      catalyst: { abilityId: 'fade', target: [] },
      movePath: walk(2),
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: 10 }); // held its ground
    expect(unit(state, 'a').catalystsUsed).toEqual(['fade']);
  });

  it('Sprint is cancelled by a Dash catalyst, not merely shortened', () => {
    const { state } = run(setup(), [{
      unitId: 'a',
      catalyst: { abilityId: 'shift', target: [{ x: 4, y: 7 }] },
      sprint: true,
      movePath: [{ x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 9, y: 7 }],
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: 7 });
  });

  it('a PREP catalyst is still fully additive — it never touched movement', () => {
    const { state } = run(setup(), [{
      unitId: 'a',
      catalyst: { abilityId: 'second_wind', target: [] },
      movePath: walk(MOVE_RANGE),
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 8, y: 10 });
    expect(unit(state, 'a').catalystsUsed).toEqual(['second_wind']);
  });

  it('…and so is a BLAST catalyst', () => {
    const { state } = run(setup(), [{
      unitId: 'a',
      catalyst: { abilityId: 'adrenaline', target: [] },
      movePath: walk(MOVE_RANGE),
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 8, y: 10 });
  });

  it('Shift ignores walls — it is a teleport, not a walk', () => {
    const walled = makeMap([
      '.........',
      '.........',
      '..#####..',
      '.........',
      '.........',
    ]);
    const s = makeState([makeUnit('a', 0, { x: 4, y: 4 }, { characterId: 'test-char' })]);
    const { state } = resolveTurn(
      s, walled,
      [{ team: 0, units: [{ unitId: 'a', catalyst: { abilityId: 'shift', target: [{ x: 4, y: 1 }] } }] }, { team: 1, units: [] }],
      roster, POOL,
    );
    expect(state.units[0]!.pos).toEqual({ x: 4, y: 1 });
  });

  it('Shift DROPS a declared dash ability — the catalyst is the whole turn', () => {
    // The inversion. Under CAT-DASH-COST this asserted the charge also ran and
    // the unit ended at (6,7); the catalyst only cost the Move. It now costs the
    // ability slot too, so the Shift lands and the charge never fires.
    const { state, events } = run(setup(), [{
      unitId: 'a',
      catalyst: { abilityId: 'shift', target: [{ x: 4, y: 7 }] },
      ability: { abilityId: 'charge', target: [{ x: 5, y: 7 }, { x: 6, y: 7 }] },
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 4, y: 7 }); // the Shift, and only the Shift
    expect(events.some((e) => e.type === 'abilityFired' && e.abilityId === 'charge')).toBe(false);
  });

  it('…and drops a BLAST ability too — it is the slot, not the phase', () => {
    const { state, events } = run(setup(), [{
      unitId: 'a',
      catalyst: { abilityId: 'shift', target: [{ x: 4, y: 7 }] },
      ability: { abilityId: 'shot', target: [{ x: 12, y: 10 }] },
    }]);
    expect(events.some((e) => e.type === 'abilityFired' && e.abilityId === 'shot')).toBe(false);
    expect(unit(state, 'e').hp).toBe(100); // nothing was fired at it
  });

  it('the ability is not merely un-fired — its cooldown is untouched', () => {
    // A dropped order must cost nothing. Spending the cooldown on an ability
    // that never resolved would be the worst of both readings.
    const { state } = run(setup(), [{
      unitId: 'a',
      catalyst: { abilityId: 'shift', target: [{ x: 4, y: 7 }] },
      ability: { abilityId: 'charge', target: [{ x: 5, y: 7 }, { x: 6, y: 7 }] },
    }]);
    expect(unit(state, 'a').cooldowns['charge'] ?? 0).toBe(0);
  });

  it('does not reduce the move budget or block Sprint', () => {
    const s = setup();
    unit(s, 'e').pos = { x: 10, y: 4 }; // off the walked row
    const { state } = run(s, [{
      unitId: 'a',
      catalyst: { abilityId: 'second_wind' },
      sprint: true,
      movePath: walk(8),
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 12, y: 10 });
    expect(state.units[0]!.catalystsUsed).toEqual(['second_wind']);
  });
});

describe('CAT1: once per match', () => {
  it('a spent catalyst is rejected on a later turn', () => {
    const first = run(setup(), [{ unitId: 'a', catalyst: { abilityId: 'second_wind' } }]);
    expect(unit(first.state, 'a').catalystsUsed).toEqual(['second_wind']);

    const hurt = { ...first.state, units: first.state.units.map((u) => (u.unitId === 'a' ? { ...u, hp: 50 } : u)) };
    const second = run(hurt, [{ unitId: 'a', catalyst: { abilityId: 'second_wind' } }]);
    expect(unit(second.state, 'a').hp).toBe(50); // no heal — the slot is gone
    expect(second.events.filter((e) => e.type === 'catalystUsed')).toHaveLength(0);
    expect(unit(second.state, 'a').catalystsUsed).toEqual(['second_wind']);
  });

  it('rejects a catalyst this unit does not carry', () => {
    const { state, events } = run(setup(), [{ unitId: 'a', catalyst: { abilityId: 'brainwave' } }]);
    expect(events.filter((e) => e.type === 'catalystUsed')).toHaveLength(0);
    expect(unit(state, 'a').catalystsUsed).toEqual([]);
  });

  it('rejects an id that is not a catalyst at all', () => {
    const s = setup();
    unit(s, 'a').catalysts = ['shot', 'shift', 'adrenaline'];
    const { events } = run(s, [{ unitId: 'a', catalyst: { abilityId: 'shot' } }]);
    expect(events.filter((e) => e.type === 'catalystUsed')).toHaveLength(0);
  });

  it('is spent when it RESOLVES, not when it is ordered', () => {
    // A unit killed before its catalyst's phase does not spend it. Here the
    // Blast slot survives a death in Dash — the slot is not burned by a turn
    // the unit never got to finish.
    const s = setup();
    unit(s, 'a').hp = 1;
    unit(s, 'e').pos = { x: 6, y: 10 };
    const { state, events } = run(
      s,
      [{ unitId: 'a', catalyst: { abilityId: 'adrenaline' } }],
      [{ unitId: 'e', ability: { abilityId: 'charge', target: [{ x: 5, y: 10 }, { x: 4, y: 10 }] } }],
    );
    expect(unit(state, 'a').alive).toBe(false);
    expect(unit(state, 'a').catalystsUsed).toEqual([]);
    expect(events.filter((e) => e.type === 'catalystUsed')).toHaveLength(0);
  });

  it('survives death and respawn once unspent, and stays spent once used', () => {
    const s = setup();
    const u = unit(s, 'a');
    u.alive = false;
    u.respawnIn = 1;
    u.catalystsUsed = ['second_wind'];
    const { state } = run(s, []);
    const after = unit(state, 'a');
    expect(after.catalysts).toEqual([...DEFAULT_CATALYSTS]); // slots survive death
    expect(after.catalystsUsed).toEqual(['second_wind']); // and death refunds nothing
  });

  it('emits catalystUsed before the ability fires, for the HUD and playback', () => {
    const { events } = run(setup(), [{ unitId: 'a', catalyst: { abilityId: 'second_wind' } }]);
    const used = events.findIndex((e) => e.type === 'catalystUsed');
    const fired = events.findIndex((e) => e.type === 'abilityFired' && e.abilityId === 'second_wind');
    expect(used).toBeGreaterThanOrEqual(0);
    expect(fired).toBe(used + 1);
  });
});

describe('CAT1: at most one free action per unit per turn', () => {
  const FREE_CHAR: CharacterDef = {
    ...CHAR,
    id: 'free-char',
    abilities: [
      ...CHAR.abilities,
      ability({
        id: 'trap', phase: 'prep', shape: 'square', range: 4, cooldown: 4, energyGain: 0, free: true,
        effects: [{ kind: 'trap', amount: 20, duration: 3 }],
      }),
    ],
  };
  const bothRoster: Roster = { 'free-char': FREE_CHAR };

  it('a free ability and a catalyst in one turn resolves only the free ability', () => {
    const s = makeState([makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'free-char' })]);
    const { state, events } = resolveTurn(
      s, OPEN,
      [{
        team: 0,
        units: [{
          unitId: 'a',
          freeAbility: { abilityId: 'trap', target: [{ x: 6, y: 10 }] },
          catalyst: { abilityId: 'second_wind' },
        }],
      }, { team: 1, units: [] }],
      bothRoster, POOL,
    );
    expect(state.traps).toHaveLength(1);
    // The catalyst is the scarcer resource, so it is the one that yields — and
    // it stays unspent rather than being burned by the collision.
    expect(events.filter((e) => e.type === 'catalystUsed')).toHaveLength(0);
    expect(state.units[0]!.catalystsUsed).toEqual([]);
  });

  it('a catalyst alone still resolves', () => {
    const s = makeState([makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'free-char', hp: 50 })]);
    const { state } = resolveTurn(
      s, OPEN,
      [{ team: 0, units: [{ unitId: 'a', catalyst: { abilityId: 'second_wind' } }] }, { team: 1, units: [] }],
      bothRoster, POOL,
    );
    expect(state.units[0]!.hp).toBe(80);
  });
});

describe('CAT1: no pool, no catalysts', () => {
  it('a catalyst order is dropped when the caller passed no pool', () => {
    // Deterministic drop, exactly like any other unusable component — never a
    // throw, so an older caller keeps working and simply has no catalysts.
    const { state, events } = resolveTurn(
      setup(), OPEN,
      [{ team: 0, units: [{ unitId: 'a', catalyst: { abilityId: 'second_wind' } }] }, { team: 1, units: [] }],
      roster,
    );
    expect(events.filter((e) => e.type === 'catalystUsed')).toHaveLength(0);
    expect(unit(state, 'a').catalystsUsed).toEqual([]);
  });
});

describe('CAT1: budget accounting is untouched', () => {
  it('a catalyst never shrinks the move budget', () => {
    const { state } = run(setup(), [{
      unitId: 'a',
      catalyst: { abilityId: 'second_wind' },
      ability: { abilityId: 'shot', target: [{ x: 12, y: 10 }] },
      movePath: walk(MOVE_RANGE),
    }]);
    expect(unit(state, 'a').pos).toEqual({ x: 8, y: 10 });
  });
});
