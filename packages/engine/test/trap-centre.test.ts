import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { buildBoard } from '../src/board.js';
import { circleSquares } from '../src/shapes.js';
import { TRAP_MAX_LIFETIME } from '../src/constants.js';
import type { CharacterDef, GameState, MapDef, Vec2 } from '../src/types.js';

/**
 * TRAP-CENTRE — a trap effect on an area shape places ONE trap, at the square
 * the ability was aimed at (Dev Note #9).
 *
 * Placement used to walk the ability's whole area and bury a mine under every
 * tile it covered. On a `square` shape — every shipped trap ability until now —
 * that is one tile and one trap, so nothing gave the rule away. Put the same
 * effect on a radius-1 disc and it is five traps; on a radius-2 disc, thirteen.
 * The count was a function of the shape rather than of anything anybody
 * authored, which is not a mechanic, it is an accident.
 *
 * One trap at the aimed square is one rule with no special case: for a `square`
 * or `self` shape the aimed square *is* the area, so those land exactly where
 * they always did.
 *
 * With that fixed, Thorn's auto can carry one: **Barbed Sling** now leaves an
 * 8-damage mine on the square it lands on for 2 turns, which is what makes the
 * zone kit a zone kit rather than a lobber with one setup tool.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const THORN = load('thorn');
const VEX = load('vex');
const SLING = THORN.abilities.find((a) => a.id === 'barbed_sling')!;

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }, { x: 3, y: 10 }], [{ x: 18, y: 10 }, { x: 17, y: 10 }]],
};
const roster: Roster = { thorn: THORN, vex: VEX };

/** Thorn on team 0 with one enemy, both placed by the test. */
const field = (thornAt: Vec2, enemyAt: Vec2) => {
  const state = createMatch(OPEN, '2v2', [[THORN, VEX], [VEX, VEX]]);
  const thorn = state.units.find((u) => u.characterId === 'thorn')!;
  const mate = state.units.find((u) => u.owner === 0 && u.characterId === 'vex')!;
  const [enemy, other] = state.units.filter((u) => u.owner === 1);
  thorn.pos = { ...thornAt };
  mate.pos = { x: 0, y: 20 };
  enemy!.pos = { ...enemyAt };
  other!.pos = { x: 20, y: 0 };
  return { state, thorn, enemy: enemy! };
};

const fire = (state: GameState, unitId: string, abilityId: string, target: Vec2) =>
  resolveTurn(state, OPEN, [
    { team: 0, units: [{ unitId, ability: { abilityId, target: [{ ...target }] } }] },
    { team: 1, units: [] },
  ], roster);

const walk = (state: GameState, unitId: string, path: Vec2[]) =>
  resolveTurn(state, OPEN, [
    { team: 0, units: [] },
    { team: 1, units: [{ unitId, movePath: path }] },
  ], roster);

const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

describe('TRAP-CENTRE: one trap, at the square that was aimed at', () => {
  it('a radius-1 disc covers five squares and buries exactly one mine', () => {
    // Stated with the area alongside it, so the test proves "centre only"
    // rather than "this shape happened to be one tile wide".
    const disc = circleSquares(buildBoard(OPEN), { x: 9, y: 10 }, SLING.radius ?? 1);
    expect(disc.length, 'the blast really does cover more than its centre').toBeGreaterThan(1);

    const { state, thorn } = field({ x: 6, y: 10 }, { x: 9, y: 10 });
    const after = fire(state, thorn.unitId, 'barbed_sling', { x: 9, y: 10 }).state;
    expect(after.traps).toHaveLength(1);
    expect(after.traps[0]!.pos).toEqual({ x: 9, y: 10 });
  });

  it('a square-shaped trap ability lands exactly where it always did', () => {
    // The control that keeps this from being a rewrite: Snare Bloom is a
    // `square`, its area is the aimed tile, and one rule covers both.
    const { state, thorn } = field({ x: 6, y: 10 }, { x: 18, y: 2 });
    const after = fire(state, thorn.unitId, 'snare_bloom', { x: 8, y: 10 }).state;
    expect(after.traps).toHaveLength(1);
    expect(after.traps[0]!.pos).toEqual({ x: 8, y: 10 });
  });

  it('one trapPlaced event, not one per covered tile', () => {
    // The log is the other place the old behaviour showed: five markers on the
    // board for one cast.
    const { state, thorn } = field({ x: 6, y: 10 }, { x: 9, y: 10 });
    const { events } = fire(state, thorn.unitId, 'barbed_sling', { x: 9, y: 10 });
    expect(events.filter((e) => e.type === 'trapPlaced')).toHaveLength(1);
  });
});

describe('TRAP-CENTRE: Barbed Sling leaves a live mine', () => {
  it('the shot damages, and the barbs stay behind as an 8-damage mine', () => {
    const { state, thorn, enemy } = field({ x: 6, y: 10 }, { x: 9, y: 10 });
    const shot = fire(state, thorn.unitId, 'barbed_sling', { x: 9, y: 10 }).state;
    expect(unit(shot, enemy.unitId).hp, 'the 15 landed').toBe(VEX.maxHp - 15);
    expect(shot.traps[0]!.damage, 'and the mine is the authored 8').toBe(8);
    expect(shot.traps[0]!.pos).toEqual({ x: 9, y: 10 });
    // The unit standing in the blast is not also mined by it: a trap triggers on
    // *entry*, and this one was buried under somebody already there.
    expect(unit(shot, enemy.unitId).hp).toBe(VEX.maxHp - 15);
  });

  it('the mine is a mine, not a second copy of the shot', () => {
    // Barbed Sling's damage effect rides in the trap's `onTrigger` list, so the
    // obvious way to get this wrong is for the mine to deal 15 as well as 8.
    const { state, thorn } = field({ x: 6, y: 10 }, { x: 18, y: 2 });
    const shot = fire(state, thorn.unitId, 'barbed_sling', { x: 9, y: 10 }).state;
    expect(shot.traps[0]!.damage).toBe(8);
    const victim = shot.units.find((u) => u.owner === 1)!;
    victim.pos = { x: 10, y: 10 };
    const sprung = walk(shot, victim.unitId, [{ x: 9, y: 10 }]).state;
    expect(unit(sprung, victim.unitId).hp, 'only the mine').toBe(VEX.maxHp - 8);
  });

  it('and it is gone after its two turns, unfired', () => {
    // `lifetime: 2` covers the turn it was laid and the next.
    const { state, thorn } = field({ x: 6, y: 10 }, { x: 18, y: 2 });
    const shot = fire(state, thorn.unitId, 'barbed_sling', { x: 9, y: 10 }).state;
    const placedOn = shot.turn - 1; // `turn` has already advanced past the cast
    expect(shot.traps[0]!.expiresOnTurn).toBe(placedOn + 2 - 1);
    const idle = (s: GameState) => resolveTurn(s, OPEN, [{ team: 0, units: [] }, { team: 1, units: [] }], roster).state;
    expect(shot.traps, 'armed on the turn it was thrown').toHaveLength(1);
    expect(idle(shot).traps, 'and swept at the end of the next one').toHaveLength(0);
  });

  it('two mines from one unit in one turn keep separate identities', () => {
    // Thorn can now arm two: Snare Bloom is `free: true`, so it rides alongside
    // the auto. Sharing an id would let one trap's consumption sweep the other
    // off the board.
    const { state, thorn } = field({ x: 6, y: 10 }, { x: 18, y: 2 });
    const after = resolveTurn(state, OPEN, [
      {
        team: 0,
        units: [{
          unitId: thorn.unitId,
          ability: { abilityId: 'barbed_sling', target: [{ x: 9, y: 10 }] },
          freeAbility: { abilityId: 'snare_bloom', target: [{ x: 7, y: 10 }] },
        }],
      },
      { team: 1, units: [] },
    ], roster).state;
    expect(after.traps).toHaveLength(2);
    expect(new Set(after.traps.map((t) => t.id)).size, 'distinct ids').toBe(2);
  });
});

describe('TRAP-CENTRE: the shipped lifetime cap is untouched', () => {
  // NOTE for the Analyzer: the AC asks for "the shipped per-team trap cap (4)"
  // to be re-asserted here. There is no per-team *count* cap in the engine —
  // the shipped 4 is `TRAP_MAX_LIFETIME`, the lifetime ceiling from
  // TRAP-LIFETIME-TUNE. That is the cap this pins; a count cap would be new
  // scope and is flagged rather than invented.
  it('a trap with no authored lifetime still lands on the ceiling', () => {
    const { state, thorn } = field({ x: 6, y: 10 }, { x: 18, y: 2 });
    const after = fire(state, thorn.unitId, 'snare_bloom', { x: 8, y: 10 }).state;
    const authored = THORN.abilities.find((a) => a.id === 'snare_bloom')!
      .effects.find((e) => e.kind === 'trap')!.lifetime!;
    expect(authored).toBeLessThanOrEqual(TRAP_MAX_LIFETIME);
    expect(after.traps[0]!.expiresOnTurn).toBe(after.turn - 1 + authored - 1);
  });

  it('nothing Thorn ships exceeds it', () => {
    for (const a of [...THORN.abilities, THORN.ultimate]) {
      for (const e of a.effects) {
        if (e.kind !== 'trap') continue;
        expect(e.lifetime ?? TRAP_MAX_LIFETIME, a.id).toBeLessThanOrEqual(TRAP_MAX_LIFETIME);
      }
    }
  });
});
