// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch, expandShape, buildBoard,
  type CatalystData, type CharacterDef, type GameState, type Roster, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { boundaryContains } from '../src/aim-boundary.js';
import { OPEN_MAP, aimAt, armAbility, mountUI, recordingNet, type StubRenderer } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import aegis from '../../../data/characters/aegis.json';
import bastion from '../../../data/characters/bastion.json';
import vex from '../../../data/characters/vex.json';

/**
 * AIM-PREVIEW-TRUE, the wiring half.
 *
 * `aim-boundary.test.ts` proves the derivation: the polygon it builds and the
 * tiles the engine lights are the same set. That says nothing about whether the
 * **controller** hands that polygon to the renderer — which is the standing
 * "pure function passes, wiring broken" gap, and exactly how the beam bug
 * survived so long: `beamCovers` shipped correct with BASIC-BEAM and the drawing
 * code simply never read `beamWidth`, so Aegis resolved a lane and drew a wedge
 * for three sessions with a green suite.
 *
 * So this arms real abilities through the real HUD and reads the shapes off the
 * recording renderer.
 */

const AEGIS = aegis as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const roster: Roster = buildRoster([AEGIS, BASTION, VEX]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);
const BOARD = buildBoard(OPEN_MAP);

/** One character against Vex, facing east across the middle of an open field. */
const board = (mine: CharacterDef) => {
  const ui = mountUI();
  const opening: GameState = createMatch(OPEN_MAP, '1v1', [[mine], [VEX]]);
  const me = opening.units.find((u) => u.owner === 0)!;
  const foe = opening.units.find((u) => u.owner === 1)!;
  me.pos = { x: 8, y: 10 };
  foe.pos = { x: 12, y: 10 };
  const wire = recordingNet('s0', 0, [me.unitId]);
  startHotSeat(ui.ui, OPEN_MAP, roster, [[mine], [VEX]], '1v1', [1, 1], POOL, undefined,
    wire.net, opening);
  return { ...ui, me };
};

/** Everything the controller asked the renderer to fill, this render. */
const shapes = (renderer: StubRenderer): Vec2[][] => renderer.draw.shapes;
const aimEast = (b: ReturnType<typeof board>): void => {
  aimAt(b.board, { x: 14, y: 10 }, 'mousemove');
};

beforeEach(() => { document.body.replaceChildren(); });

describe('AIM-PREVIEW-TRUE: the controller draws the boundary it computes', () => {
  it('arming nothing draws no shape at all', () => {
    const b = board(VEX);
    expect(shapes(b.renderer).filter((s) => s.length > 0)).toEqual([]);
  });

  it('Aegis Shield Bash reaches the renderer as a four-cornered LANE', () => {
    // Dev Note #2, end to end. Before this the controller called an outline
    // builder that had no `beamWidth` branch, so what arrived here was a
    // triangle — a wedge drawn over a lane's worth of lit tiles.
    const b = board(AEGIS);
    armAbility(b.controls, AEGIS.abilities.find((a) => a.id === 'shield_bash')!.name);
    aimEast(b);
    const drawn = shapes(b.renderer).filter((s) => s.length > 0);
    expect(drawn.length, 'one shape: a beam has no sub-band').toBe(1);
    expect(drawn[0], 'a rectangle, not a wedge').toHaveLength(4);
  });

  it('and the tiles it lights are exactly the tiles inside what it drew', () => {
    // The congruence claim, asserted against what actually reached the renderer
    // rather than against a freshly recomputed polygon.
    const b = board(AEGIS);
    const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;
    armAbility(b.controls, bash.name);
    aimEast(b);
    const poly = shapes(b.renderer).filter((s) => s.length > 0)[0]!;
    const lit = b.renderer.draw.highlights.get('aim') ?? [];
    expect(lit.length, 'something is lit').toBeGreaterThan(0);
    for (const p of lit) expect(boundaryContains(poly, p), `${p.x},${p.y} lit`).toBe(true);
    for (let dx = -2; dx <= 6; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const p = { x: b.me.pos.x + dx, y: b.me.pos.y + dy };
        if (dx === 0 && dy === 0) continue; // the caster's own tile is never hit
        const isLit = lit.some((q) => q.x === p.x && q.y === p.y);
        expect(boundaryContains(poly, p), `${p.x},${p.y} drawn vs lit`).toBe(isLit);
      }
    }
  });

  it('Bastion Crushing Slam draws its wedge AND its centre band', () => {
    // Dev Note #1. Two loci reach the renderer, on two layers, so which tiles
    // carry the +8 is drawn rather than inferred from a colour wash.
    const b = board(BASTION);
    armAbility(b.controls, BASTION.abilities.find((a) => a.id === 'crushing_slam')!.name);
    aimEast(b);
    const drawn = shapes(b.renderer).filter((s) => s.length > 0);
    expect(drawn.length, 'the wedge and the axis band').toBe(2);
    expect(drawn[0]!.length, 'the wedge carries corner arcs').toBeGreaterThan(20);
    expect(drawn[1], 'the band is a lane').toHaveLength(4);
  });

  it('the band it drew holds exactly the tiles the engine gives the bonus to', () => {
    const b = board(BASTION);
    const slam = BASTION.abilities.find((a) => a.id === 'crushing_slam')!;
    armAbility(b.controls, slam.name);
    aimEast(b);
    const band = shapes(b.renderer).filter((s) => s.length > 0)[1]!;
    const lit = b.renderer.draw.highlights.get('aim') ?? [];
    const bonus = b.renderer.draw.highlights.get('band') ?? [];
    expect(bonus.length, 'the engine says some tiles pay more').toBeGreaterThan(0);
    for (const p of lit) {
      const inBand = boundaryContains(band, p);
      const paysMore = bonus.some((q) => q.x === p.x && q.y === p.y);
      expect(inBand, `${p.x},${p.y}: drawn band vs engine band`).toBe(paysMore);
    }
  });

  it('a plain line draws one lane and no band', () => {
    const b = board(VEX);
    armAbility(b.controls, VEX.abilities.find((a) => a.id === 'rail_shot')!.name);
    aimEast(b);
    const drawn = shapes(b.renderer).filter((s) => s.length > 0);
    expect(drawn.length).toBe(1);
    expect(drawn[0]).toHaveLength(4);
  });

  it('a circle draws its disc and its core, at the aimed square', () => {
    const b = board(VEX);
    const grenade = VEX.abilities.find((a) => a.id === 'frag_grenade')!;
    armAbility(b.controls, grenade.name);
    const at = { x: 12, y: 10 };
    aimAt(b.board, at, 'mousemove');
    const drawn = shapes(b.renderer).filter((s) => s.length > 0);
    expect(drawn.length, 'no innerRadius on this one, so just the disc').toBe(1);
    // Centred on the aim, not on the caster — the disc travels with the target.
    const xs = drawn[0]!.map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(at.x, 1);
    const lit = expandShape(BOARD, grenade, b.me.pos, [at]);
    for (const p of lit) expect(boundaryContains(drawn[0]!, p), `${p.x},${p.y}`).toBe(true);
  });

  it('and it all goes away when the ability is cleared', () => {
    // The shapes are a live overlay: a boundary left behind would describe an
    // order that is no longer being planned.
    const b = board(AEGIS);
    armAbility(b.controls, AEGIS.abilities.find((a) => a.id === 'shield_bash')!.name);
    aimEast(b);
    expect(shapes(b.renderer).filter((s) => s.length > 0).length).toBeGreaterThan(0);
    b.renderer.draw.shapes.length = 0;
    const clear = [...b.controls.querySelectorAll<HTMLButtonElement>('.hud-move')]
      .find((n) => (n.textContent ?? '').startsWith('Clear'))!;
    clear.click();
    expect(shapes(b.renderer).filter((s) => s.length > 0)).toEqual([]);
  });
});

describe('AIM-PREVIEW-TRUE: a locked order keeps its shape on the board (AC #5)', () => {
  /** A 2v2 hot-seat where one seat runs both characters, so it can lock one. */
  const pair = () => {
    const ui = mountUI();
    const teams: [CharacterDef[], CharacterDef[]] = [[VEX, BASTION], [AEGIS, AEGIS]];
    const opening: GameState = createMatch(OPEN_MAP, '2v2', teams);
    opening.units.filter((u) => u.owner === 0).forEach((u, i) => { u.pos = { x: 8, y: 9 + i * 2 }; });
    opening.units.filter((u) => u.owner === 1).forEach((u, i) => { u.pos = { x: 13, y: 9 + i * 2 }; });
    // `[1, 1]` puts each team on ONE seat, so seat 0 orders both of its
    // characters — which is the case a locked plan is drawn for.
    startHotSeat(ui.ui, OPEN_MAP, buildRoster([VEX, BASTION, AEGIS]), teams, '2v2', [1, 1],
      POOL, undefined, undefined, opening);
    return ui;
  };

  const lockIn = (controls: HTMLElement): void => {
    (controls.querySelector('.hud-lockrow .hud-lock') as HTMLButtonElement).click();
  };

  it('nothing is locked at the start of a turn, so nothing is drawn for it', () => {
    const b = pair();
    expect(b.renderer.draw.highlights.get('locked') ?? []).toEqual([]);
  });

  it('locking one character draws its committed shape while the other is ordered', () => {
    // "Preview, confirmation and resolution all draw from one derivation." A
    // locked plan showed only as a badge over the unit's head until now, so a
    // player ordering their second character could not see the first's shot.
    const b = pair();
    armAbility(b.controls, VEX.abilities.find((a) => a.id === 'rail_shot')!.name);
    aimAt(b.board, { x: 14, y: 9 }, 'mousemove');
    aimAt(b.board, { x: 14, y: 9 }, 'click');
    lockIn(b.controls);

    const tiles = b.renderer.draw.highlights.get('locked') ?? [];
    expect(tiles.length, 'the locked plan still covers tiles').toBeGreaterThan(0);
    // …and its boundary is drawn from the same module, so the two agree.
    const drawn = b.renderer.draw.shapes.filter((s) => s.length > 0);
    expect(drawn.length, 'a shape for the locked order').toBeGreaterThan(0);
    for (const p of tiles) {
      expect(drawn.some((poly) => boundaryContains(poly, p)), `${p.x},${p.y}`).toBe(true);
    }
  });

  it('and it is the SAME derivation, not a second drawing of the same idea', () => {
    // The point of AC #5 is one derivation. The locked tiles must be exactly
    // what `expandShape` returns for that unit's committed aim — not a
    // re-approximation that happens to look similar.
    const b = pair();
    const rail = VEX.abilities.find((a) => a.id === 'rail_shot')!;
    const at: Vec2 = { x: 14, y: 9 };
    armAbility(b.controls, rail.name);
    aimAt(b.board, at, 'mousemove');
    aimAt(b.board, at, 'click');
    lockIn(b.controls);

    const drawnTiles = (b.renderer.draw.highlights.get('locked') ?? [])
      .map((p) => `${p.x},${p.y}`).sort();
    const fromEngine = expandShape(BOARD, rail, { x: 8, y: 9 }, [at])
      .map((p) => `${p.x},${p.y}`).sort();
    expect(fromEngine.length, 'the committed shot covers tiles').toBeGreaterThan(0);
    expect(drawnTiles).toEqual(fromEngine);
  });

  it('the enemy seat never sees it, however the hot-seat hands over', () => {
    // The hazard the filter exists for: `drafts` outlives the seat handover, so
    // an unfiltered read would show the previous seat's committed shot to the
    // player it is aimed at. Hidden information is team vs team.
    const b = pair();
    armAbility(b.controls, VEX.abilities.find((a) => a.id === 'rail_shot')!.name);
    aimAt(b.board, { x: 14, y: 9 }, 'mousemove');
    aimAt(b.board, { x: 14, y: 9 }, 'click');
    lockIn(b.controls); // Vex locked; Bastion is up, same seat
    expect((b.renderer.draw.highlights.get('locked') ?? []).length, 'a teammate sees it')
      .toBeGreaterThan(0);
    lockIn(b.controls); // Bastion locked; the device passes to team 1
    expect(b.status.textContent, 'the other side is on the clock').toContain('t1-p0');
    expect(b.renderer.draw.highlights.get('locked') ?? [], 'and sees nothing of it').toEqual([]);
  });
});
