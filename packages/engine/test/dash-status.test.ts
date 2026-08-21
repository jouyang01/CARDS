import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { applyStatus } from '../src/status.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, TurnEvent, Vec2 } from '../src/types.js';

/**
 * DASH-STATUS — a Dash-phase ability applies its status riders (Builder OQ
 * 2026-09-18 #3).
 *
 * `runDash` applied damage and displacement and nothing else. Bramble Stride's
 * Root and Tempest Run's Slow were in `data/` and reached nobody: two shipped
 * kits doing less than their own descriptions say, with no test failing because
 * no test had ever asked.
 *
 * The riders now ride. They are gathered with the damage and applied in
 * **PHASE-STATUS-FIRST's status sub-step** — before any of the phase's damage —
 * which is the same arrangement the Blast phase runs under and the reason a Root
 * landed by one charge is already on its victim while a second charge's number
 * is being computed.
 *
 * Two properties that are easy to lose and are pinned below: a rider-only dash
 * (no damage effect at all) still finds its victims, because gating the victim
 * list on damage is precisely what made the riders invisible; and CASTER-SAFE
 * still holds, so a dasher never roots itself.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const THORN = load('thorn');
const KESTREL = load('kestrel');
const VEX = load('vex');
const BRAMBLE = THORN.abilities.find((a) => a.id === 'bramble_stride')!;
const STRIDE_DAMAGE = BRAMBLE.effects.find((e) => e.kind === 'damage')!.amount!;
const TEMPEST = KESTREL.ultimate;

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }, { x: 3, y: 10 }], [{ x: 18, y: 10 }, { x: 17, y: 10 }]],
};
const roster: Roster = { thorn: THORN, kestrel: KESTREL, vex: VEX };

const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
/** Which statuses a turn *applied* to a unit — a `duration: 1` rider is ticked
 *  away by end of turn, so the event log is the honest record of what landed. */
const applied = (events: readonly TurnEvent[], unitId: string): string[] => events
  .flatMap((e) => (e.type === 'statusApplied' && e.unitId === unitId ? [e.status] : []));

/** A charger and two enemies standing in a row east of it. */
const field = (charger: CharacterDef, at: Vec2, foes: Vec2[]) => {
  const state = createMatch(OPEN, '2v2', [[charger, VEX], [VEX, VEX]]);
  const me = state.units.find((u) => u.characterId === charger.id && u.owner === 0)!;
  const mate = state.units.find((u) => u.owner === 0 && u.unitId !== me.unitId)!;
  const enemies = state.units.filter((u) => u.owner === 1);
  me.pos = { ...at };
  mate.pos = { x: 0, y: 20 };
  for (const [i, foe] of enemies.entries()) {
    foe.pos = foes[i] !== undefined ? { ...foes[i]! } : { x: 20, y: 0 };
  }
  return { state, me, mate, enemies };
};

const charge = (state: GameState, unitId: string, abilityId: string, path: Vec2[]) =>
  resolveTurn(state, OPEN, [
    { team: 0, units: [{ unitId, ability: { abilityId, target: path.map((p) => ({ ...p })) } }] },
    { team: 1, units: [] },
  ], roster);

describe('DASH-STATUS: the riders in the data actually ride', () => {
  it('Bramble Stride roots the unit it runs through', () => {
    // The named case. Thorn charges east through an enemy standing at (7,10).
    const { state, me, enemies } = field(THORN, { x: 5, y: 10 }, [{ x: 7, y: 10 }]);
    const res = charge(state, me.unitId, 'bramble_stride', [
      { x: 6, y: 10 }, { x: 7, y: 10 }, { x: 8, y: 10 },
    ]);
    expect(applied(res.events, enemies[0]!.unitId), 'the Root in its data').toContain('root');
    expect(unit(res.state, enemies[0]!.unitId).hp, 'and the damage in its data')
      .toBe(VEX.maxHp - STRIDE_DAMAGE);
  });

  it('Tempest Run slows every unit it hits, not just the first', () => {
    // `chargeHits: "all"` — the ult runs through a line of them, and the rider
    // has to reach the same set the damage does.
    const { state, me, enemies } = field(KESTREL, { x: 5, y: 10 }, [{ x: 7, y: 10 }, { x: 9, y: 10 }]);
    unit(state, me.unitId).energy = 100;
    const res = charge(state, me.unitId, TEMPEST.id, [
      { x: 6, y: 10 }, { x: 7, y: 10 }, { x: 8, y: 10 }, { x: 9, y: 10 }, { x: 10, y: 10 },
    ]);
    for (const foe of enemies) {
      expect(applied(res.events, foe.unitId), foe.unitId).toContain('slow');
      expect(unit(res.state, foe.unitId).hp, `${foe.unitId} took the charge`).toBeLessThan(VEX.maxHp);
    }
  });

  it('a unit the charge never touched is untouched', () => {
    // The control: the riders follow the victim list, not the phase.
    const { state, me, enemies } = field(THORN, { x: 5, y: 10 }, [{ x: 7, y: 10 }, { x: 5, y: 2 }]);
    const res = charge(state, me.unitId, 'bramble_stride', [{ x: 6, y: 10 }, { x: 7, y: 10 }]);
    expect(applied(res.events, enemies[1]!.unitId)).toEqual([]);
  });

  it('and the dasher never roots itself (CASTER-SAFE)', () => {
    const { state, me, enemies } = field(THORN, { x: 5, y: 10 }, [{ x: 7, y: 10 }]);
    const res = charge(state, me.unitId, 'bramble_stride', [{ x: 6, y: 10 }, { x: 7, y: 10 }]);
    expect(applied(res.events, me.unitId), 'the charger is not its own victim').toEqual([]);
    expect(applied(res.events, enemies[0]!.unitId), 'the one it ran through is').toContain('root');
  });
});

describe('DASH-STATUS: the shape of the fix', () => {
  const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
    name: over.id, phase: 'dash', shape: 'path', range: 6, cooldown: 0, energyGain: 8,
    effects: [], description: over.id, ...over,
  });
  const CHARGER: CharacterDef = {
    id: 'charger', name: 'C', archetype: 'frontline', maxHp: 100,
    abilities: [
      // A dash whose only effect is a rider — no damage at all.
      ability({ id: 'snag', effects: [{ kind: 'root', duration: 2 }] }),
      // The same, sparing its own team (ALLY-SAFE).
      ability({ id: 'kind_snag', noFriendlyFire: true, effects: [{ kind: 'slow', duration: 2 }, { kind: 'damage', amount: 5 }] }),
    ],
    ultimate: ability({ id: 'ult', phase: 'blast', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
  };
  const testRoster: Roster = { charger: CHARGER, vex: VEX };
  const run = (state: GameState, unitId: string, abilityId: string, path: Vec2[]) =>
    resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId, ability: { abilityId, target: path } }] },
      { team: 1, units: [] },
    ], testRoster);

  /** A charger with a teammate and an enemy on the same row. */
  const line = () => {
    const state = createMatch(OPEN, '2v2', [[CHARGER, VEX], [VEX, VEX]]);
    const me = state.units.find((u) => u.characterId === 'charger')!;
    const mate = state.units.find((u) => u.owner === 0 && u.unitId !== me.unitId)!;
    const [foe, other] = state.units.filter((u) => u.owner === 1);
    me.pos = { x: 5, y: 10 };
    mate.pos = { x: 6, y: 10 };
    foe!.pos = { x: 7, y: 10 };
    other!.pos = { x: 20, y: 0 };
    return { state, me, mate, foe: foe! };
  };

  it('a dash with NO damage still finds its victims', () => {
    // The bug in one line: the victim list used to be built only when there was
    // a damage effect, so a rider-only dash was a no-op by construction.
    const { state, me, mate } = line();
    const res = run(state, me.unitId, 'snag', [{ x: 6, y: 10 }, { x: 7, y: 10 }]);
    expect(applied(res.events, mate.unitId), 'the first unit crossed').toContain('root');
  });

  it('and it pays energy for reaching an enemy, like every other harmful use', () => {
    const { state, me } = line();
    const mate = state.units.find((u) => u.owner === 0 && u.unitId !== me.unitId)!;
    mate.pos = { x: 0, y: 20 }; // out of the way, so the enemy is the first crossed
    const res = run(state, me.unitId, 'snag', [{ x: 6, y: 10 }, { x: 7, y: 10 }]);
    expect(unit(res.state, me.unitId).energy, 'use energy plus the passive').toBeGreaterThan(5);
  });

  it('ALLY-SAFE still spares the team it was told to spare', () => {
    // A charge that skips its own team must skip the rider too, or the flag
    // would mean "does not damage you" rather than "does not hit you".
    const { state, me, mate, foe } = line();
    const res = run(state, me.unitId, 'kind_snag', [{ x: 6, y: 10 }, { x: 7, y: 10 }]);
    expect(applied(res.events, mate.unitId), 'the teammate it ran past').toEqual([]);
    expect(applied(res.events, foe.unitId), 'the enemy behind them').toContain('slow');
  });

  it('an Untargetable unit takes neither the damage nor the rider', () => {
    const { state, me, mate } = line();
    applyStatus(mate, 'untargetable', 2);
    const res = run(state, me.unitId, 'snag', [{ x: 6, y: 10 }, { x: 7, y: 10 }]);
    expect(applied(res.events, mate.unitId)).toEqual([]);
  });

  it('the rider lands BEFORE the phase\'s damage (PHASE-STATUS-FIRST)', () => {
    // Order in the log is the observable form of the sub-steps: every
    // `statusApplied` the Dash phase produces precedes every `damage` it does.
    const { state, me } = line();
    const res = run(state, me.unitId, 'kind_snag', [{ x: 6, y: 10 }, { x: 7, y: 10 }]);
    const kinds = res.events
      .slice(res.events.findIndex((e) => e.type === 'phaseStart' && e.phase === 'dash'))
      .filter((e) => e.type === 'statusApplied' || e.type === 'damage')
      .map((e) => e.type);
    const lastStatus = kinds.lastIndexOf('statusApplied');
    const firstDamage = kinds.indexOf('damage');
    expect(firstDamage, 'the phase did damage').toBeGreaterThanOrEqual(0);
    expect(lastStatus, 'and applied a status').toBeGreaterThanOrEqual(0);
    expect(lastStatus).toBeLessThan(firstDamage);
  });
});
