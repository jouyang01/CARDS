import { describe, expect, it } from 'vitest';
import { resolveTurn, type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster, type UnitOrders } from '@cards/engine';
import { choreograph, timelineLength, type Cue } from '../src/choreograph.js';
import { DEAD_ALPHA, READOUT_BEATS, focusSquares, phaseAt, phaseWindow, sampleFrame } from '../src/animate.js';

/**
 * The A3 re-spec's pure half. Like the choreographer tests, these assert
 * ORDERING and RELATIONSHIPS, never absolute times — pacing is one constant.
 *
 * The invariant worth stating out loud: a `Frame` carries no HP, no aliveness,
 * no kills. Nothing here can move the board, which is exactly why sampling (or
 * not sampling) it cannot break **skip == watch**.
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
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, energyGain: 8, effects: [{ kind: 'damage', amount: 15 }] }),
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
/** Sample across a whole timeline at a fixed granularity. */
const walk = (cues: Cue[], steps = 40): { t: number; f: ReturnType<typeof sampleFrame> }[] => {
  const total = timelineLength(cues);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (total * i) / steps;
    return { t, f: sampleFrame(cues, t) };
  });
};

describe('positions tween between whole squares', () => {
  const walked = () => {
    const a = mkUnit('a', 0, 2, 6);
    const { events } = run(mkState([a, mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', movePath: [{ x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }] },
    ], []);
    return choreograph(events);
  };

  it('a mover starts at its origin square and lands exactly on its destination', () => {
    const cues = walked();
    const legs = of(cues, 'move').filter((c) => c.unitId === 'a');
    expect(legs.length).toBe(3);

    const first = legs[0]!;
    const last = legs[legs.length - 1]!;
    expect(sampleFrame(cues, 0).poses.get('a')).toMatchObject({ x: first.from.x, y: first.from.y });
    // Landing is exact — a tween that ends at 4.98 would put the unit between
    // tiles while the board says it is on one.
    const end = sampleFrame(cues, last.t + last.dur).poses.get('a')!;
    expect(end.x).toBe(last.to.x);
    expect(end.y).toBe(last.to.y);
    expect(end.lift).toBe(0);
  });

  it('mid-leg it is strictly between the two squares, and never leaves the run', () => {
    const cues = walked();
    const legs = of(cues, 'move').filter((c) => c.unitId === 'a');
    const leg = legs[1]!;
    const mid = sampleFrame(cues, leg.t + leg.dur / 2).poses.get('a')!;
    expect(mid.x).toBeGreaterThan(Math.min(leg.from.x, leg.to.x));
    expect(mid.x).toBeLessThan(Math.max(leg.from.x, leg.to.x));

    for (const { f } of walk(cues)) {
      const p = f.poses.get('a');
      if (p === undefined) continue;
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.x).toBeLessThanOrEqual(5);
    }
  });

  it('a knockback arcs off the floor; a walked step never does', () => {
    const shover = mkUnit('shover', 0, 4, 6);
    const victim = mkUnit('victim', 1, 6, 6);
    const { events } = run(mkState([shover, victim]), [
      { unitId: 'shover', ability: { abilityId: 'shove', target: [{ x: 10, y: 6 }] } },
    ], []);
    const cues = choreograph(events);
    const push = of(cues, 'displace').find((c) => c.unitId === 'victim')!;

    expect(sampleFrame(cues, push.t + push.dur / 2).poses.get('victim')!.lift).toBeGreaterThan(0);
    // Both ends of the arc are on the ground — a unit never lands hovering.
    expect(sampleFrame(cues, push.t).poses.get('victim')!.lift).toBe(0);
    expect(sampleFrame(cues, push.t + push.dur).poses.get('victim')!.lift).toBe(0);
  });
});

describe('death defers: a unit stays solid until it has played its own action', () => {
  const dying = () => {
    // The victim is on 10 HP and also shoots back this Blast, so it dies in the
    // same phase it acts in — the case the deferral rule exists for.
    const killer = mkUnit('killer', 0, 4, 6);
    const victim = mkUnit('victim', 1, 8, 6, { hp: 10 });
    const { events } = run(mkState([killer, victim]), [
      { unitId: 'killer', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } },
    ], [
      { unitId: 'victim', ability: { abilityId: 'shoot', target: [{ x: 0, y: 6 }] } },
    ]);
    return choreograph(events);
  };

  it('is fully solid while its own ability cue plays, and only fades afterwards', () => {
    const cues = dying();
    const shot = of(cues, 'ability').find((c) => c.unitId === 'victim')!;
    const death = of(cues, 'death').find((c) => c.unitId === 'victim')!;
    expect(death.t).toBeGreaterThanOrEqual(shot.t + shot.dur); // choreographer's job

    expect(sampleFrame(cues, shot.t).fades.get('victim')).toBeUndefined();
    expect(sampleFrame(cues, shot.t + shot.dur / 2).fades.get('victim')).toBeUndefined();
    expect(sampleFrame(cues, death.t + death.dur).fades.get('victim')).toBeCloseTo(DEAD_ALPHA, 9);
  });

  it('the fade is monotonic and never darker than a corpse', () => {
    const cues = dying();
    let previous = 1;
    for (const { f } of walk(cues, 60)) {
      const alpha = f.fades.get('victim') ?? 1;
      expect(alpha).toBeLessThanOrEqual(previous + 1e-9);
      expect(alpha).toBeGreaterThanOrEqual(DEAD_ALPHA);
      previous = alpha;
    }
  });
});

describe('spotlight: Prep/Dash/Blast dim, Move never does', () => {
  it('Move is never dimmed — a simultaneous scramble has to be seen whole', () => {
    const { events } = run(mkState([mkUnit('a', 0, 2, 6), mkUnit('b', 0, 2, 8), mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', movePath: [{ x: 3, y: 6 }, { x: 4, y: 6 }] },
      { unitId: 'b', movePath: [{ x: 3, y: 8 }, { x: 4, y: 8 }] },
    ], []);
    const cues = choreograph(events);
    const move = phaseWindow(cues, 'move');
    for (const { t, f } of walk(cues, 60)) {
      if (t < move.start || t >= move.end) continue;
      expect(f.phase).toBe('move');
      expect(f.spotlight).toBeNull();
    }
  });

  it('Blast lights one shooter at a time, and its victim with it', () => {
    const zulu = mkUnit('zulu', 0, 1, 4);
    const alpha = mkUnit('alpha', 0, 1, 8);
    const { events } = run(mkState([zulu, alpha, mkUnit('e1', 1, 5, 4), mkUnit('e2', 1, 5, 8)]), [
      { unitId: 'zulu', ability: { abilityId: 'shoot', target: [{ x: 12, y: 4 }] } },
      { unitId: 'alpha', ability: { abilityId: 'shoot', target: [{ x: 12, y: 8 }] } },
    ], []);
    const cues = choreograph(events);
    const shots = of(cues, 'ability').filter((c) => c.phase === 'blast');
    const first = shots.find((c) => c.unitId === 'zulu')!;
    const second = shots.find((c) => c.unitId === 'alpha')!;

    const early = sampleFrame(cues, first.t)!;
    expect(early.spotlight).toContain('zulu');
    expect(early.spotlight).not.toContain('alpha'); // the other shooter is dimmed

    const late = sampleFrame(cues, second.t);
    expect(late.spotlight).toContain('alpha');
    expect(late.spotlight).not.toContain('zulu');

    // The lit set grows to include whoever this shooter hit, so an exchange is
    // legible: shooter and target, nobody else.
    const afterImpact = sampleFrame(cues, second.t + second.dur);
    expect(afterImpact.spotlight).toContain('alpha');
    expect(afterImpact.spotlight).toContain('e2');
    expect(afterImpact.spotlight).not.toContain('e1');
  });

  it('nothing is dimmed on the banner beat, before any actor has started', () => {
    const { events } = run(mkState([mkUnit('a', 0, 2, 6), mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } },
    ], []);
    const cues = choreograph(events);
    const blast = phaseWindow(cues, 'blast');
    expect(sampleFrame(cues, blast.start).spotlight).toBeNull();
  });

  it('Dash lights every dasher at once — it is a simultaneous phase', () => {
    const a = mkUnit('a', 0, 2, 4);
    const b = mkUnit('b', 0, 2, 8);
    const { events } = run(mkState([a, b, mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', ability: { abilityId: 'charge', target: [{ x: 3, y: 4 }, { x: 4, y: 4 }] } },
      { unitId: 'b', ability: { abilityId: 'charge', target: [{ x: 3, y: 8 }, { x: 4, y: 8 }] } },
    ], []);
    const cues = choreograph(events);
    const dash = phaseWindow(cues, 'dash');
    const lit = sampleFrame(cues, dash.start + (dash.end - dash.start) / 2).spotlight ?? [];
    expect(lit).toContain('a');
    expect(lit).toContain('b');
  });

  it('the lit ability area is the area of the actor currently holding the stage', () => {
    const { events } = run(mkState([mkUnit('a', 0, 2, 6), mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } },
    ], []);
    const cues = choreograph(events);
    const shot = of(cues, 'ability').find((c) => c.unitId === 'a')!;
    const frame = sampleFrame(cues, shot.t);
    expect(frame.areas.length).toBe(shot.area.length);
    expect(frame.areas[0]).toEqual(shot.area[0]);
  });
});

describe('the phase label follows the timeline', () => {
  it('reads the four phases in canonical order and never goes backwards', () => {
    const { events } = run(mkState([mkUnit('a', 0, 2, 6), mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] }, movePath: [{ x: 3, y: 6 }] },
    ], []);
    const cues = choreograph(events);
    const seen: string[] = [];
    for (const { f } of walk(cues, 80)) if (f.phase !== undefined && f.phase !== seen[seen.length - 1]) seen.push(f.phase);
    expect(seen).toEqual(['prep', 'dash', 'blast', 'move']);
    expect(phaseAt(cues, -1)).toBeUndefined(); // before the first banner
  });
});

describe('focusSquares keeps the actor and its area in frame', () => {
  it('includes the lit ability area and the lit units', () => {
    const { events } = run(mkState([mkUnit('a', 0, 2, 6), mkUnit('e', 1, 6, 6)]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } },
    ], []);
    const cues = choreograph(events);
    const shot = of(cues, 'ability').find((c) => c.unitId === 'a')!;
    const frame = sampleFrame(cues, shot.t);
    const squares = focusSquares(frame, (id) => (id === 'a' ? { x: 2, y: 6 } : { x: 6, y: 6 }));
    expect(squares).toContainEqual({ x: 2, y: 6 }); // the shooter, from the fallback
    expect(squares.length).toBeGreaterThan(frame.areas.length);
  });

  it('falls back to nothing when a unit has no position at all', () => {
    const { events } = run(mkState([mkUnit('a', 0, 2, 6), mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } },
    ], []);
    const cues = choreograph(events);
    const shot = of(cues, 'ability').find((c) => c.unitId === 'a')!;
    const squares = focusSquares(sampleFrame(cues, shot.t), () => undefined);
    expect(squares).toEqual(shot.area);
  });
});

describe('a Frame is presentation only — it cannot move the board', () => {
  it('carries no HP, aliveness or kills, so skip == watch is untouched', () => {
    const { events } = run(mkState([mkUnit('a', 0, 4, 6), mkUnit('e', 1, 8, 6, { hp: 10 })]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } },
    ], []);
    const cues = choreograph(events);
    for (const { f } of walk(cues, 20)) {
      const keys = Object.keys(f).sort();
      expect(keys).toEqual(['areas', 'fades', 'impacts', 'phase', 'poses', 'readouts', 'spotlight'].sort());
      // Readouts carry a magnitude the log stated — never a resulting HP, which
      // would be the animation layer deriving state.
      for (const r of f.readouts) expect(Object.keys(r).sort()).toEqual(['age', 'amount', 'kind', 'unitId']);
    }
  });

  it('sampling past the end of the timeline is stable, not a crash', () => {
    const { events } = run(mkState([mkUnit('a', 0, 2, 6), mkUnit('e', 1, 11, 6)]), [
      { unitId: 'a', movePath: [{ x: 3, y: 6 }] },
    ], []);
    const cues = choreograph(events);
    const total = timelineLength(cues);
    expect(sampleFrame(cues, total * 10)).toEqual(sampleFrame(cues, total));
  });
});

/**
 * UI5 — damage, shield absorption and healing each surface as a distinct
 * readout. The values come from the log (`damage.amount`, `damage.absorbed`,
 * `heal.amount`, the shield pool) and are never recomputed here.
 */
describe('UI5: readouts for damage, absorb, heal and shield', () => {
  const hit = () => {
    const a = mkUnit('a', 0, 2, 6);
    const e = mkUnit('e', 1, 6, 6);
    const { events } = run(mkState([a, e]), [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } }], []);
    return { cues: choreograph(events), events };
  };

  it('a hit floats a damage number carrying exactly the logged amount', () => {
    const { cues, events } = hit();
    const dmg = events.find((e) => e.type === 'damage') as Extract<typeof events[number], { type: 'damage' }>;
    const impact = of(cues, 'impact')[0]!;
    const readouts = sampleFrame(cues, impact.t).readouts.filter((r) => r.unitId === 'e');
    expect(readouts).toHaveLength(1);
    expect(readouts[0]).toMatchObject({ kind: 'damage', amount: dmg.amount, unitId: 'e' });
  });

  it('rises and fades over its life, then goes away', () => {
    const { cues } = hit();
    const impact = of(cues, 'impact')[0]!;
    expect(sampleFrame(cues, impact.t).readouts[0]!.age).toBe(0);
    const mid = sampleFrame(cues, impact.t + READOUT_BEATS / 2).readouts[0]!;
    expect(mid.age).toBeGreaterThan(0);
    expect(mid.age).toBeLessThan(1);
    expect(sampleFrame(cues, impact.t + READOUT_BEATS + 0.01).readouts).toEqual([]);
  });

  it('a shielded hit shows BOTH numbers — the damage and what the shield ate', () => {
    // The whole reason absorb is its own readout: "26 damage" next to
    // "18 absorbed" is a different story from a bare "8".
    const caster = mkUnit('doc', 0, 4, 6);
    const tank = mkUnit('tank', 0, 5, 6);
    const enemy = mkUnit('e', 1, 5, 9);
    const t1 = run(mkState([caster, tank, enemy]), [{ unitId: 'doc', ability: { abilityId: 'guard', target: [{ x: 4, y: 6 }] } }], []);
    // `guard` is self-shield; shield the caster, then have the enemy shoot it.
    const t2 = run(t1.state, [], [{ unitId: 'e', ability: { abilityId: 'shoot', target: [{ x: 5, y: 0 }] } }]);
    const damage = t2.events.find((e) => e.type === 'damage') as Extract<typeof t2.events[number], { type: 'damage' }>;
    if (damage === undefined || damage.absorbed === 0) return; // no shielded hit landed
    const cues = choreograph(t2.events);
    const impact = of(cues, 'impact').find((c) => c.unitId === damage.unitId)!;
    const kinds = sampleFrame(cues, impact.t).readouts.filter((r) => r.unitId === damage.unitId).map((r) => r.kind);
    expect(kinds).toContain('absorb');
  });

  it('a self-shield floats a shield readout with the granted pool', () => {
    const a = mkUnit('a', 0, 2, 6);
    const { events } = run(mkState([a, mkUnit('e', 1, 11, 6)]), [{ unitId: 'a', ability: { abilityId: 'guard', target: [{ x: 2, y: 6 }] } }], []);
    const cues = choreograph(events);
    const benefit = of(cues, 'benefit')[0];
    expect(benefit).toBeDefined();
    expect(benefit).toMatchObject({ unitId: 'a', benefit: 'shield', amount: 30 });
    expect(sampleFrame(cues, benefit!.t).readouts).toContainEqual({ unitId: 'a', kind: 'shield', amount: 30, age: 0 });
  });

  it('a benefit is bound to its CASTER, so it plays in that actor’s slot', () => {
    // Only possible because A0-heal put `sourceUnitId` on heal/statusApplied.
    const a = mkUnit('a', 0, 2, 6);
    const { events } = run(mkState([a, mkUnit('e', 1, 11, 6)]), [{ unitId: 'a', ability: { abilityId: 'guard', target: [{ x: 2, y: 6 }] } }], []);
    const benefit = of(choreograph(events), 'benefit')[0]!;
    expect(benefit.sourceUnitId).toBe('a');
    expect(benefit.abilityId).toBe('guard');
  });

  it('a killing blow shows its number BEFORE the deferred-death fall (A2 rule)', () => {
    const killer = mkUnit('killer', 0, 4, 6);
    const victim = mkUnit('victim', 1, 8, 6, { hp: 10 });
    const { events } = run(mkState([killer, victim]), [{ unitId: 'killer', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } }], []);
    const cues = choreograph(events);
    const death = of(cues, 'death').find((c) => c.unitId === 'victim')!;
    // At the instant the death cue starts, the damage number is still up.
    const atDeath = sampleFrame(cues, death.t).readouts.filter((r) => r.unitId === 'victim');
    expect(atDeath.length).toBeGreaterThan(0);
    expect(atDeath[0]!.kind).toBe('damage');
  });
});
