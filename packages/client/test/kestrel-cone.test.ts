// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildRoster, createMatch, resolveTurn, validateAbility,
  type CharacterDef, type GameState, type Roster, type UnitOrders, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, aimAt, click, mountUI, recordingNet, type StubRenderer } from './app-harness.js';
import kestrel from '../../../data/characters/kestrel.json';
import vex from '../../../data/characters/vex.json';

/**
 * KESTREL-CONE — "Kestrel's auto attack is not working as a cone at all, it's
 * just a line."
 *
 * The data was right and every pure function was right: `abilityProfile` merges
 * the Spread profile correctly, `modeOptions` offers both, `draftAbility` picks
 * the armed one, `toUnitOrders` sends the index. What nobody could test was the
 * **wiring** — `startHotSeat` builds a `WebGLRenderer` eagerly, so the file that
 * connects the HUD button to the draft to the preview to the order had no test
 * at all. This file is that test, through a renderer stub (`app-harness.ts`).
 *
 * The root cause, reproduced in the last block below: **the highlighted mode was
 * lying.** `modeOptions` marks `chosen ?? DEFAULT_MODE` — index 0 — as live, and
 * an order with no `mode` resolves the ability's **own** profile. Kestrel shipped
 * with Spread (cone 2) at index 0 against a line-6 base, so the HUD lit up
 * "Spread" while the untouched toggle previewed and resolved a **line 6**. A
 * player who never pressed anything saw a cone named and a line drawn.
 *
 * MODE-BASE-INVARIANT (shipped 2026-09-18) is the fix: `modes[0]` must equal the
 * ability's own shape and range, so the default highlight and the default
 * resolution are the same thing by construction, and `validateAbility` refuses
 * content where they are not. Twin Bolts was reordered to Focus, Spread. These
 * tests hold that fix to the symptom it was supposed to cure.
 */

const KESTREL = kestrel as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const TWIN = KESTREL.abilities.find((a) => a.id === 'twin_bolts')!;
const roster: Roster = buildRoster([KESTREL, VEX]);

/** Squares as a sorted key list — footprints are sets, not sequences. */
const keys = (squares: readonly Vec2[] | undefined): string[] =>
  [...(squares ?? [])].map((p) => `${p.x},${p.y}`).sort();

/**
 * The real controller, networked so the orders it builds are a value a test can
 * hold: the hot-seat resolves its own turn and never hands the `UnitOrders` out.
 */
const board = () => {
  const ui = mountUI();
  const opening: GameState = createMatch(OPEN_MAP, '1v1', [[KESTREL], [VEX]]);
  const me = opening.units.find((u) => u.owner === 0)!;
  const foe = opening.units.find((u) => u.owner === 1)!;
  me.pos = { x: 5, y: 10 };
  foe.pos = { x: 7, y: 10 }; // two east: inside the cone, and on the line
  const wire = recordingNet('s0', 0, [me.unitId]);
  startHotSeat(ui.ui, OPEN_MAP, roster, [[KESTREL], [VEX]], '1v1', [1, 1], {}, undefined, wire.net, opening);
  return { ...ui, opening, me, foe, ...wire };
};

const modeButtons = (controls: HTMLElement): HTMLButtonElement[] =>
  [...controls.querySelectorAll<HTMLButtonElement>('.hud-mode')];
const armTwinBolts = (controls: HTMLElement): void => {
  click([...controls.querySelectorAll('.hud-ability')]
    .find((n) => (n.textContent ?? '').includes(TWIN.name)));
};
const pickMode = (controls: HTMLElement, label: string): void => {
  click(modeButtons(controls).find((n) => n.textContent === label));
};
/** Aim down the row and lock in — the two gestures a turn is made of. */
const fireEast = (b: ReturnType<typeof board>): void => {
  aimAt(b.board, { x: 9, y: 10 }, 'mousemove');
  aimAt(b.board, { x: 9, y: 10 }, 'click');
  click([...b.controls.querySelectorAll('.hud-lock')][0]);
};
/** What the engine actually covers, given the order the client sent. */
const resolvedArea = (opening: GameState, orders: UnitOrders[], chars: CharacterDef[] = [KESTREL, VEX]): Vec2[] => {
  const { events } = resolveTurn(opening, OPEN_MAP, [
    { team: 0, units: orders }, { team: 1, units: [] },
  ], buildRoster(chars));
  const fired = events.find((e) => e.type === 'abilityFired');
  return fired !== undefined && fired.type === 'abilityFired' ? [...fired.area] : [];
};
/** The tiles the player is looking at: the renderer's own `aim` layer. */
const previewed = (renderer: StubRenderer): Vec2[] => renderer.draw.highlights.get('aim') ?? [];

beforeEach(() => { document.body.replaceChildren(); });

describe('KESTREL-CONE: the toggle is reachable, and it is honest', () => {
  it('arming Twin Bolts puts both profiles on screen, named', () => {
    // "The mode toggle is reachable in the HUD" — asserted against the real
    // controller's own DOM rather than against `modeOptions`.
    const b = board();
    expect(modeButtons(b.controls), 'no toggle before an ability is armed').toHaveLength(0);
    armTwinBolts(b.controls);
    expect(modeButtons(b.controls).map((n) => n.textContent)).toEqual(['Focus', 'Spread']);
    expect(b.controls.querySelector<HTMLElement>('.hud-modes')!.style.display).not.toBe('none');
  });

  it('and the one it highlights is the one an untouched turn fires', () => {
    // The heart of the bug: the highlight and the default resolution have to be
    // the same profile. Nothing is clicked on the toggle here.
    const b = board();
    armTwinBolts(b.controls);
    expect(modeButtons(b.controls).find((n) => n.classList.contains('sel'))?.textContent).toBe('Focus');

    fireEast(b);
    const area = resolvedArea(b.opening, b.submitted[0]!);
    expect(keys(area), 'a line 6, which is what Focus says').toEqual(
      keys([6, 7, 8, 9, 10, 11].map((x) => ({ x, y: 10 }))),
    );
  });
});

describe('KESTREL-CONE: Spread resolves and previews as a cone', () => {
  it('picking Spread draws a cone, not a line', () => {
    const b = board();
    armTwinBolts(b.controls);
    pickMode(b.controls, 'Spread');
    aimAt(b.board, { x: 9, y: 10 }, 'mousemove');

    const cells = previewed(b.renderer);
    expect(cells.length, 'wider than a line').toBeGreaterThan(0);
    // A cone at range 2 is bounded in depth and spreads across the axis — the
    // two properties that distinguish it from the line it was drawing.
    expect(Math.max(...cells.map((p) => p.x)), 'depth is the mode\'s range, not the base\'s').toBe(7);
    expect(new Set(cells.map((p) => p.y)).size, 'and it fans out').toBeGreaterThan(1);
  });

  it('the order carries mode 1, so the server resolves what was drawn', () => {
    const b = board();
    armTwinBolts(b.controls);
    pickMode(b.controls, 'Spread');
    fireEast(b);

    expect(b.submitted).toHaveLength(1);
    expect(b.submitted[0]![0]!.ability).toMatchObject({ abilityId: 'twin_bolts', mode: 1 });
  });

  it('and the drawn footprint IS the resolved footprint', () => {
    // The claim a preview exists to make. Compared as sets against the engine's
    // own `abilityFired` area, so a client that drew its own idea of a cone
    // would fail here even if both looked cone-shaped.
    const b = board();
    armTwinBolts(b.controls);
    pickMode(b.controls, 'Spread');
    aimAt(b.board, { x: 9, y: 10 }, 'mousemove');
    const drawn = previewed(b.renderer);
    aimAt(b.board, { x: 9, y: 10 }, 'click');
    click([...b.controls.querySelectorAll('.hud-lock')][0]);

    expect(keys(resolvedArea(b.opening, b.submitted[0]!))).toEqual(keys(drawn));
  });

  it('the cone actually hits the enemy standing in it', () => {
    // The end of the sentence: not just a shape, damage on a unit.
    const b = board();
    armTwinBolts(b.controls);
    pickMode(b.controls, 'Spread');
    fireEast(b);
    const { state } = resolveTurn(b.opening, OPEN_MAP, [
      { team: 0, units: b.submitted[0]! }, { team: 1, units: [] },
    ], roster);
    expect(state.units.find((u) => u.owner === 1)!.hp).toBe(VEX.maxHp - 24);
  });

  it('and Focus is still a line 6 when you switch back', () => {
    // The toggle is a toggle, not a one-way door.
    const b = board();
    armTwinBolts(b.controls);
    pickMode(b.controls, 'Spread');
    pickMode(b.controls, 'Focus');
    fireEast(b);
    expect(b.submitted[0]![0]!.ability).toMatchObject({ mode: 0 });
    expect(keys(resolvedArea(b.opening, b.submitted[0]!))).toEqual(
      keys([6, 7, 8, 9, 10, 11].map((x) => ({ x, y: 10 }))),
    );
  });
});

describe('KESTREL-CONE: the root cause, and the guard that closed it', () => {
  /** Kestrel as she shipped **before** MODE-BASE-INVARIANT: Spread at index 0. */
  const preSwap = (): CharacterDef => {
    const def = structuredClone(KESTREL);
    def.abilities[0]!.modes = [
      { name: 'Spread', shape: 'cone', range: 2 },
      { name: 'Focus', shape: 'line', range: 6 },
    ];
    return def;
  };

  it('the old data made the HUD name a cone and fire a line', () => {
    // The reported bug, reproduced. Nothing is clicked on the toggle — which is
    // exactly the player's experience: it already said Spread.
    const old = preSwap();
    const ui = mountUI();
    const opening = createMatch(OPEN_MAP, '1v1', [[old], [VEX]]);
    opening.units.find((u) => u.owner === 0)!.pos = { x: 5, y: 10 };
    opening.units.find((u) => u.owner === 1)!.pos = { x: 9, y: 10 };
    const wire = recordingNet('s0', 0, [opening.units[0]!.unitId]);
    // The old roster, not the shipped one: the controller reads the kit from
    // what it is handed, so feeding it today's Kestrel would test today's fix.
    startHotSeat(ui.ui, OPEN_MAP, buildRoster([old, VEX]), [[old], [VEX]], '1v1', [1, 1],
      {}, undefined, wire.net, opening);

    armTwinBolts(ui.controls);
    expect(modeButtons(ui.controls).find((n) => n.classList.contains('sel'))?.textContent,
      'the HUD says Spread').toBe('Spread');

    aimAt(ui.board, { x: 9, y: 10 }, 'mousemove');
    aimAt(ui.board, { x: 9, y: 10 }, 'click');
    click([...ui.controls.querySelectorAll('.hud-lock')][0]);
    expect(keys(resolvedArea(opening, wire.submitted[0]!, [old, VEX])),
      'and the board draws a line').toEqual(keys([6, 7, 8, 9, 10, 11].map((x) => ({ x, y: 10 }))));
  });

  it('and that data no longer validates, so it cannot come back', () => {
    const errs = validateAbility(preSwap().abilities[0]!, 'kestrel.twin_bolts').join(' ');
    expect(errs).toMatch(/modes\[0\] shape "cone" must match the ability's own "line"/);
  });

  it('the shipped Twin Bolts passes, with Focus as its base profile', () => {
    expect(validateAbility(TWIN, 'kestrel.twin_bolts')).toEqual([]);
    expect(TWIN.modes?.[0]).toMatchObject({ name: 'Focus', shape: TWIN.shape, range: TWIN.range });
  });
});
