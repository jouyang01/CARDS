import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, UnitOrders } from '../src/types.js';

/**
 * CHASE-COLLIDE — a chase walks around things instead of into them.
 *
 * Two owner Dev Notes, and they turned out to be one cause:
 *
 * 1. *"When Chasing Veil after she uses Veil & Decoy, it moves the character
 *    onto the decoy space. This should not be possible."*
 * 2. *"Chasing should still follow collision rules — no phasing through units."*
 *
 * The chase's router is `reachableSquares`, which marks an occupied square
 * `canStop: false` but still **expands through it** — correct for a player
 * drawing a path (the ally pass-through affordance) and wrong for a route
 * nobody gets to draw. A chase routes and walks in the same instant against a
 * frozen board, so a path through a body is a path `stepMovers` halts on step
 * one. Decoys were worse than that: they are kept out of `state.units` entirely
 * and "block nothing" (R2), so the router could not see them at all.
 *
 * Both reports are reproduced below **as the owner described them**, then
 * pinned. The second note is the more surprising of the two: the symptom was
 * not a chaser gliding through an enemy, it was a chaser that planned to and
 * therefore moved **nowhere**.
 */

const rows = (h: number, w: number): string[] => Array.from({ length: h }, () => '.'.repeat(w));
const OPEN = makeMap(rows(21, 21));

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shot' }),
    // Wisp's Veil & Decoy, as data: a free Prep action that stealths and leaves
    // a decoy on the square being vacated.
    ability({
      id: 'veil', phase: 'prep', shape: 'self', range: 0, free: true,
      effects: [{ kind: 'stealth', duration: 1 }, { kind: 'decoy', duration: 1 }],
    }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = [], map = OPEN) =>
  resolveTurn(s, map, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const at = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!.pos;
const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;

describe('CHASE-COLLIDE: the decoy is not a doormat', () => {
  /**
   * The reported sequence: Wisp veils at (10,10) — stealth plus a decoy on the
   * square she is standing on — and runs east. Her pursuer loses the sightline
   * to Stealth, so the goal falls back to the team's last-known square, and the
   * last-known square is the one the decoy is now standing on.
   */
  const veilAndRun = (): { state: GameState } => run(
    makeState([
      makeUnit('chaser', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
      makeUnit('wisp', 1, { x: 10, y: 10 }, { characterId: 'test-char' }),
    ]),
    [{ unitId: 'chaser', chase: 'wisp' }],
    [{
      unitId: 'wisp',
      freeAbility: { abilityId: 'veil', target: [{ x: 10, y: 10 }] },
      movePath: [{ x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }, { x: 14, y: 10 }],
    }],
  );

  it('the chase does not end on the decoy square — the reported bug', () => {
    const { state } = veilAndRun();
    expect(at(state, 'chaser'), 'the decoy stands at 10,10').not.toEqual({ x: 10, y: 10 });
  });

  it('and the decoy survives, because nothing walked onto it', () => {
    // R2 destroys a decoy an enemy is standing on. Before the fix the chase
    // popped it for free, every time, without the player choosing to test it.
    const { state } = veilAndRun();
    expect(state.decoys.map((d) => key(d.pos)), 'still on the board').toEqual(['10,10']);
  });

  it('the chase still closes as far as it legally can — it stops beside it, not short', () => {
    // The fix must not turn "do not walk onto the fake" into "give up". The
    // chaser has budget to reach the decoy's square and spends it getting
    // adjacent to it instead.
    const { state } = veilAndRun();
    const p = at(state, 'chaser');
    expect(Math.abs(p.x - 10) + Math.abs(p.y - 10), 'adjacent to the last-known square').toBe(1);
  });

  it('a deliberate MOVE onto a decoy still destroys it — R2 is untouched', () => {
    // The rule this fix is careful not to reverse. Walking onto a decoy is how
    // a player proves it fake; only the *auto-routed* chase is barred from
    // doing it by accident.
    const s = makeState([
      makeUnit('chaser', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
      makeUnit('wisp', 1, { x: 8, y: 10 }, { characterId: 'test-char' }),
    ]);
    const veiled = run(s, [], [{ unitId: 'wisp', freeAbility: { abilityId: 'veil', target: [{ x: 8, y: 10 }] }, movePath: [{ x: 9, y: 10 }] }]);
    expect(veiled.state.decoys, 'a decoy exists to be tested').toHaveLength(1);

    const walked = run(
      veiled.state,
      [{ unitId: 'chaser', movePath: [{ x: 6, y: 10 }, { x: 7, y: 10 }, { x: 8, y: 10 }] }],
    );
    expect(at(walked.state, 'chaser'), 'the player chose that square').toEqual({ x: 8, y: 10 });
    expect(walked.state.decoys, 'and popped the fake by standing on it').toHaveLength(0);
  });

  it("a team's OWN decoy does not block its own chase", () => {
    // Nobody is fooled by their own illusion, and blocking on one would be a
    // tell the enemy could read off the pathing. Matches R2's own asymmetry:
    // own-team decoys are untouched by their team's damage.
    const s = makeState([
      makeUnit('wisp', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
      makeUnit('chaser', 0, { x: 3, y: 10 }, { characterId: 'test-char' }),
      // Within the chaser's vision radius, because *ordering* a chase is still
      // range-capped (`planUnit`; ratified 2026-09-11) even though following one
      // is not. That gate is not what this case is about.
      makeUnit('e', 1, { x: 9, y: 10 }, { characterId: 'test-char' }),
    ]);
    // Wisp veils at (5,10) and steps aside, leaving her team's decoy directly
    // between her teammate and its quarry.
    const { state } = run(
      s,
      [
        { unitId: 'wisp', freeAbility: { abilityId: 'veil', target: [{ x: 5, y: 10 }] }, movePath: [{ x: 5, y: 12 }] },
        { unitId: 'chaser', chase: 'e' },
      ],
    );
    expect(state.decoys.map((d) => key(d.pos))).toEqual(['5,10']);
    expect(at(state, 'chaser').x, 'walked past its own decoy, straight down the row').toBeGreaterThan(5);
    expect(at(state, 'chaser').y, 'without detouring around it').toBe(10);
  });
});

describe('CHASE-COLLIDE: a chase routes around bodies instead of into them', () => {
  /** `blocker` stands directly between the chaser and its target. */
  const wall = (): GameState => makeState([
    makeUnit('chaser', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
    makeUnit('blocker', 1, { x: 6, y: 10 }, { characterId: 'test-char' }),
    makeUnit('target', 1, { x: 8, y: 10 }, { characterId: 'test-char' }),
  ]);

  it('the reported case: it goes around and catches up, instead of standing still', () => {
    // The symptom was not phasing — it was a chaser that *planned* to phase and
    // was stopped on its first step, ending exactly where it started.
    const { state } = run(wall(), [{ unitId: 'chaser', chase: 'target' }]);
    expect(at(state, 'chaser'), 'it moved at all').not.toEqual({ x: 5, y: 10 });
    const p = at(state, 'chaser');
    expect(Math.abs(p.x - 8) + Math.abs(p.y - 10), 'and finished adjacent to its target').toBe(1);
  });

  it('it never stands on the blocker, and the blocker never moves', () => {
    const { state } = run(wall(), [{ unitId: 'chaser', chase: 'target' }]);
    expect(at(state, 'chaser')).not.toEqual({ x: 6, y: 10 });
    expect(at(state, 'blocker'), 'untouched by somebody else\'s pathing').toEqual({ x: 6, y: 10 });
  });

  it('an ALLY in the way is routed around too — this router draws no lines', () => {
    // Ally pass-through is a *planning* affordance for a path a player draws
    // and the engine validates later. A chase walks its route the instant it
    // computes it, against units that have all finished moving, so an ally is
    // as solid as an enemy here.
    const s = makeState([
      makeUnit('chaser', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
      makeUnit('mate', 0, { x: 6, y: 10 }, { characterId: 'test-char' }),
      makeUnit('target', 1, { x: 8, y: 10 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, [{ unitId: 'chaser', chase: 'target' }]);
    const p = at(state, 'chaser');
    expect(p, 'not on top of its teammate').not.toEqual({ x: 6, y: 10 });
    expect(Math.abs(p.x - 8) + Math.abs(p.y - 10), 'still caught the target').toBe(1);
  });

  it('a body that genuinely seals a corridor stops the chase — the honest answer', () => {
    // Walking around is not always possible, and inventing a way past would be
    // exactly the phasing the note is about. One tile of corridor, one body in
    // it: the chase gets nowhere, and that is correct.
    const CORRIDOR = makeMap(rows(21, 21).map((row, y) => (y === 9 || y === 11 ? '#'.repeat(21) : row)));
    const { state } = run(
      makeState([
        makeUnit('chaser', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
        makeUnit('blocker', 1, { x: 6, y: 10 }, { characterId: 'test-char' }),
        makeUnit('target', 1, { x: 8, y: 10 }, { characterId: 'test-char' }),
      ]),
      [{ unitId: 'chaser', chase: 'target' }],
      [],
      CORRIDOR,
    );
    expect(at(state, 'chaser'), 'sealed in, and it does not squeeze past').toEqual({ x: 5, y: 10 });
  });

  it('an unobstructed chase is unchanged — the fix costs nothing on an empty board', () => {
    const s = makeState([
      makeUnit('chaser', 0, { x: 5, y: 10 }, { characterId: 'test-char' }),
      makeUnit('target', 1, { x: 9, y: 10 }, { characterId: 'test-char' }),
    ]);
    const { state } = run(s, [{ unitId: 'chaser', chase: 'target' }]);
    expect(at(state, 'chaser'), 'straight down the row, stopping beside it').toEqual({ x: 8, y: 10 });
  });

  it('and it is deterministic — the detour is the same one every time', () => {
    const go = () => run(wall(), [{ unitId: 'chaser', chase: 'target' }]);
    const once = go();
    const twice = go();
    expect(JSON.stringify(once.state)).toEqual(JSON.stringify(twice.state));
    expect(JSON.stringify(once.events)).toEqual(JSON.stringify(twice.events));
  });
});
