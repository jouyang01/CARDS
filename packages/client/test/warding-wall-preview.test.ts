// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { aimBoundaries, boundaryContains } from '../src/aim-boundary.js';
import { abilityPreview, abilityTooltip, damageTell } from '../src/targeting.js';
import {
  OPEN_MAP, aimAndCommit, armAbility, layer, mountUI,
} from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import aegis from '../../../data/characters/aegis.json';
import vex from '../../../data/characters/vex.json';

/**
 * WARDING-WALL, the client half — the wall has to be **aimable and visible**,
 * not merely resolvable.
 *
 * A new `TargetShape` is the one kind of engine change that can ship green and
 * still be unreachable: the resolver knows what a `wall` covers, and if
 * `aimFor` does not know how to turn a click into one, the ability is a button
 * that does nothing. That is the KESTREL-CONE failure exactly, and the harness
 * exists because of it — so the first test below presses the real button on the
 * real controller rather than calling `expandShape` and calling it wired.
 *
 * The second thing worth its own test is the **outline**. AIM-PREVIEW-TRUE's
 * rule is that a tile lights iff its centre is inside the drawn boundary, for
 * every shape at every rotation; a shape added afterwards has to earn that
 * claim rather than inherit it. The congruence check here is the same one
 * `aim-boundary.test.ts` sweeps the rest of the roster with, pointed at the
 * wall's four cardinals.
 */

const AEGIS = aegis as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const WALL = AEGIS.abilities.find((a) => a.id === 'warding_wall')!;
const roster: Roster = buildRoster([AEGIS, VEX]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const unitAt = (pos: { x: number; y: number }) => ({
  unitId: 'u0', characterId: 'aegis', owner: 0 as const, pos: { ...pos }, hp: 120, maxHp: 120,
  energy: 0, alive: true, statuses: [], cooldowns: {}, ultUsed: false,
  catalysts: [], catalystsUsed: [],
} as never);

beforeEach(() => { document.body.replaceChildren(); });

describe('WARDING-WALL: the button actually places a wall', () => {
  it('arming it and clicking a square lights four tiles', () => {
    // The whole point of driving the controller: `aimFor` has to have a case for
    // `wall`, or the click produces an aim the ability refuses and the preview
    // is empty. Nothing below `startHotSeat` can tell you that.
    const ui = mountUI();
    const opening: GameState = createMatch(OPEN_MAP, '1v1', [[AEGIS], [VEX]]);
    const me = opening.units.find((u) => u.owner === 0)!;
    const foe = opening.units.find((u) => u.owner === 1)!;
    me.pos = { x: 10, y: 10 };
    foe.pos = { x: 16, y: 10 };
    startHotSeat(ui.ui, OPEN_MAP, roster, [[AEGIS], [VEX]], '1v1', [1, 1], POOL, undefined,
      undefined, opening);

    armAbility(ui.controls, WALL.name);
    aimAndCommit(ui.board, { x: 13, y: 10 });

    const lit = layer(ui.renderer, 'aim');
    expect(lit, 'four tiles under the aim').toHaveLength(4);
    // Laid across the caster's line east, so it is a north–south column at x=13.
    expect(new Set(lit.map((p) => p.x))).toEqual(new Set([13]));
    expect(lit.map((p) => p.y).sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
  });

  it('and the caster\'s own square is not one of them', () => {
    const ui = mountUI();
    const opening: GameState = createMatch(OPEN_MAP, '1v1', [[AEGIS], [VEX]]);
    const me = opening.units.find((u) => u.owner === 0)!;
    me.pos = { x: 10, y: 10 };
    opening.units.find((u) => u.owner === 1)!.pos = { x: 16, y: 10 };
    startHotSeat(ui.ui, OPEN_MAP, roster, [[AEGIS], [VEX]], '1v1', [1, 1], POOL, undefined,
      undefined, opening);
    armAbility(ui.controls, WALL.name);
    aimAndCommit(ui.board, { x: 12, y: 10 });
    expect(layer(ui.renderer, 'aim').map((p) => `${p.x},${p.y}`)).not.toContain('10,10');
  });
});

describe('WARDING-WALL: the outline is the tiles, at every rotation', () => {
  // AIM-PREVIEW-TRUE's congruence claim, for the new shape: a tile is lit iff
  // its centre is inside the drawn boundary. Swept over the four cardinals the
  // wall can face, because that is its whole rotation space — `dominantCardinal`
  // snaps the facing, so there is nothing between them to check.
  const CARDINALS = [
    { name: 'east', at: { x: 14, y: 10 } },
    { name: 'west', at: { x: 6, y: 10 } },
    { name: 'north', at: { x: 10, y: 6 } },
    { name: 'south', at: { x: 10, y: 14 } },
  ];

  it.each(CARDINALS)('facing $name: every lit tile is inside the outline', ({ at }) => {
    const me = unitAt({ x: 10, y: 10 });
    const lit = abilityPreview(OPEN_MAP, me, WALL, [at]);
    const [outline] = aimBoundaries(me, WALL, [at], undefined, lit);
    expect(outline, 'the wall draws one').toBeDefined();
    expect(lit.length, 'and there are tiles to check').toBeGreaterThan(0);
    for (const p of lit) {
      expect(boundaryContains(outline!, p), `lit tile ${p.x},${p.y} inside`).toBe(true);
    }
  });

  it.each(CARDINALS)('facing $name: nothing outside the wall is inside it', ({ at }) => {
    // The other direction, which is the half that catches an outline drawn one
    // tile off: sweep the neighbourhood and check that every tile the engine did
    // NOT light falls outside the drawn figure.
    const me = unitAt({ x: 10, y: 10 });
    const lit = new Set(abilityPreview(OPEN_MAP, me, WALL, [at]).map((p) => `${p.x},${p.y}`));
    const [outline] = aimBoundaries(me, WALL, [at], undefined, [...lit].map((k) => {
      const [x, y] = k.split(',');
      return { x: Number(x), y: Number(y) };
    }));
    for (let y = at.y - 4; y <= at.y + 4; y++) {
      for (let x = at.x - 4; x <= at.x + 4; x++) {
        if (lit.has(`${x},${y}`)) continue;
        expect(boundaryContains(outline!, { x, y }), `unlit tile ${x},${y} outside`).toBe(false);
      }
    }
  });
});

describe('WARDING-WALL: the tell says wall, not mine', () => {
  it('names the damage and the length', () => {
    // "25 mine" reads as one tile somewhere, which undersells a four-tile
    // barrier by a factor of four. Driven off `perTile`, the same field that
    // decides how many traps go down, so the two cannot drift.
    const tell = damageTell(WALL);
    expect(tell).toContain('25');
    expect(tell).toMatch(/wall/i);
    expect(tell, 'and not the mine wording').not.toMatch(/mine/i);
    expect(tell).toContain('4 tiles');
  });

  it('an ordinary mine still reads as a mine', () => {
    const trap = VEX.abilities.find((a) => a.id === 'overwatch_trap')!;
    expect(damageTell(trap)).toMatch(/mine/i);
  });

  it('the tooltip says which phase and shape it is', () => {
    // A Prep ability where a Blast used to be is the kind of change a player
    // discovers by losing a turn, so the panel had better say so.
    const lines = abilityTooltip(WALL).join('\n');
    expect(lines).toContain('prep');
    expect(lines).toContain('wall');
  });
});
