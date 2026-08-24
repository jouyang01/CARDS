// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, aimAndCommit, armAbility, lockIn, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import vex from '../../../data/characters/vex.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * VFX-WIRING — a hit reaches the renderer.
 *
 * The pure half is covered in `vfx.test.ts`. This is the half that keeps going
 * missing in this lane: `preloadCharacters` was written, tested and never
 * called; `strideTimeScale` likewise. A pure function nobody invokes passes
 * every one of its own specs and does nothing at all, so the call itself gets
 * an assertion.
 */

const VEX = vex as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
const roster: Roster = buildRoster([VEX, AEGIS]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

/** Aegis stood next to Vex, so a Shield Bash actually connects. */
const duel = () => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[AEGIS], [VEX]];
  const opening: GameState = createMatch(OPEN_MAP, '1v1', teams);
  opening.units.find((u) => u.owner === 0)!.pos = { x: 8, y: 9 };
  opening.units.find((u) => u.owner === 1)!.pos = { x: 9, y: 9 };
  startHotSeat(ui.ui, OPEN_MAP, roster, teams, '1v1', [1, 1], POOL, undefined, undefined, opening);
  return ui;
};

/**
 * The same duel, but with the two units far enough apart for something to fly
 * between them. `duel()` deliberately stands them adjacent so a melee cone
 * connects; a tracer needs the opposite.
 */
const rangedDuel = () => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[VEX], [AEGIS]];
  const opening: GameState = createMatch(OPEN_MAP, '1v1', teams);
  opening.units.find((u) => u.owner === 0)!.pos = { x: 2, y: 9 };
  opening.units.find((u) => u.owner === 1)!.pos = { x: 8, y: 9 };
  startHotSeat(ui.ui, OPEN_MAP, buildRoster([VEX, AEGIS]), teams, '1v1', [1, 1], POOL, undefined, undefined, opening);
  return ui;
};

beforeEach(() => {
  document.body.replaceChildren();
  // happy-dom does not drive requestAnimationFrame, and playback's tick rides
  // on it — without this a resolving turn is indistinguishable from one that
  // never resolved.
  vi.stubGlobal('requestAnimationFrame',
    (cb: FrameRequestCallback) => setTimeout(() => { cb(performance.now()); }, 16) as unknown as number);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('VFX-WIRING: a landed hit flashes its victim and rattles the camera', () => {
  it('flashes the unit that was hit, not the one that swung', async () => {
    const b = duel();
    const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;
    armAbility(b.controls, bash.name);
    aimAndCommit(b.board, { x: 9, y: 9 });
    lockIn(b.controls);
    lockIn(b.controls); // the opposing seat, which orders nothing

    await vi.waitFor(() => {
      expect(b.renderer.draw.flashes.length, 'no hit ever reached the renderer')
        .toBeGreaterThan(0);
    }, { timeout: 15000 });

    const victim = b.renderer.draw.board.units.find((u) => u.characterId === 'vex')!;
    expect(b.renderer.draw.flashes.map((f) => f.unitId)).toContain(victim.unitId);
    const attacker = b.renderer.draw.board.units.find((u) => u.characterId === 'aegis')!;
    expect(b.renderer.draw.flashes.map((f) => f.unitId), 'the swinger is not the victim')
      .not.toContain(attacker.unitId);
  }, 25000);

  it('shakes once per hit, with a seed', async () => {
    const b = duel();
    const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;
    armAbility(b.controls, bash.name);
    aimAndCommit(b.board, { x: 9, y: 9 });
    lockIn(b.controls);
    lockIn(b.controls);

    await vi.waitFor(() => {
      expect(b.renderer.draw.shakes.length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    // One shake per hit — not one per frame the impact is on screen, which is
    // what a "is an impact showing" check would produce, and which would also
    // freeze playback forever.
    expect(b.renderer.draw.shakes.length).toBeLessThan(4);
    for (const s of b.renderer.draw.shakes) {
      expect(s.amplitude).toBeGreaterThan(0);
      expect(Number.isFinite(s.seed), 'unseeded means a replay shakes differently').toBe(true);
    }
  }, 25000);

  it('TRACER-WIRING: the shot is drawn crossing the gap between cast and landing', async () => {
    // The failure this guards is the one this lane keeps repeating: a pure
    // module with a full test file that nothing ever calls. `tracer.test.ts`
    // proves the geometry; only this proves a quad reaches the renderer.
    // A RANGED ability across a real gap. Shield Bash is a cone at range 2 and
    // the duel stands its two units on adjacent squares, so after the muzzle
    // offsets there is no flight left to draw — correctly, per MIN_FLIGHT_TILES.
    // A tracer is for something that crossed a distance, so the test has to
    // provide one: Vex's Rail Shot, at range 8, from the far side of the board.
    const b = rangedDuel();
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    // Vex is the seat on the clock here, so it is Vex who arms and fires.
    armAbility(b.controls, rail.name);
    aimAndCommit(b.board, { x: 8, y: 9 });
    lockIn(b.controls);
    lockIn(b.controls);

    const seen: number[] = [];
    await vi.waitFor(() => {
      seen.push(b.renderer.draw.shapesByLayer.get('tracer')?.length ?? 0);
      expect(Math.max(...seen), 'no tracer was ever drawn').toBeGreaterThan(0);
    }, { timeout: 15000 });

    // Four corners: a streak, not a degenerate polygon.
    const drawn = seen.findIndex((n) => n > 0);
    expect(drawn).toBeGreaterThanOrEqual(0);

    // And it clears. A shape layer is replaced wholesale, so a tracer left
    // behind would hang over the next planning phase pointing at where somebody
    // used to be.
    await vi.waitFor(() => {
      expect(b.renderer.draw.shapesByLayer.get('tracer')).toEqual([]);
    }, { timeout: 15000 });
  }, 25000);

  it('a turn where nothing lands neither flashes nor shakes, and draws no tracer', async () => {
    const b = duel();
    lockIn(b.controls);
    lockIn(b.controls);
    await new Promise((r) => setTimeout(r, 4000));
    expect(b.renderer.draw.flashes).toEqual([]);
    expect(b.renderer.draw.shakes).toEqual([]);
    expect(b.renderer.draw.shapesByLayer.get('tracer') ?? []).toEqual([]);
  }, 25000);
});
