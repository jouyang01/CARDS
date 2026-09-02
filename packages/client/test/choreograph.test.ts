import { describe, expect, it } from 'vitest';
import { resolveTurn, type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster, type TurnEvent, type UnitOrders } from '@cards/engine';
import { BEAT, LEAP_TILE_BEATS, ROLL_TILE_BEATS, choreograph, markLeaps, straightenDashes, timeDashImpacts, timelineLength, type Cue } from '../src/choreograph.js';

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

  it('WALKED-DASH: a walked dash cue spans its whole traversal and is marked stretch', () => {
    // A combat roll / charge traverses its squares (walked steps). Its ability cue
    // used to be one beat, so `selectClip` played the clip for the first tile and
    // the run clip for the rest; now it spans every walked step so the clip plays
    // the whole way, and carries `stretch` so the renderer time-scales it to finish
    // on arrival. (A blink teleports and is `holdCasts`'s job, not this one.)
    const a = mkUnit('a', 0, 1, 4);
    const { events } = run(mkState([a, mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', ability: { abilityId: 'charge', target: [{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }] } },
    ], []);
    const cues = choreograph(events);
    const dash = of(cues, 'ability').filter((c) => c.phase === 'dash');
    const steps = of(cues, 'move').filter((m) => m.unitId === 'a' && m.teleport !== true);
    expect(dash).toHaveLength(1);
    expect(steps.length, 'it actually walked several tiles').toBeGreaterThan(1);
    expect(dash[0]!.dur, 'the cue spans every walked step').toBe(steps.length * BEAT);
    expect(dash[0]!.stretch, 'and is time-scaled to complete on arrival').toBe(true);
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

describe('straightenDashes (STRAIGHT-DASH)', () => {
  // A diagonal combat roll: a stretched dash ability plus the orthogonal
  // staircase the engine paths it along (right, up, right, up).
  const roll = (): Cue[] => [
    { kind: 'ability', phase: 'dash', t: 0, dur: 4 * BEAT, unitId: 'a',
      abilityId: 'combat_roll', area: [], stretch: true } as Cue,
    { kind: 'move', t: 0, dur: BEAT, unitId: 'a', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, teleport: false } as Cue,
    { kind: 'move', t: BEAT, dur: BEAT, unitId: 'a', from: { x: 1, y: 0 }, to: { x: 1, y: 1 }, teleport: false } as Cue,
    { kind: 'move', t: 2 * BEAT, dur: BEAT, unitId: 'a', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, teleport: false } as Cue,
    { kind: 'move', t: 3 * BEAT, dur: BEAT, unitId: 'a', from: { x: 2, y: 1 }, to: { x: 2, y: 2 }, teleport: false } as Cue,
  ];

  it('collapses the staircase into one straight slide from origin to destination', () => {
    const out = straightenDashes(roll());
    const moves = out.filter((c) => c.kind === 'move') as Extract<Cue, { kind: 'move' }>[];
    expect(moves, 'four steps become one').toHaveLength(1);
    expect(moves[0]!.from).toEqual({ x: 0, y: 0 });
    expect(moves[0]!.to).toEqual({ x: 2, y: 2 });
    // ROLL-SPEED: timed by the straight-line distance (Chebyshev 2 from (0,0) to
    // (2,2)), not the four-step staircase — so a diagonal roll does not crawl.
    // Slides (teleport:false) rather than blinks.
    expect(moves[0]!.dur).toBeCloseTo(2 * ROLL_TILE_BEATS, 6);
    expect(moves[0]!.dur).toBeLessThan(4 * BEAT);
    expect(moves[0]!.teleport).toBe(false);
  });

  it('leaves a normal walk (no stretched dash) alone', () => {
    const walk: Cue[] = [
      { kind: 'move', t: 0, dur: BEAT, unitId: 'a', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, teleport: false } as Cue,
      { kind: 'move', t: BEAT, dur: BEAT, unitId: 'a', from: { x: 1, y: 0 }, to: { x: 1, y: 1 }, teleport: false } as Cue,
    ];
    expect(straightenDashes(walk).filter((c) => c.kind === 'move')).toHaveLength(2);
  });

  it('fits the roll clip to the straightened (faster) traversal', () => {
    const out = straightenDashes(roll());
    const ability = out.find((c) => c.kind === 'ability') as Extract<Cue, { kind: 'ability' }>;
    // The clip still finishes on arrival, but over the straight-line time, not
    // the staircase — so the roll plays quick instead of in slow motion.
    expect(ability.dur, 'clip fits the straight traversal').toBeCloseTo(2 * ROLL_TILE_BEATS, 6);
  });
});

describe('LEAP (markLeaps flags a vaulting charge, not a grounded roll)', () => {
  const dashMove = (unitId: string, abilityId: string): Cue[] => [
    { kind: 'ability', phase: 'dash', t: 0, dur: 3 * BEAT, unitId, abilityId, area: [], stretch: true } as Cue,
    { kind: 'move', t: 0, dur: 3 * BEAT, unitId, from: { x: 0, y: 0 }, to: { x: 3, y: 0 }, teleport: false } as Cue,
  ];
  const moveLeap = (cues: Cue[], unitId: string): boolean | undefined =>
    (cues.find((c) => c.kind === 'move' && c.unitId === unitId) as Extract<Cue, { kind: 'move' }>).leap;

  it("marks a leaping ability's dash leg, and leaves a non-leaping dash alone", () => {
    const cues = [...dashMove('a', 'ram_charge'), ...dashMove('b', 'combat_roll')];
    const out = markLeaps(cues, new Set(['ram_charge']));
    expect(moveLeap(out, 'a'), 'the charge vaults').toBe(true);
    expect(moveLeap(out, 'b'), 'the roll stays grounded').toBeUndefined();
  });

  it('paces the vault (leg and clip) quicker than a roll', () => {
    // A 3-tile charge: the leg and the fitted clip both take 3*LEAP_TILE_BEATS,
    // shorter than the 3*ROLL_TILE_BEATS a grounded roll would — a launch, not a drift.
    const out = markLeaps(dashMove('a', 'ram_charge'), new Set(['ram_charge']));
    const leg = out.find((c) => c.kind === 'move' && c.unitId === 'a') as Extract<Cue, { kind: 'move' }>;
    const ability = out.find((c) => c.kind === 'ability' && c.unitId === 'a') as Extract<Cue, { kind: 'ability' }>;
    expect(leg.dur).toBeCloseTo(3 * LEAP_TILE_BEATS, 6);
    expect(ability.dur).toBeCloseTo(3 * LEAP_TILE_BEATS, 6);
    expect(LEAP_TILE_BEATS).toBeLessThan(ROLL_TILE_BEATS);
  });

  it('leaves a charger\'s ordinary Move-phase step unmarked', () => {
    const cues: Cue[] = [
      ...dashMove('a', 'ram_charge'),
      // A later Move-phase step by the same unit, outside the dash window.
      { kind: 'move', t: 10 * BEAT, dur: BEAT, unitId: 'a', from: { x: 3, y: 0 }, to: { x: 4, y: 0 }, teleport: false } as Cue,
    ];
    const out = markLeaps(cues, new Set(['ram_charge']));
    const moves = out.filter((c) => c.kind === 'move' && c.unitId === 'a') as Extract<Cue, { kind: 'move' }>[];
    expect(moves.find((m) => m.t === 0)!.leap, 'the dash leg').toBe(true);
    expect(moves.find((m) => m.t === 10 * BEAT)!.leap, 'the walk step').toBeUndefined();
  });

  it('an empty leap set changes nothing', () => {
    const cues = dashMove('a', 'ram_charge');
    expect(moveLeap(markLeaps(cues, new Set()), 'a')).toBeUndefined();
  });
});

describe('IMPACT-ON-CROSSING (a charge hits each victim as it reaches their tile)', () => {
  // Bastion's Flying Charge: (2,7) -> (6,7) through two enemies at (3,7) and
  // (5,7). The engine emits all four steps, then both damages, then the shoves.
  const charge = (): Cue[] => [
    { kind: 'ability', phase: 'dash', t: 0, dur: 4 * BEAT, unitId: 'a', abilityId: 'ram_charge', area: [], stretch: true } as Cue,
    { kind: 'move', t: 0, dur: BEAT, unitId: 'a', from: { x: 2, y: 7 }, to: { x: 3, y: 7 }, teleport: false } as Cue,
    { kind: 'move', t: BEAT, dur: BEAT, unitId: 'a', from: { x: 3, y: 7 }, to: { x: 4, y: 7 }, teleport: false } as Cue,
    { kind: 'move', t: 2 * BEAT, dur: BEAT, unitId: 'a', from: { x: 4, y: 7 }, to: { x: 5, y: 7 }, teleport: false } as Cue,
    { kind: 'move', t: 3 * BEAT, dur: BEAT, unitId: 'a', from: { x: 5, y: 7 }, to: { x: 6, y: 7 }, teleport: false } as Cue,
    { kind: 'impact', t: 4 * BEAT, dur: BEAT, unitId: 'v1', amount: 23, absorbed: 0, sourceUnitId: 'a', abilityId: 'ram_charge' } as Cue,
    { kind: 'impact', t: 4 * BEAT, dur: BEAT, unitId: 'v2', amount: 23, absorbed: 0, sourceUnitId: 'a', abilityId: 'ram_charge' } as Cue,
    { kind: 'displace', t: 4 * BEAT, dur: BEAT, unitId: 'v1', from: { x: 3, y: 7 }, to: { x: 2, y: 7 }, displaceKind: 'knockback' } as Cue,
    { kind: 'displace', t: 4 * BEAT, dur: BEAT, unitId: 'v2', from: { x: 5, y: 7 }, to: { x: 6, y: 7 }, displaceKind: 'knockback' } as Cue,
  ];

  const impactT = (cues: Cue[], v: string): number =>
    (cues.find((c) => c.kind === 'impact' && c.unitId === v) as Extract<Cue, { kind: 'impact' }>).t;

  it('times each victim by how far along the straightened leg its tile sits', () => {
    const out = timeDashImpacts(straightenDashes(charge()));
    // The leg is (2,7)->(6,7), 4 tiles, over 4*ROLL_TILE_BEATS. The near enemy at
    // (3,7) is 1/4 along; the far one at (5,7) is 3/4 along.
    expect(impactT(out, 'v1')).toBeCloseTo(0.25 * 4 * ROLL_TILE_BEATS, 6);
    expect(impactT(out, 'v2')).toBeCloseTo(0.75 * 4 * ROLL_TILE_BEATS, 6);
    // And they fire in crossing order, both before the charge finishes.
    expect(impactT(out, 'v1')).toBeLessThan(impactT(out, 'v2'));
    expect(impactT(out, 'v2')).toBeLessThan(4 * ROLL_TILE_BEATS);
  });

  it('leaves a victim with no displacement at the phase-end timing (fallback)', () => {
    const cues = charge().filter((c) => !(c.kind === 'displace' && c.unitId === 'v2'));
    const out = timeDashImpacts(straightenDashes(cues));
    // v1 still gets crossed-timed; v2 (no shove to read its tile from) is left at
    // the phase-end time it was authored with.
    expect(impactT(out, 'v1')).toBeCloseTo(0.25 * 4 * ROLL_TILE_BEATS, 6);
    expect(impactT(out, 'v2')).toBeCloseTo(4 * BEAT, 6);
  });

  it('does not touch an impact from a different source or ability', () => {
    const cues: Cue[] = [
      ...charge(),
      { kind: 'impact', t: 4 * BEAT, dur: BEAT, unitId: 'v1', amount: 10, absorbed: 0, sourceUnitId: 'b', abilityId: 'rail_shot' } as Cue,
    ];
    const out = timeDashImpacts(straightenDashes(cues));
    const other = out.filter((c) => c.kind === 'impact' && c.sourceUnitId === 'b') as Extract<Cue, { kind: 'impact' }>[];
    expect(other).toHaveLength(1);
    expect(other[0]!.t).toBeCloseTo(4 * BEAT, 6);
  });
});

describe('TRAP-INSTANT (a trap fires as the walker steps on it)', () => {
  it('times a trap hit at the arrival on the trap tile, not the move end', () => {
    // The engine emits moveStep(onto trap) -> trapTriggered -> damage, and the
    // walker keeps going (a non-halting trap continues to its destination).
    const events = [
      { type: 'phaseStart', phase: 'move' },
      { type: 'moveStep', unitId: 'e', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      { type: 'moveStep', unitId: 'e', from: { x: 1, y: 0 }, to: { x: 2, y: 0 } }, // onto the trap
      { type: 'trapTriggered', trapId: 't1', unitId: 'e' },
      { type: 'damage', unitId: 'e', amount: 20, absorbed: 0, sourceUnitId: 'v', abilityId: 'overwatch_trap' },
      { type: 'moveStep', unitId: 'e', from: { x: 2, y: 0 }, to: { x: 3, y: 0 } }, // walks on
    ] as unknown as import('@cards/engine').TurnEvent[];
    const cues = choreograph(events);
    const moves = of(cues, 'move').filter((c) => c.unitId === 'e').sort((a, b) => a.t - b.t);
    const onTrap = moves.find((m) => m.to.x === 2 && m.to.y === 0)!;
    const impact = of(cues, 'impact').find((c) => c.abilityId === 'overwatch_trap')!;
    // Fires as the walker ARRIVES on the trap (end of that step)…
    expect(impact.t).toBeCloseTo(endOf(onTrap), 6);
    // …which is before the walk finishes — the last step ends a beat later.
    expect(impact.t).toBeLessThan(Math.max(...moves.map(endOf)));
  });

  it('a non-trap hit in the same phase still lands at the phase end', () => {
    const events = [
      { type: 'phaseStart', phase: 'move' },
      { type: 'moveStep', unitId: 'e', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      { type: 'moveStep', unitId: 'e', from: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
      { type: 'damage', unitId: 'e', amount: 5, absorbed: 0, sourceUnitId: 'v', abilityId: 'chip' },
    ] as unknown as import('@cards/engine').TurnEvent[];
    const cues = choreograph(events);
    const moves = of(cues, 'move').filter((c) => c.unitId === 'e');
    expect(of(cues, 'impact')[0]!.t).toBeCloseTo(Math.max(...moves.map(endOf)), 6);
  });
});
