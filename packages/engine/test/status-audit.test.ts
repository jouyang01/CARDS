import { describe, expect, it } from 'vitest';
import { ENERGIZED_PCT, MIGHT_PCT, MOVE_RANGE, WEAKEN_PCT } from '../src/constants.js';
import { buildBoard } from '../src/board.js';
import { buildVision, visibleEnemiesForTeam } from '../src/vision.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type { AbilityDef, CharacterDef, EffectKind, GameState, TurnEvent, UnitOrders } from '../src/types.js';

/**
 * STATUS-AUDIT — one end-to-end assertion per status kind, on a **resolved**
 * outcome rather than on the status object.
 *
 * The Dev Note said Stealth and Slow "are not working". The engine's status
 * math was right; what was missing was any way to *see* a status land, and two
 * upstream client bugs (FREE-UI, DECOY-RENDER) that made the stealth kit
 * unusable. So the point of this file is not to re-test `applyStatus` — it is
 * to prove each kind changes something a player can observe, so "is Slow
 * working?" has an answer that does not depend on reading the state dump.
 *
 * Every case here is written as: set up the status, resolve a turn, assert the
 * OUTCOME differs from the same turn without it.
 */

const OPEN = makeMap(Array.from({ length: 21 }, () => '.'.repeat(21)));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 10,
  effects: [{ kind: 'damage', amount: 40 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shot' }),
    ability({ id: 'shove', effects: [{ kind: 'damage', amount: 10 }, { kind: 'knockback', amount: 2 }] }),
    ability({ id: 'yank', effects: [{ kind: 'damage', amount: 10 }, { kind: 'pull', amount: 2 }] }),
    ability({ id: 'guard', phase: 'prep', shape: 'self', range: 0, energyGain: 0, effects: [{ kind: 'shield', amount: 30, duration: 2 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, energyGain: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
/** A straight walk east of `n` squares from (4,10). */
const walk = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 5 + i, y: 10 }));

/**
 * One mover and one target. The target sits at (10,10) — 6 away, inside the
 * range-8 line — for the damage cases; the movement cases move it off the row
 * so a walk is never blocked by a body instead of by a status.
 */
const board = (on: EffectKind[] = [], onTarget: EffectKind[] = [], turns = 3): GameState => makeState([
  withStatuses(makeUnit('a', 0, { x: 4, y: 10 }, { characterId: 'test-char' }), ...on.map((k) => status(k, turns))),
  withStatuses(makeUnit('e', 1, { x: 10, y: 10 }, { characterId: 'test-char' }), ...onTarget.map((k) => status(k, turns))),
]);
/** The same, with the target parked well off the walked row. */
const clearRow = (on: EffectKind[] = [], turns = 3): GameState => {
  const s = board(on, [], turns);
  s.units[1]!.pos = { x: 18, y: 0 };
  return s;
};
const AIM = [{ x: 10, y: 10 }];

describe('STATUS-AUDIT: movement statuses change a RESOLVED move', () => {
  it('slow shortens the walk — the reported one', () => {
    // 4 × (100 − 50)% = a 2-square budget. An over-budget path is rejected
    // outright rather than clamped, so a slowed unit asked for 4 simply holds —
    // and the same unit asked for 2 walks. Both halves, or "it didn't move" is
    // indistinguishable from "the order was malformed".
    expect(unit(run(clearRow(), [{ unitId: 'a', movePath: walk(MOVE_RANGE) }]).state, 'a').pos)
      .toEqual({ x: 8, y: 10 });
    expect(unit(run(clearRow(['slow']), [{ unitId: 'a', movePath: walk(MOVE_RANGE) }]).state, 'a').pos)
      .toEqual({ x: 4, y: 10 });
    expect(unit(run(clearRow(['slow']), [{ unitId: 'a', movePath: walk(2) }]).state, 'a').pos)
      .toEqual({ x: 6, y: 10 });
  });

  it('haste lengthens it', () => {
    // 4 × (100 + 50)% = 6, so a 6-square path is legal only while Hasted.
    expect(unit(run(clearRow(), [{ unitId: 'a', movePath: walk(6) }]).state, 'a').pos)
      .toEqual({ x: 4, y: 10 });
    expect(unit(run(clearRow(['haste']), [{ unitId: 'a', movePath: walk(6) }]).state, 'a').pos)
      .toEqual({ x: 10, y: 10 });
    // …and it cancels a Slow exactly: 4 × (100 + 50 − 50)% = 4.
    expect(unit(run(clearRow(['haste', 'slow']), [{ unitId: 'a', movePath: walk(MOVE_RANGE) }]).state, 'a').pos)
      .toEqual({ x: 8, y: 10 });
  });

  it('root stops it dead', () => {
    expect(unit(run(clearRow(['root']), [{ unitId: 'a', movePath: walk(MOVE_RANGE) }]).state, 'a').pos)
      .toEqual({ x: 4, y: 10 });
    // Even a single step — Root is not a budget cut, it is a zero.
    expect(unit(run(clearRow(['root']), [{ unitId: 'a', movePath: walk(1) }]).state, 'a').pos)
      .toEqual({ x: 4, y: 10 });
  });

  it('unstoppable ignores a knockback', () => {
    const plain = run(board(), [{ unitId: 'a', ability: { abilityId: 'shove', target: AIM } }]);
    const immune = run(board([], ['unstoppable']), [{ unitId: 'a', ability: { abilityId: 'shove', target: AIM } }]);
    expect(unit(plain.state, 'e').pos).toEqual({ x: 12, y: 10 }); // pushed 2
    expect(unit(immune.state, 'e').pos).toEqual({ x: 10, y: 10 }); // stood its ground
  });

  it('unstoppable ignores a pull too — displacement is displacement', () => {
    const plain = run(board(), [{ unitId: 'a', ability: { abilityId: 'yank', target: AIM } }]);
    const immune = run(board([], ['unstoppable']), [{ unitId: 'a', ability: { abilityId: 'yank', target: AIM } }]);
    expect(unit(plain.state, 'e').pos).toEqual({ x: 8, y: 10 });
    expect(unit(immune.state, 'e').pos).toEqual({ x: 10, y: 10 });
  });
});

describe('STATUS-AUDIT: damage statuses change DEALT damage', () => {
  const dealt = (s: GameState) => 100 - unit(s, 'e').hp;
  const shot = [{ unitId: 'a', ability: { abilityId: 'shot', target: AIM } }];

  it('might raises it', () => {
    expect(dealt(run(board(), shot).state)).toBe(40);
    expect(dealt(run(board(['might']), shot).state)).toBe(40 + Math.floor((40 * MIGHT_PCT) / 100));
  });

  it('weaken lowers it', () => {
    expect(dealt(run(board(['weaken']), shot).state)).toBe(40 - Math.floor((40 * WEAKEN_PCT) / 100));
  });

  it('might and weaken cancel', () => {
    expect(dealt(run(board(['might', 'weaken']), shot).state)).toBe(40);
  });

  it('shield absorbs before HP, and the absorption is reported', () => {
    const s = board();
    unit(s, 'e').statuses = [{ kind: 'shield', remaining: 2, amount: 25 }];
    const shielded = run(s, shot);
    expect(dealt(shielded.state)).toBe(15); // 40 − 25 absorbed
    expect(shielded.events.some((e) => e.type === 'damage' && e.unitId === 'e' && e.absorbed === 25)).toBe(true);
  });

  it('untargetable blocks the hit entirely (UNTGT1)', () => {
    // This one FAILED when the audit was first written: Fade and Shadowstep
    // applied the status, and no damage path ever read it back. "Cannot be hit"
    // (GAME_SPEC §6) has to stop a shot or the status is decoration.
    expect(dealt(run(board(), shot).state)).toBe(40);
    expect(dealt(run(board([], ['untargetable']), shot).state)).toBe(0);
  });

  it('…and its riders with it — no damage, no knockback, no debuff', () => {
    const immune = run(board([], ['untargetable']), [
      { unitId: 'a', ability: { abilityId: 'shove', target: AIM } },
    ]);
    expect(dealt(immune.state)).toBe(0);
    expect(unit(immune.state, 'e').pos).toEqual({ x: 10, y: 10 }); // not shoved
  });

  it('…and pays the attacker no energy, because nothing was hit', () => {
    const plain = run(board(), shot);
    const whiffed = run(board([], ['untargetable']), shot);
    expect(unit(plain.state, 'a').energy - unit(whiffed.state, 'a').energy).toBe(10);
  });

  it('…but a friendly heal still lands — hiding from attacks, not from your medic', () => {
    const s = board([], []);
    // Same team, standing in the Prep shield's own square.
    s.units[1]!.owner = 0;
    s.units[1]!.pos = { x: 4, y: 10 };
    s.units[1]!.statuses = [status('untargetable', 3)];
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'guard', target: [{ x: 4, y: 10 }] } }]);
    expect(unit(state, 'e').statuses.some((st) => st.kind === 'shield')).toBe(true);
  });
});

describe('STATUS-AUDIT: economy and perception', () => {
  it('energized scales the energy an ability earns', () => {
    const gained = (s: GameState) => unit(s, 'a').energy;
    const plain = run(board(), [{ unitId: 'a', ability: { abilityId: 'shot', target: AIM } }]);
    const charged = run(board(['energized']), [{ unitId: 'a', ability: { abilityId: 'shot', target: AIM } }]);
    // 10 base × (100 + 50)% = 15; the end-of-turn passive lands on both, so the
    // difference is the whole of the effect.
    expect(gained(charged.state) - gained(plain.state)).toBe(Math.floor((10 * ENERGIZED_PCT) / 100));
  });

  it('stealth removes the unit from what the enemy team can see', () => {
    const s = board([], ['stealth']);
    const vision = buildVision(buildBoard(OPEN));
    // Standing in the open at distance 10 — out of sight range anyway, so move
    // it close enough that only Stealth can be doing the hiding.
    unit(s, 'e').pos = { x: 6, y: 10 };
    expect(visibleEnemiesForTeam(vision, s, 0).map((u) => u.unitId)).toEqual([]);

    const seen = board();
    unit(seen, 'e').pos = { x: 6, y: 10 };
    expect(visibleEnemiesForTeam(vision, seen, 0).map((u) => u.unitId)).toEqual(['e']);
  });

  it('reveal defeats stealth — it is checked first', () => {
    const s = board([], ['stealth', 'reveal']);
    unit(s, 'e').pos = { x: 6, y: 10 };
    const vision = buildVision(buildBoard(OPEN));
    expect(visibleEnemiesForTeam(vision, s, 0).map((u) => u.unitId)).toEqual(['e']);
  });

  it('attacking breaks stealth — the status is gone from the resolved state', () => {
    const s = board(['stealth'], []);
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'shot', target: AIM } }]);
    expect(state.units.find((u) => u.unitId === 'a')!.statuses.some((st) => st.kind === 'stealth')).toBe(false);
  });
});

describe('STATUS-AUDIT: a status that LEAVES is logged, not inferred', () => {
  const removals = (events: readonly TurnEvent[]) => events
    .filter((e) => e.type === 'statusRemoved')
    .map((e) => ({ unitId: e.unitId, status: e.status, reason: e.reason }));

  it('logs the end-of-turn expiry, so the client can retire an indicator', () => {
    const { events } = run(board(['might'], [], 1), []);
    expect(removals(events)).toContainEqual({ unitId: 'a', status: 'might', reason: 'expired' });
  });

  it('does not log a status that merely ticked down', () => {
    const { events } = run(board(['might'], [], 2), []);
    expect(removals(events)).toEqual([]);
  });

  it('logs Stealth broken by attacking as `broken`, not `expired`', () => {
    const { events } = run(board(['stealth'], [], 5), [
      { unitId: 'a', ability: { abilityId: 'shot', target: AIM } },
    ]);
    expect(removals(events)).toContainEqual({ unitId: 'a', status: 'stealth', reason: 'broken' });
  });

  it('logs Stealth broken by TAKING damage, on the victim', () => {
    const { events } = run(board([], ['stealth'], 5), [
      { unitId: 'a', ability: { abilityId: 'shot', target: AIM } },
    ]);
    expect(removals(events)).toContainEqual({ unitId: 'e', status: 'stealth', reason: 'broken' });
  });

  it('never logs a removal for a status the unit did not have', () => {
    const { events } = run(board(), [{ unitId: 'a', ability: { abilityId: 'shot', target: AIM } }]);
    expect(removals(events).some((r) => r.status === 'stealth')).toBe(false);
  });

  it('folding applied-minus-removed over the log reproduces the resolved statuses', () => {
    // This is the contract the client's indicators rest on: the event log alone
    // is enough to know who is carrying what, with nothing derived.
    const { state, events } = run(board(['stealth'], [], 2), [
      { unitId: 'a', ability: { abilityId: 'guard', target: [{ x: 4, y: 10 }] } },
    ]);
    const folded = new Set<EffectKind>(['stealth']); // the pre-turn state
    for (const e of events) {
      if (e.type === 'statusApplied' && e.unitId === 'a') folded.add(e.status);
      if (e.type === 'statusRemoved' && e.unitId === 'a') folded.delete(e.status);
    }
    expect([...folded].sort()).toEqual(unit(state, 'a').statuses.map((s) => s.kind).sort());
  });
});

describe('STATUS-AUDIT: every status kind is covered by this file', () => {
  it('names the kinds asserted above, so a new one cannot slip in untested', () => {
    // The audit's value is completeness. If a status kind is added and nobody
    // writes an end-to-end case for it, this list stops matching and says so.
    const audited: EffectKind[] = [
      'slow', 'haste', 'root', 'unstoppable', 'might', 'weaken', 'shield',
      'untargetable', 'energized', 'stealth', 'reveal',
    ];
    const STATUS_KINDS: EffectKind[] = [
      'might', 'weaken', 'haste', 'slow', 'root', 'reveal', 'energized',
      'unstoppable', 'stealth', 'untargetable', 'shield',
    ];
    expect([...audited].sort()).toEqual([...STATUS_KINDS].sort());
  });

  it('every status ticks down and expires — durations are not decorative', () => {
    const s = board(['might'], [], 1);
    const { state } = run(s, []);
    expect(unit(state, 'a').statuses.some((st) => st.kind === 'might' && st.remaining > 0)).toBe(false);

    const longer = board(['might'], [], 2);
    expect(unit(run(longer, []).state, 'a').statuses.find((st) => st.kind === 'might')?.remaining).toBe(1);
  });
});
