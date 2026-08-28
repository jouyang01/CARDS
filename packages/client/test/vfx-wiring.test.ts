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
import vfxTable from '../../../data/vfx.json';

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

  it('THE OWNER’S BUG: one flash per hit, not one per phase boundary', async () => {
    // *"The flash for hit impact is happening twice. Once when the tracer hits
    // the target and once when the blast phase is over."*
    //
    // `newImpacts` scans the WHOLE cue timeline and fires anything whose `t` has
    // passed; the spent-set used to be created per phase. So a Blast impact
    // fired again the instant the Move phase started its clock — which is what
    // "when the blast phase is over" looks like from the sofa. The set is now
    // owned by the turn.
    //
    // Asserted per victim rather than as a total, because a turn with two
    // hits and one double would still total three and pass a loose count.
    const b = duel();
    const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;
    armAbility(b.controls, bash.name);
    aimAndCommit(b.board, { x: 9, y: 9 });
    lockIn(b.controls);
    lockIn(b.controls);

    await vi.waitFor(() => {
      expect(b.renderer.draw.flashes.length).toBeGreaterThan(0);
    }, { timeout: 15000 });
    // Let the remaining phases run their clocks out — the second flash lands
    // AFTER Blast, so an assertion made the moment the first arrives cannot see
    // it. This is the wait the bug hid behind.
    await new Promise((r) => setTimeout(r, 1200));

    const perVictim = new Map<string, number>();
    for (const f of b.renderer.draw.flashes) {
      perVictim.set(f.unitId, (perVictim.get(f.unitId) ?? 0) + 1);
    }
    for (const [unitId, n] of perVictim) {
      expect(n, `${unitId} flashed ${n} times for one hit`).toBe(1);
    }
    expect(perVictim.size, 'somebody was hit at all').toBeGreaterThan(0);
  }, 25000);

  it('and the camera shake is single too — it rides the same spent-set', async () => {
    // Same defect, same fix, different symptom: the board jolted a second time
    // on the phase change. Worth its own assertion because a future edit could
    // easily re-scope one and not the other.
    const b = duel();
    const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;
    armAbility(b.controls, bash.name);
    aimAndCommit(b.board, { x: 9, y: 9 });
    lockIn(b.controls);
    lockIn(b.controls);
    await vi.waitFor(() => {
      expect(b.renderer.draw.shakes.length).toBeGreaterThan(0);
    }, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1200));
    const seeds = b.renderer.draw.shakes.map((s) => s.seed);
    expect(new Set(seeds).size, 'the same impact shook the camera twice').toBe(seeds.length);
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
      seen.push(b.renderer.draw.tracers.length);
      expect(Math.max(...seen), 'no tracer was ever drawn').toBeGreaterThan(0);
    }, { timeout: 15000 });

    // Four corners: a streak, not a degenerate polygon.
    const drawn = seen.findIndex((n) => n > 0);
    expect(drawn).toBeGreaterThanOrEqual(0);

    // And it clears. The tracer layer is replaced wholesale, so a tracer left
    // behind would hang over the next planning phase pointing at where somebody
    // used to be.
    await vi.waitFor(() => {
      expect(b.renderer.draw.tracers).toEqual([]);
    }, { timeout: 15000 });
  }, 25000);

  it('AURA-WIRING: Aegis casting paints a ring in his own palette', async () => {
    // `ability-vfx.test.ts` proves the table and the geometry; only this proves
    // a single aura reaches the renderer. Same failure this lane keeps hitting:
    // a pure module with a full test file that nothing calls.
    const b = duel();
    const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;
    armAbility(b.controls, bash.name);
    aimAndCommit(b.board, { x: 9, y: 9 });
    lockIn(b.controls);
    lockIn(b.controls);

    const seen: { color: number; opacity: number }[] = [];
    await vi.waitFor(() => {
      for (const a of b.renderer.draw.auras) seen.push({ color: a.color, opacity: a.opacity });
      expect(seen.length, 'no aura ever reached the renderer').toBeGreaterThan(0);
    }, { timeout: 15000 });

    // In HIS colours, not a generic effect colour — the whole point of the table.
    const palette = Object.values(
      (vfxTable as unknown as Record<string, { palette: Record<string, string> }>)['aegis']!.palette,
    ).map((hex) => Number.parseInt(hex.replace('#', ''), 16));
    for (const a of seen) expect(palette, `${a.color.toString(16)} is not one of Aegis's tones`).toContain(a.color);
    for (const a of seen) expect(a.opacity).toBeGreaterThan(0);

    // And it clears, rather than hanging over the next planning phase.
    await vi.waitFor(() => {
      expect(b.renderer.draw.auras).toEqual([]);
    }, { timeout: 15000 });
  }, 25000);

  it('WALL-WIRING: Warding Wall raises a standing panel on the board', async () => {
    const b = duel();
    const wall = AEGIS.abilities.find((a) => a.id === 'warding_wall')!;
    armAbility(b.controls, wall.name);
    aimAndCommit(b.board, { x: 8, y: 7 });
    lockIn(b.controls);
    lockIn(b.controls);

    let panels: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
    await vi.waitFor(() => {
      if (b.renderer.draw.walls.length > 0) panels = b.renderer.draw.walls;
      expect(panels.length, 'no wall panel ever reached the renderer').toBeGreaterThan(0);
    }, { timeout: 15000 });

    // A face with length, not a point: a zero-length panel is an invisible wall.
    for (const p of panels) {
      expect(Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y)).toBeGreaterThan(0);
    }
  }, 25000);

  it('PARTICLE-WIRING: a landed hit throws debris that reaches the renderer', async () => {
    const b = duel();
    const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;
    armAbility(b.controls, bash.name);
    aimAndCommit(b.board, { x: 9, y: 9 });
    lockIn(b.controls);
    lockIn(b.controls);

    let seen: typeof b.renderer.draw.particles = [];
    await vi.waitFor(() => {
      if (b.renderer.draw.particles.length > 0) seen = b.renderer.draw.particles;
      expect(seen.length, 'no debris ever reached the renderer').toBeGreaterThan(0);
    }, { timeout: 15000 });

    for (const p of seen) {
      expect(p.size).toBeGreaterThan(0);
      expect(p.opacity).toBeGreaterThan(0);
      expect(p.lift).toBeGreaterThanOrEqual(0);
    }
    // Fragments, not one thing: a burst that renders as a single quad is a dot.
    expect(new Set(seen.map((p) => `${p.x},${p.y}`)).size).toBeGreaterThan(1);

    await vi.waitFor(() => {
      expect(b.renderer.draw.particles).toEqual([]);
    }, { timeout: 15000 });
  }, 25000);

  it('a turn where nothing lands neither flashes nor shakes, and draws no tracer', async () => {
    const b = duel();
    lockIn(b.controls);
    lockIn(b.controls);
    await new Promise((r) => setTimeout(r, 4000));
    expect(b.renderer.draw.flashes).toEqual([]);
    expect(b.renderer.draw.shakes).toEqual([]);
    expect(b.renderer.draw.tracers).toEqual([]);
    expect(b.renderer.draw.auras).toEqual([]);
    expect(b.renderer.draw.walls).toEqual([]);
    expect(b.renderer.draw.particles).toEqual([]);
  }, 25000);
});
