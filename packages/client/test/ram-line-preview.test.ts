// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type Roster,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { impactPreview } from '../src/targeting.js';
import { OPEN_MAP, aimAt, armAbility, layer, mountUI } from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import bastion from '../../../data/characters/bastion.json';
import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';

/**
 * BASTION-RAM-LINE, the client half — *"the preview should be like a line
 * attack that also shows the ending dash location."*
 *
 * Half of that was already true and half was invisible. A charge's route has
 * always been drawn: the crossed tiles light on the aim layer and a yellow line
 * runs along them. What was missing is the **end** — every tile of the route
 * looked identical, including the one square the player is actually choosing
 * between, because `impactPreview` only reported a landing for a dash carrying
 * an `impact` disc. Ram Charge has no disc, so it had no arrival.
 *
 * So the landing is now reported for every dash and drawn on the impact layer
 * for a charge: the aim layer says where the dash *goes*, the impact layer says
 * what the arrival *is*, which is the split that layer already existed for.
 *
 * Driven through the real controller, because "does the hover reach the
 * preview" is the one question a unit test of `impactPreview` cannot ask.
 */

const BASTION = bastion as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const RAM = BASTION.abilities.find((a) => a.id === 'ram_charge')!;
const roster: Roster = buildRoster([BASTION, VEX]);
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

/** Bastion at (8,10) on the open harness map, hovering a charge east. */
const charging = () => {
  const ui = mountUI();
  const opening: GameState = createMatch(OPEN_MAP, '1v1', [[BASTION], [VEX]]);
  const me = opening.units.find((u) => u.owner === 0)!;
  const foe = opening.units.find((u) => u.owner === 1)!;
  me.pos = { x: 8, y: 10 };
  foe.pos = { x: 16, y: 10 };
  startHotSeat(ui.ui, OPEN_MAP, roster, [[BASTION], [VEX]], '1v1', [1, 1], POOL, undefined,
    undefined, opening);
  armAbility(ui.controls, RAM.name);
  return { ...ui, me, foe };
};

const keys = (squares: readonly { x: number; y: number }[]): string[] =>
  squares.map((p) => `${p.x},${p.y}`);

beforeEach(() => { document.body.replaceChildren(); });

describe('BASTION-RAM-LINE: the charge previews as a line', () => {
  it('hovering four east lights the whole run, not just the target', () => {
    const b = charging();
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    const lit = layer(b.renderer, 'aim');
    expect(lit.length, 'a run of tiles').toBeGreaterThan(1);
    // Every lit tile is on the lane the charge runs down.
    for (const p of lit) expect(p.y, 'all on one row').toBe(10);
    expect(keys(lit), 'and it reaches the aimed square').toContain('12,10');
  });

  it('and draws a route line along it', () => {
    // The yellow dash line — already shipped, pinned here because the item is
    // about the charge's preview as a whole and a regression in either half
    // would read as "the line preview broke".
    const b = charging();
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    const drawn = b.renderer.draw.paths.filter((p) => p.squares.length > 0);
    expect(drawn.length, 'a route was drawn').toBeGreaterThan(0);
    expect(keys(drawn[0]!.squares), 'starting from the caster').toContain('8,10');
  });
});

describe('BASTION-RAM-LINE: and marks where the charge stops', () => {
  it('the landing square is on the impact layer', () => {
    // The half that was missing. Its own layer and colour, so the tile you come
    // to rest on is distinguishable from the three you plough through.
    const b = charging();
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(keys(layer(b.renderer, 'impact'))).toEqual(['12,10']);
  });

  it('and it moves with the aim', () => {
    const b = charging();
    aimAt(b.board, { x: 12, y: 10 }, 'mousemove');
    expect(keys(layer(b.renderer, 'impact'))).toEqual(['12,10']);
    aimAt(b.board, { x: 8, y: 13 }, 'mousemove');
    expect(keys(layer(b.renderer, 'impact')), 'the new end of the run')
      .toEqual(['8,13']);
  });

  it('a teleport dash gets no extra marker — its aimed square IS the landing', () => {
    // The scope line. Marking the landing of a blink would draw a second colour
    // over the one tile already lit, which says nothing a player did not know.
    const ui = mountUI();
    const opening: GameState = createMatch(OPEN_MAP, '1v1', [[BASTION], [VEX]]);
    const me = opening.units.find((u) => u.owner === 0)!;
    me.pos = { x: 8, y: 10 };
    opening.units.find((u) => u.owner === 1)!.pos = { x: 16, y: 10 };
    startHotSeat(ui.ui, OPEN_MAP, buildRoster([BASTION, VEX]), [[BASTION], [VEX]], '1v1',
      [1, 1], POOL, undefined, undefined, opening);
    // Bastion's own kit has no teleport, so this asserts the rule at its source
    // instead: `impactPreview` names a landing for every dash, and only a
    // `path` shape puts it on the board. Wisp's Blink is the teleport.
    const blink = WISP.abilities.find((a) => a.id === 'blink')!;
    expect(blink.shape, 'a teleport-style dash').not.toBe('path');
    const preview = impactPreview(OPEN_MAP, me, blink, [{ x: 11, y: 10 }]);
    expect(preview.landing, 'the landing is still reported').toEqual({ x: 11, y: 10 });
    expect(preview.destination, 'but nothing detonates there').toEqual([]);
  });

  it('nothing is marked before the player has aimed', () => {
    const b = charging();
    expect(layer(b.renderer, 'impact')).toEqual([]);
  });
});
