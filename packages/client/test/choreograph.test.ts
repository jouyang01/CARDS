import { describe, expect, it } from 'vitest';
import { resolveTurn, type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster, type TurnEvent, type UnitOrders } from '@cards/engine';
import { choreograph, timelineLength, type Cue } from '../src/choreograph.js';

/**
 * A2 — the choreographer is asserted on ORDERING and CONCURRENCY only, never on
 * absolute times or track length: pacing is one tunable constant deferred to
 * playtest, and a test that pinned milliseconds would break the moment it moves.
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
    ability({ id: 'blink', phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] }),
    ability({ id: 'shove', shape: 'line', range: 6, energyGain: 4, effects: [{ kind: 'damage', amount: 5 }, { kind: 'knockback', amount: 2 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'square', range: 8, effects: [{ kind: 'damage', amount: 40 }] }),
};
const roster: Roster = { 'test-char': char };

const mkUnit = (unitId: string, owner: 0 | 1, x: number, y: number, over: Partial<GameState['units'][number]> = {}) =>
  ({ unitId, characterId: 'test-char', owner, pos: { x, y }, hp: 100, maxHp: 100, energy: 0, alive: true, respawnIn: 0, cooldowns: {}, statuses: [], catalysts: [], catalystsUsed: [], ...over });
const mkState = (units: GameState['units'], over: Partial<GameState> = {}): GameState =>
  ({ turn: 1, units, traps: [], delayed: [], decoys: [], powerups: [], lastKnown: [], kills: [0, 0], format: '2v2', status: 'active', suddenDeath: false, ...over });
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);

const of = <K extends Cue['kind']>(cues: Cue[], kind: K) => cues.filter((c): c is Extract<Cue, { kind: K }> => c.kind === kind);
const endOf = (c: Cue) => c.t + c.dur;
/** [start, end) of every cue belonging to `unitId`, as one range. */
const rangeOf = (cues: Cue[], unitId: string) => {
  const mine = cues.filter((c) => 'unitId' in c && c.unitId === unitId);
  return { start: Math.min(...mine.map((c) => c.t)), end: Math.max(...mine.map(endOf)) };
};

describe('A2: sequential phases give each actor a disjoint time range', () => {
  it('two Blast shooters never overlap, and follow the log order (not unitId order)', () => {
    // 'zulu' is ordered FIRST in state.units, so the log emits it first — if the
    // choreographer sorted by unitId, 'alpha' would come first instead.
    const zulu = mkUnit('zulu', 0, 1, 4);
    const alpha = mkUnit('alpha', 0, 1, 8);
    const e1 = mkUnit('e1', 1, 5, 4);
    const e2 = mkUnit('e2', 1, 5, 8);
    const { events } = run(mkState([zulu, alpha, e1, e2]), [
      { unitId: 'zulu', ability: { abilityId: 'shoot', target: [{ x: 12, y: 4 }] } },
      { unitId: 'alpha', ability: { abilityId: 'shoot', target: [{ x: 12, y: 8 }] } },
    ], []);
    const cues = choreograph(events);

    const firedOrder = events.filter((e) => e.type === 'abilityFired').map((e) => (e as { unitId: string }).unitId);
    expect(firedOrder).toEqual(['zulu', 'alpha']); // log order, for the record

    const z = rangeOf(cues, 'zulu');
    const a = rangeOf(cues, 'alpha');
    expect(z.end).toBeLessThanOrEqual(a.start); // disjoint, zulu first
    expect(a.start).toBeGreaterThanOrEqual(z.end);
  });

  it('a damage cue is bound to its shooter by sourceUnitId, not by log adjacency', () => {
    const zulu = mkUnit('zulu', 0, 1, 4);
    const alpha = mkUnit('alpha', 0, 1, 8);
    const e1 = mkUnit('e1', 1, 5, 4);
    const e2 = mkUnit('e2', 1, 5, 8);
    const { events } = run(mkState([zulu, alpha, e1, e2]), [
      { unitId: 'zulu', ability: { abilityId: 'shoot', target: [{ x: 12, y: 4 }] } },
      { unitId: 'alpha', ability: { abilityId: 'shoot', target: [{ x: 12, y: 8 }] } },
    ], []);

    // The log really does put both abilityFired before both damage events, so
    // adjacency cannot pair them — this is exactly what A0 exists to fix.
    const kinds = events.filter((e) => e.type === 'abilityFired' || e.type === 'damage').map((e) => e.type);
    expect(kinds).toEqual(['abilityFired', 'abilityFired', 'damage', 'damage']);

    const cues = choreograph(events);
    const blastAbilities = of(cues, 'ability').filter((c) => c.phase === 'blast');
    for (const impact of of(cues, 'impact')) {
      // The hit lands in its own shooter's slot: the most recent ability cue at
      // or before the impact is that shooter's, and the impact follows it.
      const preceding = blastAbilities.filter((c) => c.t <= impact.t).sort((x, y) => x.t - y.t).at(-1)!;
      expect(preceding.unitId, `impact on ${impact.unitId} landed in the wrong actor's slot`).toBe(impact.sourceUnitId);
      expect(impact.t).toBeGreaterThanOrEqual(endOf(preceding));
    }
    // e1 was hit by zulu, e2 by alpha — never crossed.
    const bySource = new Map(of(cues, 'impact').map((c) => [c.unitId, c.sourceUnitId]));
    expect(bySource.get('e1')).toBe('zulu');
    expect(bySource.get('e2')).toBe('alpha');
  });

  it('Prep actors are sequential too', () => {
    const a = mkUnit('a', 0, 1, 4);
    const b = mkUnit('b', 0, 1, 8);
    const { events } = run(mkState([a, b, mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', ability: { abilityId: 'guard', target: [] } },
      { unitId: 'b', ability: { abilityId: 'guard', target: [] } },
    ], []);
    const prep = of(choreograph(events), 'ability').filter((c) => c.phase === 'prep');
    expect(prep).toHaveLength(2);
    expect(endOf(prep[0]!)).toBeLessThanOrEqual(prep[1]!.t); // disjoint
  });
});

describe('A2: simultaneous phases share a start', () => {
  it('every mover in Move starts on the same beat', () => {
    const a = mkUnit('a', 0, 1, 4);
    const b = mkUnit('b', 0, 1, 8);
    const { events } = run(mkState([a, b, mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', movePath: [{ x: 2, y: 4 }, { x: 3, y: 4 }] },
      { unitId: 'b', movePath: [{ x: 2, y: 8 }, { x: 3, y: 8 }] },
    ], []);
    const moves = of(choreograph(events), 'move');
    const firstOf = (u: string) => Math.min(...moves.filter((m) => m.unitId === u).map((m) => m.t));
    expect(firstOf('a')).toBe(firstOf('b')); // concurrent, not serialized

    // A unit's own steps still run in sequence.
    const aSteps = moves.filter((m) => m.unitId === 'a').map((m) => m.t).sort((x, y) => x - y);
    expect(aSteps[1]).toBeGreaterThan(aSteps[0]!);
  });

  it('every dasher in Dash starts on the same beat', () => {
    const a = mkUnit('a', 0, 1, 4);
    const b = mkUnit('b', 0, 1, 8);
    const { events } = run(mkState([a, b, mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', ability: { abilityId: 'charge', target: [{ x: 2, y: 4 }, { x: 3, y: 4 }] } },
      { unitId: 'b', ability: { abilityId: 'charge', target: [{ x: 2, y: 8 }, { x: 3, y: 8 }] } },
    ], []);
    const dash = of(choreograph(events), 'ability').filter((c) => c.phase === 'dash');
    expect(dash).toHaveLength(2);
    expect(dash[0]!.t).toBe(dash[1]!.t); // shared start — Dash is shown simultaneously
  });

  it('a blink step carries `teleport` onto its move cue; a walk does not', () => {
    // The presentation flag rides from the engine's `moveStep` through to the
    // cue `animate.ts` reads, so a blink is jumped and a walk is slid — even when
    // both are one square long.
    const blink = run(mkState([mkUnit('a', 0, 5, 6), mkUnit('e', 1, 11, 6)]),
      [{ unitId: 'a', ability: { abilityId: 'blink', target: [{ x: 6, y: 6 }] } }], []);
    const jumped = of(choreograph(blink.events), 'move').filter((m) => m.unitId === 'a');
    expect(jumped.length).toBeGreaterThan(0);
    expect(jumped.every((m) => m.teleport === true)).toBe(true);

    const walk = run(mkState([mkUnit('a', 0, 5, 6), mkUnit('e', 1, 11, 6)]),
      [{ unitId: 'a', movePath: [{ x: 6, y: 6 }] }], []);
    const slid = of(choreograph(walk.events), 'move').filter((m) => m.unitId === 'a');
    expect(slid.length).toBeGreaterThan(0);
    expect(slid.every((m) => m.teleport !== true)).toBe(true);
  });
});

describe('A2: deaths defer to the end of their phase', () => {
  it('a unit that dies in Blast still plays its own Blast ability first', () => {
    // Both shoot each other; the dying unit's shot must still be shown.
    const a = mkUnit('a', 0, 1, 6, { hp: 10 });
    const e = mkUnit('e', 1, 5, 6, { hp: 10 });
    const { events, state } = run(mkState([a, e]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } },
    ], [
      { unitId: 'e', ability: { abilityId: 'shoot', target: [{ x: 0, y: 6 }] } },
    ]);
    expect(state.units.find((u) => u.unitId === 'a')!.alive).toBe(false); // mutual kill
    expect(state.units.find((u) => u.unitId === 'e')!.alive).toBe(false);

    const cues = choreograph(events);
    const deaths = of(cues, 'death');
    const abilities = of(cues, 'ability').filter((c) => c.phase === 'blast');
    expect(deaths.length).toBeGreaterThan(0);
    expect(abilities.map((c) => c.unitId).sort()).toEqual(['a', 'e']); // both fired

    const lastAbilityEnd = Math.max(...abilities.map(endOf));
    for (const d of deaths) {
      expect(d.t, `${d.unitId} dies before the phase finished acting`).toBeGreaterThanOrEqual(lastAbilityEnd);
    }
    // Specifically: the dying unit's OWN ability precedes its OWN death.
    for (const d of deaths) {
      const own = abilities.find((c) => c.unitId === d.unitId)!;
      expect(d.t).toBeGreaterThanOrEqual(endOf(own));
    }
  });
});

describe('A2: displacement lands at the end of Blast', () => {
  it('displaced cues share one start, after every Blast ability cue', () => {
    const a = mkUnit('a', 0, 1, 4);
    const b = mkUnit('b', 0, 1, 8);
    const e1 = mkUnit('e1', 1, 4, 4);
    const e2 = mkUnit('e2', 1, 4, 8);
    const { events } = run(mkState([a, b, e1, e2]), [
      { unitId: 'a', ability: { abilityId: 'shove', target: [{ x: 12, y: 4 }] } },
      { unitId: 'b', ability: { abilityId: 'shove', target: [{ x: 12, y: 8 }] } },
    ], []);
    const cues = choreograph(events);
    const shoves = of(cues, 'displace');
    expect(shoves.length).toBe(2);
    expect(shoves[0]!.t).toBe(shoves[1]!.t); // one shared beat

    const blastAbilities = of(cues, 'ability').filter((c) => c.phase === 'blast');
    for (const d of shoves) {
      for (const ab of blastAbilities) expect(d.t).toBeGreaterThanOrEqual(endOf(ab));
    }
  });
});

describe('A2: the timeline is well-formed and pure', () => {
  const scenario = () => {
    const a = mkUnit('a', 0, 1, 6);
    const e = mkUnit('e', 1, 5, 6);
    return run(mkState([a, e]), [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } }], [{ unitId: 'e', movePath: [{ x: 6, y: 6 }] }]);
  };

  it('phases appear in the sacred order and everything is sorted by start time', () => {
    const cues = choreograph(scenario().events);
    expect(of(cues, 'phase').map((c) => c.phase)).toEqual(['prep', 'dash', 'blast', 'move']);
    const ts = cues.map((c) => c.t);
    expect([...ts].sort((x, y) => x - y)).toEqual(ts);
  });

  it('is deterministic — the same log yields identical cues', () => {
    const { events } = scenario();
    expect(JSON.stringify(choreograph(events))).toBe(JSON.stringify(choreograph(events)));
  });

  it('never mutates the event log', () => {
    const { events } = scenario();
    const before = JSON.stringify(events);
    choreograph(events);
    expect(JSON.stringify(events)).toBe(before);
  });

  it('an empty turn still yields the four phase banners', () => {
    const { events } = run(mkState([mkUnit('a', 0, 1, 6), mkUnit('e', 1, 11, 6)]), [], []);
    const cues = choreograph(events);
    expect(of(cues, 'phase')).toHaveLength(4);
    expect(timelineLength(cues)).toBeGreaterThan(0);
  });

  it('carries no renderer detail — cues describe what happened, not how it looks', () => {
    const cues = choreograph(scenario().events);
    const forbidden = ['color', 'colour', 'hex', 'fill', 'px', 'easing', 'opacity', 'css'];
    for (const cue of cues) {
      for (const key of Object.keys(cue)) {
        expect(forbidden, `cue key "${key}" leaks renderer detail`).not.toContain(key.toLowerCase());
      }
    }
  });
});

/**
 * MOVE-NO-BANNER-BEAT — Move starts the moment its banner does.
 *
 * Every other phase leads with a beat of stillness: the banner names what is
 * about to happen, and the pause is what makes the naming land. Move announces
 * nothing — everyone goes at once and the board already shows where — so that
 * beat was a full BEAT of every character standing under a MOVE label before
 * anyone stepped. On a one-tile move that is half the phase, and it read as
 * characters hesitating.
 *
 * Found by filming the client on a virtual clock (`npm run film`): 23 frames of
 * idle before the run clip started. Nothing asserted the beat either way, which
 * is why it survived — so it is asserted now, in both directions.
 */
describe('MOVE-NO-BANNER-BEAT: movement starts with its banner', () => {
  const walker = () => {
    const s = mkState([mkUnit('a', 0, 1, 6), mkUnit('b', 1, 11, 6)]);
    return choreograph(run(s, [{ unitId: 'a', movePath: [{ x: 2, y: 6 }] }], []).events);
  };

  it('puts the first move cue at the banner, not a beat after it', () => {
    const cues = walker();
    const banner = of(cues, 'phase').find((c) => c.phase === 'move')!;
    const first = of(cues, 'move').sort((x, y) => x.t - y.t)[0]!;
    expect(first.t, 'a beat of standing under a MOVE label').toBe(banner.t);
  });

  it('so a one-tile move is one beat long, not two', () => {
    // Stated as a relationship, not a duration: this file asserts ordering and
    // concurrency only, because pacing is a tunable and a test that pinned
    // milliseconds would break the moment it moves.
    const cues = walker();
    const banner = of(cues, 'phase').find((c) => c.phase === 'move')!;
    const moves = of(cues, 'move');
    expect(Math.max(...moves.map(endOf)), 'one step, one beat').toBe(endOf(banner));
  });

  it('and the announcing phases keep their beat', () => {
    // The pause is the point in Prep, Dash and Blast — this must not have
    // quietly become a global change.
    const s = mkState([mkUnit('a', 0, 1, 6), mkUnit('b', 1, 11, 6)]);
    const cues = choreograph(run(s, [{ unitId: 'a', ability: { abilityId: 'guard', target: [{ x: 1, y: 6 }] } }], []).events);
    const banner = of(cues, 'phase').find((c) => c.phase === 'prep')!;
    const cast = of(cues, 'ability').find((c) => c.abilityId === 'guard')!;
    expect(cast.t, 'the banner still reads before Prep acts').toBeGreaterThan(banner.t);
  });
});
