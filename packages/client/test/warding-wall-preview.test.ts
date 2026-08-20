// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  WALL_ROTATIONS, buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { aimBoundaries, boundaryContains } from '../src/aim-boundary.js';
import { abilityPreview, abilityTooltip, damageTell, rotationOptions } from '../src/targeting.js';
import {
  OPEN_MAP, aimAndCommit, armAbility, click, layer, mountUI,
} from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import aegis from '../../../data/characters/aegis.json';
import vex from '../../../data/characters/vex.json';

/**
 * WARDING-WALL / WALL-ROTATE, the client half — the wall has to be **aimable and
 * visible**, not merely resolvable.
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

/** Aegis at (10,10) with the wall armed, on the real controller. */
const armed = () => {
  const ui = mountUI();
  const opening: GameState = createMatch(OPEN_MAP, '1v1', [[AEGIS], [VEX]]);
  const me = opening.units.find((u) => u.owner === 0)!;
  const foe = opening.units.find((u) => u.owner === 1)!;
  me.pos = { x: 10, y: 10 };
  foe.pos = { x: 16, y: 10 };
  startHotSeat(ui.ui, OPEN_MAP, roster, [[AEGIS], [VEX]], '1v1', [1, 1], POOL, undefined,
    undefined, opening);
  armAbility(ui.controls, WALL.name);
  return ui;
};

const rotateButtons = (controls: HTMLElement): HTMLButtonElement[] =>
  [...controls.querySelectorAll<HTMLButtonElement>('.hud-rotate')];

const litKeys = (ui: ReturnType<typeof armed>): string[] =>
  layer(ui.renderer, 'aim').map((p) => `${p.x},${p.y}`);

describe('WARDING-WALL: the button actually places a wall', () => {
  it('arming it and clicking a square lights four tiles', () => {
    // The whole point of driving the controller: `aimFor` has to have a case for
    // `wall` **and** supply a rotation, or the click produces an aim the ability
    // refuses and the preview is empty. Nothing below `startHotSeat` can tell
    // you that — and WALL-ROTATE made the aim two-part, which is exactly the
    // kind of change that compiles and leaves a dead button.
    const ui = armed();
    aimAndCommit(ui.board, { x: 13, y: 10 });
    expect(layer(ui.renderer, 'aim'), 'four tiles under the aim').toHaveLength(4);
    expect(litKeys(ui), 'anchored on the clicked square').toContain('13,10');
  });

  it('with no rotation touched it still previews — the default is east', () => {
    // A wall that showed nothing until you found a control you did not know
    // existed would read as a broken ability, so `aimFor` defaults to the first
    // of `WALL_ROTATIONS` rather than to "no direction".
    const ui = armed();
    aimAndCommit(ui.board, { x: 12, y: 10 });
    expect(litKeys(ui)).toEqual(['12,10', '13,10', '14,10', '15,10']);
  });
});

describe('WALL-ROTATE: four buttons, four walls', () => {
  it('the rotate row appears only while the wall is armed', () => {
    const ui = armed();
    expect(rotateButtons(ui.controls), 'four cardinals').toHaveLength(4);
    // …and an ability that is not placed-and-rotated offers none.
    const bash = AEGIS.abilities.find((a) => a.id === 'shield_bash')!;
    expect(rotationOptions(bash, undefined), 'a cone is dragged, not rotated').toEqual([]);
    expect(rotationOptions(undefined, undefined)).toEqual([]);
  });

  it('pressing a rotation turns the wall in place, keeping the anchor', () => {
    // The gesture the owner asked for: *"placed on a tile and then rotated in 4
    // directions"*. Place it once, then turn it — the clicked square stays put
    // and the arm swings around it.
    const ui = armed();
    aimAndCommit(ui.board, { x: 12, y: 10 });
    expect(litKeys(ui)).toEqual(['12,10', '13,10', '14,10', '15,10']);

    click(rotateButtons(ui.controls)[1]); // south
    aimAndCommit(ui.board, { x: 12, y: 10 });
    expect(litKeys(ui)).toEqual(['12,10', '12,11', '12,12', '12,13']);

    click(rotateButtons(ui.controls)[3]); // north
    aimAndCommit(ui.board, { x: 12, y: 10 });
    expect(litKeys(ui)).toEqual(['12,10', '12,9', '12,8', '12,7']);
  });

  it('all four give genuinely different walls', () => {
    // The reason the shape is anchored rather than centred: four buttons that
    // produced two walls and a one-tile nudge would be a rotate control that
    // visibly does nothing half the time.
    const ui = armed();
    const seen = new Set<string>();
    for (const btn of rotateButtons(ui.controls)) {
      click(btn);
      aimAndCommit(ui.board, { x: 12, y: 10 });
      seen.add(litKeys(ui).join(' '));
    }
    expect(seen.size).toBe(4);
  });

  it('the pressed rotation is the one marked selected', () => {
    const ui = armed();
    click(rotateButtons(ui.controls)[2]); // west
    const marked = rotateButtons(ui.controls).filter((b) => b.classList.contains('sel'));
    expect(marked, 'exactly one').toHaveLength(1);
    expect(marked[0]!.dataset['rotation']).toBe(String(WALL_ROTATIONS[2]));
  });

  it('and rotating does not throw the placement away', () => {
    // `selectMode` clears the aim, because a mode change makes the old target
    // meaningless. A rotation is a change *to* an aim about a square the player
    // has already picked, so clearing it would make "turn the wall" mean "put
    // the wall away and start again".
    const ui = armed();
    aimAndCommit(ui.board, { x: 12, y: 10 });
    click(rotateButtons(ui.controls)[1]);
    expect(layer(ui.renderer, 'aim'), 'still a wall on the board').toHaveLength(4);
    expect(litKeys(ui), 'still anchored where it was placed').toContain('12,10');
  });
});

describe('WARDING-WALL: the outline is the tiles, at every rotation', () => {
  // AIM-PREVIEW-TRUE's congruence claim, for the new shape: a tile is lit iff
  // its centre is inside the drawn boundary. Swept over the four cardinals the
  // wall can face, because that is its whole rotation space — `dominantCardinal`
  // snaps the facing, so there is nothing between them to check.
  const CARDINALS = [
    { name: 'east', step: WALL_ROTATIONS[0]!, at: { x: 12, y: 10 } },
    { name: 'south', step: WALL_ROTATIONS[1]!, at: { x: 12, y: 10 } },
    { name: 'west', step: WALL_ROTATIONS[2]!, at: { x: 12, y: 10 } },
    { name: 'north', step: WALL_ROTATIONS[3]!, at: { x: 12, y: 10 } },
  ];

  it.each(CARDINALS)('facing $name: every lit tile is inside the outline', ({ at, step }) => {
    const me = unitAt({ x: 10, y: 10 });
    const lit = abilityPreview(OPEN_MAP, me, WALL, [at], step);
    const [outline] = aimBoundaries(me, WALL, [at], step, lit);
    expect(outline, 'the wall draws one').toBeDefined();
    expect(lit.length, 'and there are tiles to check').toBeGreaterThan(0);
    for (const p of lit) {
      expect(boundaryContains(outline!, p), `lit tile ${p.x},${p.y} inside`).toBe(true);
    }
  });

  it.each(CARDINALS)('facing $name: nothing outside the wall is inside it', ({ at, step }) => {
    // The other direction, which is the half that catches an outline drawn one
    // tile off: sweep the neighbourhood and check that every tile the engine did
    // NOT light falls outside the drawn figure.
    const me = unitAt({ x: 10, y: 10 });
    const lit = new Set(abilityPreview(OPEN_MAP, me, WALL, [at], step).map((p) => `${p.x},${p.y}`));
    const [outline] = aimBoundaries(me, WALL, [at], step, [...lit].map((k) => {
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
