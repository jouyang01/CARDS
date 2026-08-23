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

  it('a turn where nothing lands neither flashes nor shakes', async () => {
    const b = duel();
    lockIn(b.controls);
    lockIn(b.controls);
    await new Promise((r) => setTimeout(r, 4000));
    expect(b.renderer.draw.flashes).toEqual([]);
    expect(b.renderer.draw.shakes).toEqual([]);
  }, 25000);
});
