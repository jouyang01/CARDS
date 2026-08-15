import { describe, expect, it } from 'vitest';
import {
  VISION_RANGE,
  buildBoard,
  buildVision,
  createMatch,
  visibleEnemiesForTeam,
  type AbilityDef,
  type CharacterDef,
  type GameState,
  type MapDef,
  type TeamId,
  type TrapState,
} from '@cards/engine';
import { fogView, revealedView } from '../src/fog.js';
import { previewNumbers } from '../src/preview-numbers.js';
import { initView, playEvents } from '../src/playback.js';
import vex from '../../../data/characters/vex.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * PREVIEW-FOG + TRAP-INDICATOR — two Dev Notes, one gate.
 *
 * Both are about the client telling the truth about what a team can see. The
 * preview was *leaking*: a damage number floated over an enemy the actor could
 * not see, so sweeping an aim across the dark read out a hidden unit's exact
 * square. The trap was *withholding*: placed traps had no board marker at all,
 * so a player could not see their own minefield, let alone route around it.
 *
 * Neither derives visibility. Both ask `fogView`, which asks the engine.
 */

const VEX = vex as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;
/** Wide enough that two units can sit further apart than `VISION_RANGE`. */
const OPEN: MapDef = {
  id: 't', name: 't', width: 25, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 5 }], [{ x: 23, y: 7 }, { x: 23, y: 5 }]],
};

const ability = (c: CharacterDef, id: string): AbilityDef =>
  [...c.abilities, c.ultimate].find((a) => a.id === id)!;
const at = (s: GameState, unitId: string, x: number, y: number): void => {
  s.units.find((u) => u.unitId === unitId)!.pos = { x, y };
};
const board = (): GameState => createMatch(OPEN, '1v1', [[VEX], [AEGIS]]);
const seenBy = (s: GameState, team: TeamId): Set<string> =>
  new Set(fogView(OPEN, s, team).units.map((u) => u.unitId));

const trap = (over: Partial<TrapState> & Pick<TrapState, 'id' | 'owner' | 'pos'>): TrapState => ({
  ownerUnitId: 'x', abilityId: 'overwatch_trap', damage: 20, onTrigger: [], ...over,
});

// ── PREVIEW-FOG ─────────────────────────────────────────────────────────────

describe('PREVIEW-FOG: a preview number never outs a unit you cannot see', () => {
  /** Vex at (2,7) firing east; the enemy parked `gap` squares away on the row. */
  const firingLine = (gap: number) => {
    const s = board();
    const caster = s.units.find((u) => u.characterId === 'vex')!;
    const enemy = s.units.find((u) => u.owner !== caster.owner)!;
    at(s, caster.unitId, 2, 7);
    at(s, enemy.unitId, 2 + gap, 7);
    const rail = ability(VEX, 'rail_shot'); // line, range 8
    // The whole row the beam covers, so the enemy is in the area either way and
    // only vision can be the thing that differs.
    const squares = Array.from({ length: 12 }, (_, i) => ({ x: 3 + i, y: 7 }));
    return { s, caster, enemy, rail, squares };
  };

  it('shows the number over an enemy the team can see', () => {
    const { s, caster, enemy, rail, squares } = firingLine(4);
    expect(seenBy(s, caster.owner).has(enemy.unitId)).toBe(true); // premise
    const shown = previewNumbers(s, caster, [{ def: rail, squares }], seenBy(s, caster.owner));
    expect(shown.some((n) => n.unitId === enemy.unitId)).toBe(true);
  });

  it('shows nothing over the same enemy once it is out of sight', () => {
    // Beyond VISION_RANGE but still inside the beam: the leak, exactly.
    const { s, caster, enemy, rail, squares } = firingLine(VISION_RANGE + 2);
    expect(seenBy(s, caster.owner).has(enemy.unitId)).toBe(false); // premise
    const shown = previewNumbers(s, caster, [{ def: rail, squares }], seenBy(s, caster.owner));
    expect(shown.some((n) => n.unitId === enemy.unitId)).toBe(false);
  });

  it('and the aim itself is still allowed — you may fire into the dark', () => {
    // The rule withholds information, it does not withhold the shot. The area
    // is unchanged; only the readout over the unseen unit is gone.
    const { s, caster, rail, squares } = firingLine(VISION_RANGE + 2);
    expect(squares.length).toBeGreaterThan(0);
    expect(previewNumbers(s, caster, [{ def: rail, squares }], seenBy(s, caster.owner))).toEqual([]);
  });

  it('own units are never hidden from their own team, wherever they stand', () => {
    const s = createMatch(OPEN, '2v2', [[VEX, AEGIS], [AEGIS, VEX]]);
    const caster = s.units.find((u) => u.characterId === 'vex' && u.owner === 0)!;
    const ally = s.units.find((u) => u.owner === caster.owner && u.unitId !== caster.unitId)!;
    at(s, caster.unitId, 2, 7);
    at(s, ally.unitId, 20, 7); // far outside sight range, but it is still yours
    const rail = ability(VEX, 'rail_shot');
    const shown = previewNumbers(s, caster, [{ def: rail, squares: [ally.pos] }], seenBy(s, caster.owner));
    expect(shown.some((n) => n.unitId === ally.unitId && n.kind === 'damage')).toBe(true);
  });

  it('a stealthed enemy in the area shows nothing — the gate is the engine\'s', () => {
    // Not distance this time: `visibleEnemiesForTeam` hides it, and the preview
    // inherits that without knowing what Stealth is.
    const { s, caster, enemy, rail, squares } = firingLine(3);
    s.units.find((u) => u.unitId === enemy.unitId)!.statuses = [{ kind: 'stealth', remaining: 2 }];
    const vision = buildVision(buildBoard(OPEN));
    expect(visibleEnemiesForTeam(vision, s, caster.owner).map((u) => u.unitId)).toEqual([]); // premise
    const shown = previewNumbers(s, caster, [{ def: rail, squares }], seenBy(s, caster.owner));
    expect(shown.some((n) => n.unitId === enemy.unitId)).toBe(false);
  });

  it('the gate is exactly the set the board is drawn from, not a second answer', () => {
    const { s, caster, rail, squares } = firingLine(VISION_RANGE + 2);
    const drawn = new Set(fogView(OPEN, s, caster.owner).units.map((u) => u.unitId));
    const numbered = new Set(
      previewNumbers(s, caster, [{ def: rail, squares }], drawn).map((n) => n.unitId),
    );
    for (const id of numbered) expect(drawn.has(id), id).toBe(true);
  });
});

// ── TRAP-INDICATOR ──────────────────────────────────────────────────────────

describe('TRAP-INDICATOR: a trap is drawn for whoever may see it', () => {
  const withTraps = (...traps: TrapState[]): GameState => {
    const s = board();
    at(s, s.units[0]!.unitId, 2, 7);
    at(s, s.units[1]!.unitId, 22, 7);
    s.traps = traps;
    return s;
  };

  it('the placing team always sees its own, even across the map', () => {
    // You planted it and it is team-safe, so you must be able to route over it
    // knowingly — vision of the square is not the question for your own.
    const s = withTraps(trap({ id: 't1', owner: 0, pos: { x: 20, y: 2 } }));
    expect(fogView(OPEN, s, 0).traps.map((t) => t.id)).toEqual(['t1']);
  });

  it('and they are tagged as its own, so the renderer can style them', () => {
    const s = withTraps(trap({ id: 't1', owner: 0, pos: { x: 3, y: 7 } }));
    expect(fogView(OPEN, s, 0).traps[0]).toEqual({ id: 't1', pos: { x: 3, y: 7 }, owner: 0, own: true });
  });

  it('the enemy sees one only on a square it can actually see', () => {
    const s = withTraps(trap({ id: 't1', owner: 0, pos: { x: 3, y: 7 } }));
    // Team 1's unit is at (22,7) — nowhere near it.
    expect(fogView(OPEN, s, 1).traps).toEqual([]);
  });

  it('…and does see one placed under its nose', () => {
    const s = withTraps(trap({ id: 't1', owner: 0, pos: { x: 21, y: 7 } }));
    const seen = fogView(OPEN, s, 1).traps;
    expect(seen).toHaveLength(1);
    expect(seen[0]!.own).toBe(false); // an enemy trap, styled as one
    expect(seen[0]!.owner).toBe(0);
  });

  it('a board with no traps draws none rather than an empty marker', () => {
    expect(fogView(OPEN, board(), 0).traps).toEqual([]);
  });

  it('both teams see a trap on a square both can see', () => {
    const s = withTraps(trap({ id: 't1', owner: 0, pos: { x: 3, y: 7 } }));
    at(s, s.units[1]!.unitId, 4, 7); // walked right up to it
    expect(fogView(OPEN, s, 0).traps).toHaveLength(1);
    expect(fogView(OPEN, s, 1).traps).toHaveLength(1);
  });

  it('a revealed view shows every trap, still styled from the viewer\'s side', () => {
    const s = withTraps(
      trap({ id: 'mine', owner: 0, pos: { x: 3, y: 7 } }),
      trap({ id: 'theirs', owner: 1, pos: { x: 20, y: 3 } }),
    );
    const view = revealedView(s, 0);
    expect(view.traps.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
    expect(view.traps.find((t) => t.id === 'mine')!.own).toBe(true);
    expect(view.traps.find((t) => t.id === 'theirs')!.own).toBe(false);
  });
});

describe('TRAP-INDICATOR: playback folds traps from the log', () => {
  const empty = (): GameState => {
    const s = board();
    s.traps = [];
    return s;
  };

  it('seeds from the pre-turn state', () => {
    const s = board();
    s.traps = [trap({ id: 't1', owner: 0, pos: { x: 4, y: 4 } })];
    expect([...initView(s).traps.keys()]).toEqual(['t1']);
  });

  it('a trap placed this turn appears', () => {
    const view = playEvents(empty(), [
      { type: 'trapPlaced', trapId: 't1', pos: { x: 4, y: 4 }, owner: 0 },
    ]);
    expect(view.traps.get('t1')).toEqual({ id: 't1', owner: 0, pos: { x: 4, y: 4 } });
  });

  it('and a triggered trap disappears — the marker is consumed with it', () => {
    // A marker that outlived its trap would tell the player a dead square is
    // still dangerous, which is exactly the wrong direction for a hazard.
    const s = empty();
    s.traps = [trap({ id: 't1', owner: 0, pos: { x: 4, y: 4 } })];
    const view = playEvents(s, [{ type: 'trapTriggered', trapId: 't1', unitId: 'someone' }]);
    expect(view.traps.size).toBe(0);
  });

  it('an unrelated event leaves the trap where it is', () => {
    const s = empty();
    s.traps = [trap({ id: 't1', owner: 0, pos: { x: 4, y: 4 } })];
    const view = playEvents(s, [{ type: 'phaseStart', phase: 'blast' }]);
    expect(view.traps.size).toBe(1);
  });
});
