import { describe, expect, it } from 'vitest';
import {
  createMatch, resolveTurn,
  type CharacterDef, type GameState, type MapDef, type Roster, type UnitOrders,
} from '@cards/engine';
import { fogView } from '../src/fog.js';
import { initView, padViews, playEvents } from '../src/playback.js';
import { LAYER_LIFT, PAD_LIFT } from '../src/renderer3d.js';
import duelArena from '../../../data/maps/duel-arena.json';

/**
 * PADS-INDICATOR — pads are drawn, and the marker tells you whether the pad has
 * anything to give.
 *
 * PADS1 shipped the mechanic with no marker at all, so both maps carried squares
 * that silently buffed whoever wandered onto them. The fix is a pure derivation:
 * `padViews` reads `MapDef.powerups` and `GameState.powerups` and answers "is
 * this one armed", with no arithmetic of its own beyond the engine's.
 *
 * The interesting case is **timing during playback**. A pad taken in the Move
 * phase must go dark as it happens; reading `state.powerups` alone would leave
 * it lit through the entire animation and darken it a beat after the player
 * stopped watching.
 */

const ARENA = duelArena as unknown as MapDef;

const PADS: MapDef['powerups'] = [
  { x: 5, y: 5, type: 'health', firstTurn: 1, everyTurns: 3 },
  { x: 8, y: 5, type: 'might', firstTurn: 1, everyTurns: 2 },
  { x: 2, y: 8, type: 'energy', firstTurn: 4, everyTurns: 2 },
];
const OPEN: MapDef = {
  id: 't', name: 't', width: 13, height: 13, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 6 }], [{ x: 11, y: 6 }]],
  powerups: PADS,
};

const ability = (id: string, over: Partial<CharacterDef['abilities'][number]> = {}) => ({
  id, name: id, phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 0, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [ability('shot'), ability('hop', { phase: 'dash', shape: 'square', range: 4, effects: [{ kind: 'teleport' }] })],
  ultimate: ability('ult', { shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const match = (): GameState => createMatch(OPEN, '1v1', [[CHAR], [CHAR]]);
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[] = []) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);
const ME = 'test-char-t0-0';
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const padAt = (views: ReturnType<typeof padViews>, x: number, y: number) =>
  views.find((p) => p.pos.x === x && p.pos.y === y)!;

describe('PADS-INDICATOR: every pad on the map is drawn', () => {
  it('one view per authored pad, at its square and in its flavour', () => {
    const views = padViews(OPEN, match());
    expect(views).toHaveLength(PADS!.length);
    expect(padAt(views, 5, 5).type).toBe('health');
    expect(padAt(views, 8, 5).type).toBe('might');
    expect(padAt(views, 2, 8).type).toBe('energy');
  });

  it('a map with no pads draws none, rather than throwing', () => {
    const bare: MapDef = { ...OPEN, powerups: undefined };
    expect(padViews(bare, match())).toEqual([]);
  });

  it('both shipped maps produce a marker for every pad they carry', () => {
    // The bug this item closes was that the shipped maps had pads and the board
    // had nothing on it.
    const views = padViews(ARENA, createMatch(ARENA, '2v2', [[CHAR, CHAR], [CHAR, CHAR]]));
    expect(views.length).toBe(ARENA.powerups!.length);
    expect(views.length).toBeGreaterThan(0);
  });

  it('is public terrain — a pad deep in the fog is still drawn', () => {
    // Unlike a trap or a decoy, `padViews` takes no viewer and asks no fog
    // question. The energy pad at (2,8) is eleven squares from team 1's spawn —
    // well outside its sight — and it is on the board for them anyway: a pad is
    // a feature of the map, and hiding one would invent hidden information the
    // rules do not have.
    const s = { ...match(), turn: 4 }; // past its firstTurn, so "armed" is meaningful
    expect(
      fogView(OPEN, s, 1).fogged.some((p) => p.x === 2 && p.y === 8),
      "the square really is outside team 1's sight",
    ).toBe(true);
    expect(padAt(padViews(OPEN, s), 2, 8).armed).toBe(true);
  });
});

describe('PADS-INDICATOR: armed vs consumed', () => {
  it('a pad opens armed once its firstTurn arrives, and not before', () => {
    const s = match();
    expect(padAt(padViews(OPEN, s), 5, 5).armed, 'firstTurn 1, turn 1').toBe(true);
    expect(padAt(padViews(OPEN, s), 2, 8).armed, 'firstTurn 4, turn 1').toBe(false);
    expect(padAt(padViews(OPEN, { ...s, turn: 4 }), 2, 8).armed, 'turn 4').toBe(true);
  });

  it('goes dark when taken and lights up again exactly on its respawn turn', () => {
    // Might pad, everyTurns 2: taken on turn 1 → available again on turn 3.
    let s = match();
    unit(s, ME).pos = { x: 8, y: 5 };
    ({ state: s } = run(s, []));
    expect(padAt(padViews(OPEN, s), 8, 5).armed, 'just taken').toBe(false);

    ({ state: s } = run(s, []));
    expect(s.turn, 'turn 3 now').toBe(3);
    expect(padAt(padViews(OPEN, s), 8, 5).armed, 'back on its respawn turn').toBe(true);
  });

  it('one pad going dark leaves the others alone', () => {
    const s = match();
    unit(s, ME).pos = { x: 8, y: 5 };
    const { state } = run(s, []);
    expect(padAt(padViews(OPEN, state), 8, 5).armed).toBe(false);
    expect(padAt(padViews(OPEN, state), 5, 5).armed, 'untouched').toBe(true);
  });
});

describe('PADS-INDICATOR: it goes dark during the animation, not after it', () => {
  it('the `powerupTaken` event darkens the pad mid-playback', () => {
    // The timing case. Reading `state.powerups` alone would keep the marker lit
    // through the whole Move animation and darken it once the turn was over —
    // a beat after the only moment anybody was watching that square.
    const s = match();
    unit(s, ME).pos = { x: 4, y: 5 };
    const { events } = run(s, [{ unitId: ME, movePath: [{ x: 5, y: 5 }] }]);
    expect(events.some((e) => e.type === 'powerupTaken')).toBe(true);

    const view = playEvents(s, events);
    expect(view.takenPowerups.has('5,5')).toBe(true);
    // `s` is the PRE-turn state, so its own record still says armed — the fold
    // is the only thing that knows, which is exactly the gap being closed.
    expect(padAt(padViews(OPEN, s), 5, 5).armed, 'without the fold it stays lit').toBe(true);
    expect(padAt(padViews(OPEN, s, view.takenPowerups), 5, 5).armed, 'with it, dark').toBe(false);
  });

  it('an untouched turn folds no pads at all', () => {
    const s = match();
    expect(initView(s).takenPowerups.size).toBe(0);
    const { events } = run(s, []);
    expect(playEvents(s, events).takenPowerups.size).toBe(0);
  });
});

describe('PADS-INDICATOR: the marker sits where board state sits', () => {
  it('above the camo tile and below every planning overlay', () => {
    // A pad is terrain with a colour, not something you are aiming — the same
    // argument CAMO-REVEAL's red thicket makes. An AoE drawn over a pad must
    // still read on top, or the overlay is lying about what it covers.
    expect(PAD_LIFT, 'above the camo thicket').toBeGreaterThan(LAYER_LIFT.camo);
    for (const layer of ['range', 'reach', 'aim', 'impact', 'free', 'catalyst', 'chase', 'select'] as const) {
      expect(PAD_LIFT, `an overlay on the ${layer} layer must read over a pad`).toBeLessThan(LAYER_LIFT[layer]);
    }
  });
});

/**
 * PADS-LIGHTS — the respawn countdown, as four coloured lights.
 *
 * Owner Dev Note: *"Respawn Timer: 4 turns (tracked visually by four colored
 * lights on the spawning pad)."* A consumed pad went dark and said nothing
 * about *when*, so contesting one was guesswork. The lights make the respawn a
 * clock you can plan against — which is the only reason to put a pad on a timer
 * in the first place.
 */
describe('PADS-LIGHTS: a consumed pad counts itself back', () => {
  const PAD = { x: 3, y: 3, type: 'might' as const, firstTurn: 2, everyTurns: 4 };
  const MAP: MapDef = { ...OPEN, powerups: [PAD] };
  const withTurn = (turn: number, availableOnTurn?: number): GameState => ({
    ...match(), turn,
    powerups: availableOnTurn === undefined ? [] : [{ pos: { x: 3, y: 3 }, availableOnTurn }],
  });

  it('shows one light per turn remaining', () => {
    // Taken on turn 4 with everyTurns 4 → back on turn 8.
    for (const [turn, lit] of [[4, 4], [5, 3], [6, 2], [7, 1]] as const) {
      const [pad] = padViews(MAP, withTurn(turn, 8));
      expect(pad!.lights, `turn ${turn}`).toBe(lit);
      expect(pad!.armed).toBe(false);
    }
  });

  it('and none at all once it is live again', () => {
    // A live pad shows its glyph; a countdown on it would be a lie.
    const [pad] = padViews(MAP, withTurn(8, 8));
    expect(pad!.armed).toBe(true);
    expect(pad!.lights).toBe(0);
  });

  it('never more lights than the respawn is long', () => {
    // The owner asked for four lights because the timer is four turns. A pad
    // whose record somehow ran ahead must not sprout a fifth.
    const [pad] = padViews(MAP, withTurn(1, 99));
    expect(pad!.lights).toBeLessThanOrEqual(PAD.everyTurns);
  });

  it('a pad taken THIS turn shows the full countdown immediately', () => {
    // The record has not ticked yet at the moment of pickup, but the player is
    // watching the pad go out — that is exactly when the clock should appear.
    const [pad] = padViews(MAP, withTurn(4), new Set(['3,3']));
    expect(pad!.armed).toBe(false);
    expect(pad!.lights).toBe(PAD.everyTurns);
  });

  it('a pad still waiting for its first spawn shows no countdown', () => {
    // Turn 1, firstTurn 2: never taken, so counting down would read as
    // "somebody grabbed this" before the match had started.
    const [pad] = padViews(MAP, withTurn(1));
    expect(pad!.armed).toBe(false);
    expect(pad!.lights).toBe(0);
  });
});
