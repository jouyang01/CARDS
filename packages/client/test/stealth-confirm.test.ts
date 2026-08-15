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
 * Two separable questions, and they have different answers.
 *
 * 1. **Does the render path honour Stealth?** Yes. A stealthed Wisp is absent
 *    from the enemy's `fogView` while its decoy is present and enemy-styled, and
 *    its own team still sees the real unit with a purple decoy beside it. That
 *    is the whole of what DECOY-RENDER + STATUS-AUDIT were supposed to buy, and
 *    it holds.
 *
 * 2. **Can a player ever observe it?** No — and that is the Dev Note. Veil &
 *    Decoy's Stealth is authored `duration: 1`, and GAME_SPEC §6 ticks durations
 *    at end of turn, so a Stealth applied in Prep is removed by that same turn's
 *    tick. The enemy's next look at the board is the following Decision phase,
 *    by which point it is gone. The status is real, correct, and over before
 *    anybody could see it.
 *
 * The second case is pinned below as a **regression test on the shipped roster
 * value**, not fixed here: the duration lives in `data/characters/wisp.json` and
 * balance is the Designer's. It fails the moment that value changes, which is
 * exactly when this should be re-read. See docs/DECISIONS.md 2026-08-29.
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

describe('but the shipped Veil & Decoy is over before anyone can look at it', () => {
  const castVeil = (s: GameState) => resolveTurn(
    s, OPEN,
    [{ team: 0, units: [{ unitId: wispId(s), freeAbility: { abilityId: 'veil_decoy', target: [] } }] },
      { team: 1, units: [] }],
    roster,
  );

  it('the Stealth lands during the turn', () => {
    const { events } = castVeil(facing());
    expect(events.some((e) => e.type === 'statusApplied' && e.status === 'stealth')).toBe(true);
  });

  it('…and the same turn\'s end-of-turn tick takes it away again', () => {
    // `duration: 1` covers exactly the turn it was cast (GAME_SPEC §6). For a
    // status whose whole job is to change what the ENEMY sees on their next
    // turn, that is one turn too short.
    const { state, events } = castVeil(facing());
    expect(events.some((e) => e.type === 'statusRemoved' && e.status === 'stealth' && e.reason === 'expired'))
      .toBe(true);
    expect(state.units.find((u) => u.characterId === 'wisp')!.statuses).toEqual([]);
  });

  it('so on the next Decision phase the enemy simply sees Wisp', () => {
    // This is the Dev Note, reproduced. The decoy is still standing — it lives
    // to `cast turn + 1` — so the enemy is shown a Wisp *and* a decoy in the
    // same place, which reads as the ability having done nothing.
    const { state } = castVeil(facing());
    const view = fogView(OPEN, state, 1);
    expect(view.units.map((u) => u.characterId)).toContain('wisp');
    expect(view.decoys).toHaveLength(1);
  });

  it('the roster value is the whole cause, and it is one number', () => {
    // Named explicitly so the finding is not buried in a behavioural assertion:
    // this is `data/characters/wisp.json`, which the Designer owns. When it
    // changes, the three tests above are the ones to re-read.
    const veil = WISP.abilities.find((a) => a.id === 'veil_decoy')!;
    expect(veil.effects.find((e) => e.kind === 'stealth')!.duration).toBe(1);
    expect(veil.free).toBe(true); // the free-action half does work (FREE-UI)
  });

  it('and with a longer duration the same cast hides Wisp — nothing else is wrong', () => {
    // The counterfactual, so the diagnosis is not a guess: hand the engine the
    // identical ability with `duration: 2` and the enemy stops seeing Wisp.
    const patched: CharacterDef = {
      ...WISP,
      abilities: WISP.abilities.map((a) => a.id !== 'veil_decoy' ? a : {
        ...a,
        effects: a.effects.map((e) => (e.kind === 'stealth' ? { ...e, duration: 2 } : e)),
      }),
    };
    const s = facing();
    const { state } = resolveTurn(
      s, OPEN,
      [{ team: 0, units: [{ unitId: wispId(s), freeAbility: { abilityId: 'veil_decoy', target: [] } }] },
        { team: 1, units: [] }],
      { wisp: patched, vex: VEX },
    );
    expect(state.units.find((u) => u.characterId === 'wisp')!.statuses)
      .toEqual([{ kind: 'stealth', remaining: 1 }]);
    expect(fogView(OPEN, state, 1).units.map((u) => u.characterId)).not.toContain('wisp');
  });
});
