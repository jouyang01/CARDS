import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, TeamId, TurnEvent, UnitOrders } from '../src/types.js';

/**
 * A0 — every `damage` event names its source. Blast emits every `abilityFired`
 * before any `damage`, so the log's adjacency cannot say which ability landed a
 * hit; presentation (sequential Blast, "shooter in frame" camera) reads
 * `sourceUnitId`/`abilityId` instead. Covers all four damage paths.
 */

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'square', range: 4, cooldown: 0, energyGain: 0, effects: [], description: over.id, ...over,
});

const char: CharacterDef = {
  id: 'test-char', name: 'Test', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shoot', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, energyGain: 8, effects: [{ kind: 'damage', amount: 15 }] }),
    ability({ id: 'mine', phase: 'prep', shape: 'square', range: 4, energyGain: 5, effects: [{ kind: 'trap', amount: 20 }] }),
    ability({ id: 'nade', shape: 'circle', range: 6, radius: 1, delayTurns: 1, energyGain: 10, effects: [{ kind: 'damage', amount: 25 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'square', range: 8, effects: [{ kind: 'damage', amount: 40 }] }),
};
const roster: Roster = { 'test-char': char };
const OPEN = () => makeMap(Array.from({ length: 9 }, () => '.'.repeat(9)));

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[], map = OPEN()) =>
  resolveTurn(s, map, [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], roster);
const damages = (events: TurnEvent[]) => events.filter((e) => e.type === 'damage') as Extract<TurnEvent, { type: 'damage' }>[];

describe('A0: damage events carry their source', () => {
  it('a Blast hit names the shooter and the ability', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    const { events } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 8, y: 4 }] } }], []);
    const hits = damages(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ unitId: 'e', sourceUnitId: 'u', abilityId: 'shoot' });
  });

  it('a dash strike names the charger and its ability', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    const e = makeUnit('e', 1, { x: 2, y: 0 });
    const { events } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'charge', target: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } }], []);
    expect(damages(events)[0]).toMatchObject({ unitId: 'e', sourceUnitId: 'u', abilityId: 'charge' });
  });

  it('trap damage credits the unit that placed it and the placing ability', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    // Turn 1: u places a mine at (2,4). Turn 2: e walks onto it.
    const t1 = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'mine', target: [{ x: 2, y: 4 }] } }], []);
    const t2 = run(t1.state, [], [{ unitId: 'e', movePath: [{ x: 2, y: 4 }] }]);
    const hits = damages(t2.events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ unitId: 'e', sourceUnitId: 'u', abilityId: 'mine' });
  });

  it('a delayed detonation credits its original caster, even after the caster moved', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 4, y: 4 });
    // Turn 1: u arms a grenade on (4,4). Turn 2: it detonates while u walks away.
    const t1 = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'nade', target: [{ x: 4, y: 4 }] } }], []);
    expect(damages(t1.events)).toHaveLength(0); // armed, not detonated
    const t2 = run(t1.state, [{ unitId: 'u', movePath: [{ x: 0, y: 5 }] }], []);
    const hits = damages(t2.events);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ unitId: 'e', sourceUnitId: 'u', abilityId: 'nade' });
  });

  it('with two shooters firing at once, each damage names its own attacker', () => {
    // The presentation bug A0 fixes: both abilityFired events precede both damage
    // events, so only the carried source can pair a hit with its shooter.
    const a = makeUnit('a', 0, { x: 0, y: 4 });
    const b = makeUnit('b', 0, { x: 0, y: 6 });
    const e1 = makeUnit('e1', 1, { x: 3, y: 4 });
    const e2 = makeUnit('e2', 1, { x: 3, y: 6 });
    const { events } = run(makeState([a, b, e1, e2]), [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 8, y: 4 }] } },
      { unitId: 'b', ability: { abilityId: 'shoot', target: [{ x: 8, y: 6 }] } },
    ], []);
    const bySource = new Map(damages(events).map((d) => [d.unitId, d.sourceUnitId]));
    expect(bySource.get('e1')).toBe('a');
    expect(bySource.get('e2')).toBe('b');

    // Adjacency genuinely cannot do this: every abilityFired precedes every damage.
    const kinds = events.filter((e) => e.type === 'abilityFired' || e.type === 'damage').map((e) => e.type);
    expect(kinds).toEqual(['abilityFired', 'abilityFired', 'damage', 'damage']);
  });

  it('adds no outcome change — HP and kills match the pre-A0 expectations', () => {
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    const { state } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 8, y: 4 }] } }], []);
    expect(state.units.find((x) => x.unitId === 'e')!.hp).toBe(80);
    expect(state.kills).toEqual([0, 0]);
  });
});

/**
 * A0-heal — the same attribution, widened to `heal` and `statusApplied`. Without
 * it a support's whole contribution is anonymous in the log: you can read that
 * Lumen gained 30 shield, but not that Aegis gave it to them. Purely additive —
 * the last test pins that no outcome moved.
 */

const support: CharacterDef = {
  id: 'support-char', name: 'Support', archetype: 'support', maxHp: 100,
  abilities: [
    ability({ id: 'mend', shape: 'circle', range: 6, radius: 1, energyGain: 8, effects: [{ kind: 'heal', amount: 20 }] }),
    ability({ id: 'aegis', shape: 'circle', range: 6, radius: 1, energyGain: 8, effects: [{ kind: 'shield', amount: 30, duration: 2 }] }),
    ability({ id: 'brace', phase: 'prep', shape: 'self', range: 0, energyGain: 5, effects: [{ kind: 'shield', amount: 15, duration: 1 }, { kind: 'heal', amount: 10 }] }),
    ability({ id: 'hex', shape: 'circle', range: 6, radius: 1, energyGain: 8, effects: [{ kind: 'slow', duration: 2 }] }),
    ability({ id: 'snare', phase: 'prep', shape: 'square', range: 4, energyGain: 5, effects: [{ kind: 'trap', amount: 10 }, { kind: 'root', duration: 1 }] }),
  ],
  ultimate: ability({ id: 'sup-ult', shape: 'circle', range: 8, radius: 2, effects: [{ kind: 'heal', amount: 40 }] }),
};
const bothRoster: Roster = { 'test-char': char, 'support-char': support };
const runBoth = (s: GameState, u0: UnitOrders[], u1: UnitOrders[], map = OPEN()) =>
  resolveTurn(s, map, [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], bothRoster);
const supportUnit = (unitId: string, owner: TeamId, pos: { x: number; y: number }, over: Partial<GameState['units'][number]> = {}) =>
  ({ ...makeUnit(unitId, owner, pos, over), characterId: 'support-char' });
const heals = (events: TurnEvent[]) => events.filter((e) => e.type === 'heal') as Extract<TurnEvent, { type: 'heal' }>[];
const statuses = (events: TurnEvent[]) => events.filter((e) => e.type === 'statusApplied') as Extract<TurnEvent, { type: 'statusApplied' }>[];

describe('A0-heal: heal and statusApplied events carry their source', () => {
  it('a heal on an ALLY names the healer, not the healed — the whole point', () => {
    const medic = supportUnit('medic', 0, { x: 4, y: 4 });
    const hurt = supportUnit('hurt', 0, { x: 5, y: 4 }, { hp: 40 });
    const { events } = runBoth(makeState([hurt, medic, makeUnit('e', 1, { x: 0, y: 0 })]), [
      { unitId: 'medic', ability: { abilityId: 'mend', target: [{ x: 5, y: 4 }] } },
    ], []);
    const onAlly = heals(events).find((h) => h.unitId === 'hurt');
    expect(onAlly).toMatchObject({ unitId: 'hurt', amount: 20, sourceUnitId: 'medic', abilityId: 'mend' });
  });

  it('an ALLY shield names the caster — "Aegis shielded Lumen for 30" is now expressible', () => {
    const caster = supportUnit('aegis', 0, { x: 4, y: 4 });
    const ally = supportUnit('lumen', 0, { x: 5, y: 4 });
    const { events } = runBoth(makeState([ally, caster, makeUnit('e', 1, { x: 0, y: 0 })]), [
      { unitId: 'aegis', ability: { abilityId: 'aegis', target: [{ x: 5, y: 4 }] } },
    ], []);
    const shield = statuses(events).find((s) => s.unitId === 'lumen' && s.status === 'shield');
    expect(shield).toMatchObject({ unitId: 'lumen', status: 'shield', amount: 30, sourceUnitId: 'aegis', abilityId: 'aegis' });
  });

  it('a SELF-cast names the caster as its own source, so consumers need no special case', () => {
    const u = supportUnit('u', 0, { x: 4, y: 4 }, { hp: 50 });
    const { events } = runBoth(makeState([u, makeUnit('e', 1, { x: 0, y: 0 })]), [
      { unitId: 'u', ability: { abilityId: 'brace', target: [{ x: 4, y: 4 }] } },
    ], []);
    expect(heals(events)[0]).toMatchObject({ unitId: 'u', sourceUnitId: 'u', abilityId: 'brace' });
    expect(statuses(events).find((s) => s.status === 'shield')).toMatchObject({ unitId: 'u', sourceUnitId: 'u', abilityId: 'brace' });
  });

  it('a DEBUFF names the attacker and the ability that applied it', () => {
    const caster = supportUnit('caster', 0, { x: 4, y: 4 });
    const victim = makeUnit('victim', 1, { x: 6, y: 4 });
    const { events } = runBoth(makeState([caster, victim]), [
      { unitId: 'caster', ability: { abilityId: 'hex', target: [{ x: 6, y: 4 }] } },
    ], []);
    const slow = statuses(events).find((s) => s.unitId === 'victim' && s.status === 'slow');
    expect(slow).toMatchObject({ sourceUnitId: 'caster', abilityId: 'hex' });
  });

  it("a TRAP's rider credits the unit that placed it and the placing ability", () => {
    const placer = supportUnit('placer', 0, { x: 0, y: 4 });
    const walker = makeUnit('walker', 1, { x: 3, y: 4 });
    const t1 = runBoth(makeState([placer, walker]), [{ unitId: 'placer', ability: { abilityId: 'snare', target: [{ x: 2, y: 4 }] } }], []);
    const t2 = runBoth(t1.state, [], [{ unitId: 'walker', movePath: [{ x: 2, y: 4 }] }]);
    const root = statuses(t2.events).find((s) => s.unitId === 'walker' && s.status === 'root');
    expect(root).toMatchObject({ sourceUnitId: 'placer', abilityId: 'snare' });
  });

  it('REVEAL-FIX: attacking from OPEN ground inflicts no reveal to attribute', () => {
    // Flipped by REVEAL-FIX (owner-directed, edge-cases). This used to assert
    // the attribution on an unconditional self-reveal; there is now no self-
    // reveal to attribute, because the attacker was never hidden. Kept as the
    // negative so the attribution suite still owns the case.
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    const { events } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 8, y: 4 }] } }], []);
    expect(statuses(events).find((s) => s.unitId === 'u' && s.status === 'reveal')).toBeUndefined();
  });

  it('…but a reveal earned from BRUSH still names the attack that did it', () => {
    // The half of the old case that survives: when the gate does fire, the
    // event still has to say which attack gave the position away.
    const BRUSHY = makeMap(['.........', '.........', '.........', '.........', 'b........', '.........', '.........', '.........', '.........']);
    const u = makeUnit('u', 0, { x: 0, y: 4 });
    const e = makeUnit('e', 1, { x: 3, y: 4 });
    const { events } = run(makeState([u, e]), [{ unitId: 'u', ability: { abilityId: 'shoot', target: [{ x: 8, y: 4 }] } }], [], BRUSHY);
    const reveal = statuses(events).find((s) => s.unitId === 'u' && s.status === 'reveal');
    expect(reveal).toMatchObject({ sourceUnitId: 'u', abilityId: 'shoot' });
  });

  it('a DELAYED detonation credits its original caster on riders too', () => {
    // `nade` only damages, so borrow the support's slow via a fresh delayed def.
    const bomber = supportUnit('bomber', 0, { x: 0, y: 4 });
    const victim = makeUnit('victim', 1, { x: 4, y: 4 });
    const delayedRoster: Roster = {
      'test-char': char,
      'support-char': { ...support, abilities: [...support.abilities, ability({ id: 'timer', shape: 'circle', range: 6, radius: 1, delayTurns: 1, effects: [{ kind: 'slow', duration: 2 }] })] },
    };
    const go = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
      resolveTurn(s, OPEN(), [{ team: 0 as TeamId, units: u0 }, { team: 1 as TeamId, units: u1 }], delayedRoster);
    const t1 = go(makeState([bomber, victim]), [{ unitId: 'bomber', ability: { abilityId: 'timer', target: [{ x: 4, y: 4 }] } }], []);
    const t2 = go(t1.state, [], []);
    const slow = statuses(t2.events).find((s) => s.unitId === 'victim' && s.status === 'slow');
    expect(slow).toMatchObject({ sourceUnitId: 'bomber', abilityId: 'timer' });
  });

  it('EVERY heal and statusApplied in a busy turn carries both fields — no gaps', () => {
    const medic = supportUnit('medic', 0, { x: 4, y: 4 });
    const hurt = supportUnit('hurt', 0, { x: 5, y: 4 }, { hp: 40 });
    const shooter = makeUnit('shooter', 0, { x: 0, y: 6 });
    const enemy = makeUnit('enemy', 1, { x: 3, y: 6 });
    const hexer = supportUnit('hexer', 1, { x: 6, y: 6 });
    // The shooter fires out of brush, so REVEAL-FIX's gate actually opens and
    // the turn still carries a benefit, a debuff and a reveal. On open ground
    // there would be no self-reveal to check the attribution of at all.
    const BRUSHY = makeMap(['.........', '.........', '.........', '.........', '.........', '.........', 'b........', '.........', '.........']);
    const { events } = runBoth(makeState([hurt, medic, shooter, enemy, hexer]), [
      { unitId: 'medic', ability: { abilityId: 'mend', target: [{ x: 5, y: 4 }] } },
      { unitId: 'shooter', ability: { abilityId: 'shoot', target: [{ x: 8, y: 6 }] } },
    ], [
      { unitId: 'hexer', ability: { abilityId: 'hex', target: [{ x: 3, y: 6 }] } },
    ], BRUSHY);
    const attributed = [...heals(events), ...statuses(events)];
    expect(heals(events).length).toBeGreaterThan(0); // a benefit...
    expect(statuses(events).length).toBeGreaterThan(1); // ...a debuff, and a reveal
    for (const e of attributed) {
      expect(e.sourceUnitId, JSON.stringify(e)).toBeTruthy();
      expect(e.abilityId, JSON.stringify(e)).toBeTruthy();
    }
  });

  it('is purely additive — HP, shields and kills are untouched', () => {
    const medic = supportUnit('medic', 0, { x: 4, y: 4 });
    const hurt = supportUnit('hurt', 0, { x: 5, y: 4 }, { hp: 40 });
    const { state } = runBoth(makeState([hurt, medic, makeUnit('e', 1, { x: 0, y: 0 })]), [
      { unitId: 'medic', ability: { abilityId: 'mend', target: [{ x: 5, y: 4 }] } },
    ], []);
    expect(state.units.find((u) => u.unitId === 'hurt')!.hp).toBe(60);
    expect(state.units.find((u) => u.unitId === 'medic')!.hp).toBe(100); // radius caught the caster too, already full
    expect(state.kills).toEqual([0, 0]);
  });
});
