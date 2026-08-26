import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VISION_RANGE,
  createMatch,
  resolveTurn,
  type CharacterDef,
  type GameState,
  type MapDef,
  type Roster,
} from '@cards/engine';
import { fogView } from '../src/fog.js';

/**
 * STEALTH-CONFIRM — "Does Veil's Stealth work? It doesn't seem to be working."
 *
 * Two separable questions. When this file was written they had different
 * answers; STEALTH-DURATION closed the gap and now they agree.
 *
 * 1. **Does the render path honour Stealth?** Yes, and always did. A stealthed
 *    Wisp is absent from the enemy's `fogView` while its decoy is present and
 *    enemy-styled, and its own team still sees the real unit with a purple decoy
 *    beside it. That is what DECOY-RENDER + STATUS-AUDIT bought.
 *
 * 2. **Can a player ever observe it?** Now yes. Veil & Decoy's Stealth shipped
 *    at `duration: 1`, and GAME_SPEC §6 ticks durations at end of turn, so a
 *    Stealth applied in Prep was removed by that same turn's tick — gone before
 *    the enemy's next Decision phase, while the decoy (which expires at
 *    `castTurn + 1`) was still standing. The enemy saw a Wisp *and* a decoy in
 *    one square, which read exactly as "Stealth is broken". The owner ruled the
 *    duration to **2** (STEALTH-DURATION), covering the cast turn and the next,
 *    so the caster is now hidden through the enemy's next look — which is the
 *    whole point of the ability.
 *
 * The second block below was written as a **reproduction of that bug**. It is
 * now the **proof of the fix**: same casts, inverted expectations. Keeping the
 * shape makes the diff the argument.
 */

const load = (n: string): CharacterDef =>
  JSON.parse(readFileSync(join(import.meta.dirname, `../../../data/characters/${n}.json`), 'utf8')) as CharacterDef;
const WISP = load('wisp');
const VEX = load('vex');
const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 7 }], [{ x: 12, y: 7 }]],
};
const roster: Roster = { wisp: WISP, vex: VEX };

/** Wisp and one enemy three squares apart — well inside `VISION_RANGE`. */
const facing = (): GameState => {
  const s = createMatch(OPEN, '1v1', [[WISP], [VEX]]);
  s.units[0]!.pos = { x: 6, y: 7 };
  s.units[1]!.pos = { x: 9, y: 7 };
  return s;
};
const wispId = (s: GameState) => s.units.find((u) => u.characterId === 'wisp')!.unitId;

describe('the render path honours Stealth exactly as specified', () => {
  /** The board as it would be if the Stealth were still standing. */
  const stealthed = (): GameState => {
    const s = facing();
    const wisp = s.units.find((u) => u.characterId === 'wisp')!;
    wisp.statuses = [{ kind: 'stealth', remaining: 1 }];
    s.decoys = [{ id: 'd1', teamId: 0, pos: { ...wisp.pos }, expiresOnTurn: 99 }];
    return s;
  };

  it('the enemy is shown the decoy and NOT the stealthed Wisp', () => {
    const view = fogView(OPEN, stealthed(), 1);
    expect(view.units.map((u) => u.characterId)).not.toContain('wisp');
    expect(view.decoys).toHaveLength(1);
    // Drawn as an enemy unit: a decoy that announced itself would be useless.
    expect(view.decoys[0]!.asEnemy).toBe(true);
  });

  it('and without the Stealth the enemy sees both — so it is Stealth doing the work', () => {
    const s = stealthed();
    s.units.find((u) => u.characterId === 'wisp')!.statuses = [];
    const view = fogView(OPEN, s, 1);
    expect(view.units.map((u) => u.characterId)).toContain('wisp');
    expect(view.decoys).toHaveLength(1);
  });

  it("Wisp's own team sees the real unit, with its decoy marked as its own", () => {
    const view = fogView(OPEN, stealthed(), 0);
    expect(view.units.map((u) => u.characterId)).toContain('wisp');
    expect(view.decoys[0]!.asEnemy).toBe(false); // the purple marker, not a fake enemy
  });

  it('distance is not what is hiding it — the enemy is three squares away', () => {
    // Guards the premise: if the two were simply out of sight range, every
    // assertion above would pass for the wrong reason.
    const s = stealthed();
    const [wisp, enemy] = [s.units[0]!, s.units[1]!];
    expect(Math.abs(wisp.pos.x - enemy.pos.x) + Math.abs(wisp.pos.y - enemy.pos.y))
      .toBeLessThan(VISION_RANGE);
  });
});

describe('and the shipped Veil & Decoy now survives to be seen', () => {
  /**
   * W1 carries an aim now: the decoy goes on a square up to 3 away rather than
   * under Wisp's feet, so the cast names one. Two tiles north of wherever she
   * is standing — in range, and never her own square, which DECOY-PLACEMENT
   * refuses.
   */
  const castVeil = (s: GameState) => {
    const wisp = s.units.find((u) => u.unitId === wispId(s))!;
    return resolveTurn(
      s, OPEN,
      [{
        team: 0,
        units: [{
          unitId: wispId(s),
          freeAbility: { abilityId: 'veil_decoy', target: [{ x: wisp.pos.x, y: wisp.pos.y - 2 }] },
        }],
      }, { team: 1, units: [] }],
      roster,
    );
  };

  it('the Stealth lands during the turn', () => {
    const { events } = castVeil(facing());
    expect(events.some((e) => e.type === 'statusApplied' && e.status === 'stealth')).toBe(true);
  });

  it('…and survives the same turn\'s end-of-turn tick, with a turn left on it', () => {
    // The inversion. At `duration: 1` this asserted a `statusRemoved` expiry and
    // an empty status list — the status was gone before anyone could look at it.
    // At `duration: 2` it ticks to 1 and stands through the enemy's next turn.
    const { state, events } = castVeil(facing());
    expect(events.some((e) => e.type === 'statusRemoved' && e.status === 'stealth' && e.reason === 'expired'))
      .toBe(false);
    expect(state.units.find((u) => u.characterId === 'wisp')!.statuses)
      .toEqual([{ kind: 'stealth', remaining: 1 }]);
  });

  it('so on the next Decision phase the enemy sees the decoy and NOT Wisp', () => {
    // This is the Dev Note, resolved. The decoy is still standing — it lives to
    // `castTurn + 1` — so the enemy is shown a Wisp-shaped thing in the square
    // Wisp *was* in, and the real Wisp is nowhere. That is the mind-game the
    // ability is for, and it did not work before this value changed.
    const { state } = castVeil(facing());
    const view = fogView(OPEN, state, 1);
    expect(view.units.map((u) => u.characterId)).not.toContain('wisp');
    expect(view.decoys).toHaveLength(1);
    expect(view.decoys[0]!.asEnemy).toBe(true);
  });

  it('…while its own team still sees the real unit', () => {
    const { state } = castVeil(facing());
    const view = fogView(OPEN, state, 0);
    expect(view.units.map((u) => u.characterId)).toContain('wisp');
    expect(view.decoys[0]!.asEnemy).toBe(false);
  });

  it('the roster value is the whole of the fix, and it is one number', () => {
    // Named explicitly rather than left implicit in behaviour: if this value is
    // ever walked back to 1, the three assertions above are the ones that go
    // with it, and this line says so in one place.
    const veil = WISP.abilities.find((a) => a.id === 'veil_decoy')!;
    expect(veil.effects.find((e) => e.kind === 'stealth')!.duration).toBe(2);
    expect(veil.free).toBe(true); // the free-action half was never the problem
  });

  it('the decoy is untouched, and outlives nothing it did not already outlive', () => {
    // The decoy's lifetime is `expiresOnTurn = castTurn + 1`, computed from the
    // turn counter — `spawnDecoy` never reads the effect's `duration`, so the
    // `1` sitting beside the stealth entry is dead data. Pinned so nobody
    // "aligns" it to 2 expecting a longer decoy.
    const veil = WISP.abilities.find((a) => a.id === 'veil_decoy')!;
    expect(veil.effects.find((e) => e.kind === 'decoy')!.duration).toBe(1);
    const s = facing();
    const { state } = castVeil(s);
    expect(state.decoys).toHaveLength(1);
    expect(state.decoys[0]!.expiresOnTurn).toBe(s.turn + 1);
  });
});
