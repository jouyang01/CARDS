// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalystPool, buildRoster, createMatch,
  type CatalystData, type CharacterDef, type GameState, type MapDef, type Vec2,
} from '@cards/engine';
import { startHotSeat } from '../src/app.js';
import { emptyDraft, toUnitOrders } from '../src/targeting.js';
import { logEntriesForTurn } from '../src/combat-log.js';
import {
  aimAndCommit, armAbility, lockIn, mountUI, playbackRow, skipPlayback, unitAt, unitHp,
} from './app-harness.js';
import catalystData from '../../../data/catalysts.json';
import aegis from '../../../data/characters/aegis.json';
import kestrel from '../../../data/characters/kestrel.json';
import vex from '../../../data/characters/vex.json';

/**
 * INTERCEPT-GUARD, through the real controller.
 *
 * The engine tests prove the redirect; this proves a **player can cast it**,
 * which is a different question and the one that has bitten twice. WALL-CAST-FIX
 * was an ability with twenty-four green engine tests and a correct preview that
 * could not be used, because `toUnitOrders` dropped the one field the aim needed.
 * Intercept now has exactly that shape of risk, one field later: its aim is an
 * **ally id**, and a square alone is not a legal order for it.
 *
 * So these drive arm → click the ally → Lock In → resolve, and assert on **HP
 * that moved**. A test that stopped at the preview would pass with the order
 * builder broken — which is the definition of the wrong test here.
 */

const AEGIS = aegis as unknown as CharacterDef;
const KESTREL = kestrel as unknown as CharacterDef;
const VEX = vex as unknown as CharacterDef;
const INTERCEPT = AEGIS.abilities.find((a) => a.id === 'intercept')!;
const RAIL = VEX.abilities.find((a) => a.id === 'rail_shot')!;
const RAIL_DAMAGE = RAIL.effects.find((e) => e.kind === 'damage')!.amount!;
const SHIELD = INTERCEPT.effects.find((e) => e.kind === 'shield')!.amount!;
const POOL = buildCatalystPool(catalystData as unknown as CatalystData);

const FIELD: MapDef = {
  id: 'f', name: 'f', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 10, y: 7 }, { x: 10, y: 10 }], [{ x: 16, y: 10 }, { x: 16, y: 14 }]],
};

/**
 * A 2v2 hot-seat: Aegis north of Kestrel, one Vex due east of her on the row.
 *
 * Aegis interposes at (10,9) — north of the ally and OFF the row the shot
 * travels down, so any HP he loses is HP he took for somebody.
 */
const board2v2 = () => {
  const ui = mountUI();
  const teams: [CharacterDef[], CharacterDef[]] = [[AEGIS, KESTREL], [VEX, VEX]];
  const state: GameState = createMatch(FIELD, '2v2', teams);
  const [aegis, ally] = state.units.filter((u) => u.owner === 0);
  const foes = state.units.filter((u) => u.owner === 1);
  aegis!.pos = { x: 10, y: 7 };
  ally!.pos = { x: 10, y: 10 };
  foes[0]!.pos = { x: 16, y: 10 };
  foes[1]!.pos = { x: 1, y: 1 };
  startHotSeat(ui.ui, FIELD, buildRoster([AEGIS, KESTREL, VEX]), teams, '2v2', [1, 1], POOL,
    undefined, undefined, state);
  return { ...ui, state, aegis: aegis!, ally: ally!, foe: foes[0]! };
};

/**
 * Run the turn out and let the animation finish.
 *
 * **Four lock-ins, not two:** in a 2v2 hot-seat one player runs both of a
 * team's characters, and Lock In advances one CHARACTER at a time. Two would
 * leave the turn half-planned, and — because the board is fogged to whoever is
 * on the clock — the assertions afterwards would be reading the enemy's view.
 */
const playTurn = async (b: ReturnType<typeof board2v2>): Promise<void> => {
  for (let i = 0; i < 4; i++) lockIn(b.controls);
  skipPlayback(b.controls);
  await vi.waitFor(() => {
    expect(playbackRow(b.controls).style.display, 'playback finished').toBe('none');
  });
};

const key = (p: Vec2): string => `${p.x},${p.y}`;

beforeEach(() => { document.body.replaceChildren(); });

describe('INTERCEPT-GUARD: the order that goes out', () => {
  it('carries the ally id — the field an ally-targeted aim cannot do without', () => {
    // The unit-level statement of the WALL-CAST-FIX lesson. A square alone is
    // not a legal Intercept while an ally lives, so an order-builder that
    // dropped this would produce an ability that silently never casts.
    const draft = {
      ...emptyDraft('u0'), abilityId: INTERCEPT.id,
      aim: [{ x: 10, y: 10 }], allyTargetId: 'ally-1',
    };
    expect(toUnitOrders(AEGIS, draft).ability?.targetUnitId, 'the ally is in the order')
      .toBe('ally-1');
  });

  it('and does not carry a stale one when a different ability is armed', () => {
    // The other half of the gate, matching the rotation's: an ally named while
    // Intercept was armed must not ride out on the next ability's square aim.
    const draft = {
      ...emptyDraft('u0'), abilityId: 'shield_bash',
      aim: [{ x: 11, y: 10 }], allyTargetId: 'ally-1',
    };
    expect(toUnitOrders(AEGIS, draft).ability?.targetUnitId, 'no ally on an ordinary aim')
      .toBeUndefined();
  });
});

describe('INTERCEPT-GUARD: arm → click the ally → Lock In → resolve', () => {
  it('the bodyguard takes the shot that was aimed at his teammate', async () => {
    // The whole design, driven the way a player drives it. On a controller that
    // dropped the ally id, Aegis would still be standing where he started and
    // Kestrel would be down a full Rail Shot.
    const b = board2v2();
    armAbility(b.controls, INTERCEPT.name);
    aimAndCommit(b.board, b.ally.pos); // BODY-CLICK: clicking a unit means the unit
    lockIn(b.controls); // Aegis is done…
    lockIn(b.controls); // …and Kestrel holds, which finishes the team's seat
    armAbility(b.controls, RAIL.name);
    aimAndCommit(b.board, { x: 10, y: 10 });
    lockIn(b.controls); // the shooter
    lockIn(b.controls); // the second Vex holds
    skipPlayback(b.controls);
    await vi.waitFor(() => {
      expect(playbackRow(b.controls).style.display).toBe('none');
    });

    expect(unitAt(b.renderer, b.aegis.unitId), 'he interposed').toEqual({ x: 10, y: 9 });
    expect(b.ally.hp - (unitHp(b.renderer, b.ally.unitId) ?? 0), 'the ally took nothing').toBe(0);
    expect(b.aegis.hp - (unitHp(b.renderer, b.aegis.unitId) ?? 0), 'and he took it, through the shield')
      .toBe(Math.max(0, RAIL_DAMAGE - SHIELD));
  });

  it('the preview marks where he will stand and draws the link to get there', async () => {
    // AIM-PREVIEW-TRUE's promise for this ability. A highlighted ally on its own
    // reads as "this does something TO my teammate"; the landing marker and the
    // line are what make it read as "I am going to stand there".
    const b = board2v2();
    armAbility(b.controls, INTERCEPT.name);
    aimAndCommit(b.board, b.ally.pos);
    const impact = (b.renderer.draw.highlights.get('impact') ?? []).map(key);
    expect(impact, 'the landing square is marked').toContain('10,9');
    const link = b.renderer.draw.paths.filter((p) => p.layer === 'guardPath');
    expect(link.length, 'and a line runs to it').toBeGreaterThan(0);
    expect(link[link.length - 1]!.squares.map(key), 'from him to the square')
      .toEqual(['10,7', '10,9']);
  });

  it('clicking bare ground while an ally is alive commits nothing', async () => {
    // The 1v1 fallback is a fallback, not a choice — and the engine refuses a
    // square aim while an ally lives. Offering one in the UI would be a preview
    // promising an order that gets dropped at resolution, which is the exact
    // class AIM-RANGE closed for every other slot.
    const b = board2v2();
    armAbility(b.controls, INTERCEPT.name);
    aimAndCommit(b.board, { x: 12, y: 7 });
    await playTurn(b);
    expect(unitAt(b.renderer, b.aegis.unitId), 'he never moved').toEqual({ x: 10, y: 7 });
  });
});

describe('INTERCEPT-GUARD: the log says what happened', () => {
  it('names the guard and every hit that bent', () => {
    // A redirect nobody can read is a shot that looks like it missed and a
    // teammate who lost HP for no reason.
    const lines = logEntriesForTurn(3, [
      { type: 'guardApplied', casterId: 'a', allyId: 'k' },
      { type: 'damageRedirected', from: 'k', to: 'a', amount: 26 },
    ], { unit: (id) => (id === 'a' ? 'Aegis' : 'Kestrel'), ability: (id) => id });
    expect(lines.map((l) => l.text)).toEqual([
      'Aegis is guarding Kestrel',
      'Aegis took 26 for Kestrel',
    ]);
  });
});
