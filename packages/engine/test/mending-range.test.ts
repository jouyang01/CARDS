import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { aimInRange, circleSquares } from '../src/shapes.js';
import { buildBoard } from '../src/board.js';
import type { CharacterDef, GameState, MapDef } from '../src/types.js';

/**
 * MENDING-RANGE — "Mending Light heals outside its range" (Dev Note #12).
 *
 * The aim gate was never broken. `aimIsLegal` checks `aimInRange` against the
 * Euclidean metric and refuses a centre beyond range 5, and the area is the
 * radius-1 disc the ability is authored with — both correct, and the AC blesses
 * "aim gate + area (r1)" explicitly.
 *
 * What was broken is that **the caster received the ability's beneficial effects
 * whether or not it stood in the area**. So Lumen was healed by her own Mending
 * Light from anywhere on the board: an ability with a range and a footprint that
 * reached one particular unit — herself — at unlimited distance.
 *
 * The fix is one rule with no exceptions: the caster is in the area or it is
 * not, exactly like an ally. Every self-buff that was meant to land still does,
 * because a `self` shape's area *is* the caster's square, a dash ends inside its
 * own path or on its landing square, and a `circle` with `range: 0` is centred
 * on the caster. What changes is the abilities aimed *away*.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const LUMEN = load('lumen');
const VEX = load('vex');
const MENDING = LUMEN.abilities.find((a) => a.id === 'mending_light')!;

const OPEN: MapDef = {
  id: 't', name: 't', width: 25, height: 25, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 12 }, { x: 3, y: 12 }], [{ x: 22, y: 12 }, { x: 21, y: 12 }]],
};
const roster: Roster = { lumen: LUMEN, vex: VEX };

/** Lumen and an ally, both wounded, placed where the test wants them. */
const field = (lumenAt: { x: number; y: number }, allyAt: { x: number; y: number }) => {
  const state = createMatch(OPEN, '2v2', [[LUMEN, VEX], [VEX, VEX]]);
  const lumen = state.units.find((u) => u.characterId === 'lumen')!;
  const ally = state.units.find((u) => u.owner === 0 && u.characterId === 'vex')!;
  lumen.pos = { ...lumenAt };
  ally.pos = { ...allyAt };
  lumen.hp = 40;
  ally.hp = 40;
  return { state, lumenId: lumen.unitId, allyId: ally.unitId };
};

const heal = (state: GameState, target: { x: number; y: number }, lumenId: string) =>
  resolveTurn(state, OPEN, [
    { team: 0, units: [{ unitId: lumenId, ability: { abilityId: 'mending_light', target: [{ ...target }] } }] },
    { team: 1, units: [] },
  ], roster).state;

const hp = (state: GameState, id: string): number => state.units.find((u) => u.unitId === id)!.hp;

describe('MENDING-RANGE: the reported case', () => {
  it('a heal aimed at a distant ally no longer reaches the caster', () => {
    // The exact observed bug, pinned: Lumen at (2,2) aims four squares away at
    // (6,2). The radius-1 disc around (6,2) does not contain (2,2) — and before
    // this fix she healed herself for the full amount anyway.
    const { state, lumenId, allyId } = field({ x: 2, y: 2 }, { x: 6, y: 2 });
    const after = heal(state, { x: 6, y: 2 }, lumenId);
    expect(hp(after, allyId), 'the ally she aimed at is healed').toBeGreaterThan(40);
    expect(hp(after, lumenId), 'and she is not').toBe(40);
  });

  it('however far away she stands — the old behaviour had no distance at all', () => {
    // The sharpest statement of the bug: there was no range beyond which the
    // caster stopped being healed, because the caster was never range-checked.
    for (const at of [{ x: 2, y: 2 }, { x: 2, y: 20 }, { x: 24, y: 24 }]) {
      const { state, lumenId } = field(at, { x: 6, y: 2 });
      expect(hp(heal(state, { x: 6, y: 2 }, lumenId), lumenId), `from ${at.x},${at.y}`).toBe(40);
    }
  });

  it('standing IN the disc she aimed at, she is healed — the area is the rule', () => {
    // Not a nerf, a target: adjacent to the centre puts her inside the radius-1
    // area, and the heal lands exactly as it should.
    const { state, lumenId, allyId } = field({ x: 5, y: 2 }, { x: 6, y: 2 });
    const after = heal(state, { x: 6, y: 2 }, lumenId);
    expect(hp(after, lumenId)).toBeGreaterThan(40);
    expect(hp(after, allyId)).toBeGreaterThan(40);
  });

  it('and aiming at her own square heals her, once', () => {
    const { state, lumenId } = field({ x: 5, y: 2 }, { x: 20, y: 20 });
    const after = heal(state, { x: 5, y: 2 }, lumenId);
    const healed = hp(after, lumenId) - 40;
    expect(healed).toBeGreaterThan(0);
    expect(healed, 'not twice — the caster is not also collected as an ally')
      .toBe(MENDING.effects.find((e) => e.kind === 'heal')!.amount);
  });
});

describe('MENDING-RANGE: the gate itself was never the problem', () => {
  it('an aim beyond range is refused, so nothing is healed at all', () => {
    // Stated so a future "fix" cannot loosen the gate by mistake: the centre is
    // Euclidean-checked, and an illegal aim voids the ability rather than
    // clamping it.
    const { state, lumenId, allyId } = field({ x: 2, y: 2 }, { x: 12, y: 2 });
    expect(aimInRange({ x: 2, y: 2 }, { x: 12, y: 2 }, MENDING.range)).toBe(false);
    const after = heal(state, { x: 12, y: 2 }, lumenId);
    expect(hp(after, allyId)).toBe(40);
    expect(hp(after, lumenId)).toBe(40);
  });

  it('an ally one square past the gate IS healed — area reaches past range, by design', () => {
    // The AC blesses "aim gate + area (r1)", so this is the intended shape and
    // not a second bug: a legal centre at range 5 spills its disc to 6.
    const { state, lumenId, allyId } = field({ x: 2, y: 2 }, { x: 8, y: 2 });
    expect(aimInRange({ x: 2, y: 2 }, { x: 7, y: 2 }, MENDING.range), 'the centre is legal').toBe(true);
    expect(aimInRange({ x: 2, y: 2 }, { x: 8, y: 2 }, MENDING.range), 'the ally is not').toBe(false);
    expect(hp(heal(state, { x: 7, y: 2 }, lumenId), allyId)).toBeGreaterThan(40);
  });

  it('the area is exactly the authored disc, and the caster is judged against it', () => {
    // The two halves of the fix in one place: what the area is, and who is in it.
    const board = buildBoard(OPEN);
    const area = circleSquares(board, { x: 6, y: 2 }, MENDING.radius ?? 1);
    expect(area.some((p) => p.x === 2 && p.y === 2), 'the caster was never in it').toBe(false);
    expect(area.some((p) => p.x === 5 && p.y === 2), 'but an adjacent square is').toBe(true);
  });
});

describe('MENDING-RANGE: every self-buff that was meant to land still lands', () => {
  const AEGIS = load('aegis');
  const WISP = load('wisp');

  it('W1: an effect marked `target: "self"` reaches its caster from any aim', () => {
    // Veil & Decoy used to be a `self` shape, so MENDING-RANGE's area gate was
    // satisfied by construction — the area WAS Wisp's square. W1 aims it up to
    // three tiles away, which takes that for granted no longer: the area is now
    // the square the decoy goes on, and Wisp is not standing there.
    //
    // `target: "self"` is the mechanism that keeps the stealth on her, and this
    // is the test that says so. Without it the vanish would be silently gated
    // off by the same rule that stopped Lumen healing from across the board —
    // correct for a heal aimed away, wrong for a vanish.
    const veil = WISP.abilities.find((a) => a.id === 'veil_decoy')!;
    expect(veil.shape, 'aimed, not self').toBe('square');
    expect(veil.effects.find((e) => e.kind === 'stealth')?.target).toBe('self');
    expect(veil.effects.find((e) => e.kind === 'decoy')?.target).toBe('aimed');

    const state = createMatch(OPEN, '1v1', [[WISP], [VEX]]);
    const wisp = state.units[0]!;
    const away = { x: wisp.pos.x, y: wisp.pos.y + 2 }; // in range, and not her square
    const after = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: wisp.unitId, ability: { abilityId: 'veil_decoy', target: [away] } }] },
      { team: 1, units: [] },
    ], { wisp: WISP, vex: VEX }).state;
    expect(after.units[0]!.statuses.some((st) => st.kind === 'stealth'), 'the self-buff landed').toBe(true);
    expect(after.decoys, 'and the placed half landed too').toHaveLength(1);
    expect(after.decoys[0]!.pos, 'at the aim, not at the caster').toEqual(away);
  });

  it('a dash still buffs its dasher — it ends on its own landing square', () => {
    // Aegis's Intercept is a `square` teleport carrying a shield. The area is
    // the landing square and the dasher is standing on it once the dash
    // resolves, so the gate holds without the old unconditional exception.
    const state = createMatch(OPEN, '1v1', [[AEGIS], [VEX]]);
    const aegis = state.units[0]!;
    aegis.pos = { x: 5, y: 5 };
    const to = { x: 8, y: 5 };
    const { state: after, events } = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: aegis.unitId, ability: { abilityId: 'intercept', target: [to] } }] },
      { team: 1, units: [] },
    ], { aegis: AEGIS, vex: VEX });
    const moved = after.units.find((u) => u.unitId === aegis.unitId)!;
    expect(moved.pos, 'it went where it aimed').toEqual(to);
    // Intercept's shield is duration 1, so it is gone by the end-of-turn tick —
    // the event is where a one-turn shield leaves its evidence.
    expect(
      events.some((e) => e.type === 'statusApplied' && e.status === 'shield' && e.unitId === aegis.unitId),
      'and kept its self-buff',
    ).toBe(true);
  });

  it('a range-0 circle is centred on the caster, so it still covers itself', () => {
    // Aegis's Warding Halo (her ult) is `circle` with `range: 0` — the aim can
    // only be her own square, which puts her inside her own radius-2 disc.
    const halo = AEGIS.ultimate;
    expect(halo.id).toBe('warding_halo');
    expect(halo.range, 'nowhere else to aim it').toBe(0);
    const board = buildBoard(OPEN);
    const area = circleSquares(board, { x: 5, y: 5 }, halo.radius ?? 1);
    expect(area.some((p) => p.x === 5 && p.y === 5)).toBe(true);
  });
});
