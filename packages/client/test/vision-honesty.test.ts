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
import { camoTiles, fogView, rememberSightings, revealedView, sightingKey } from '../src/fog.js';
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
  // `expiresOnTurn` far out: these cases are about who may *see* a trap, and one
  // that expired mid-test would pass or fail for the wrong reason.
  ownerUnitId: 'x', abilityId: 'overwatch_trap', damage: 20, expiresOnTurn: 99, onTrigger: [], ...over,
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
    expect(shown.some((n) => n.targetId === enemy.unitId)).toBe(true);
  });

  it('shows nothing over the same enemy once it is out of sight', () => {
    // Beyond VISION_RANGE but still inside the beam: the leak, exactly.
    const { s, caster, enemy, rail, squares } = firingLine(VISION_RANGE + 2);
    expect(seenBy(s, caster.owner).has(enemy.unitId)).toBe(false); // premise
    const shown = previewNumbers(s, caster, [{ def: rail, squares }], seenBy(s, caster.owner));
    expect(shown.some((n) => n.targetId === enemy.unitId)).toBe(false);
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
    expect(shown.some((n) => n.targetId === ally.unitId && n.kind === 'damage')).toBe(true);
  });

  it('a stealthed enemy in the area shows nothing — the gate is the engine\'s', () => {
    // Not distance this time: `visibleEnemiesForTeam` hides it, and the preview
    // inherits that without knowing what Stealth is.
    const { s, caster, enemy, rail, squares } = firingLine(3);
    s.units.find((u) => u.unitId === enemy.unitId)!.statuses = [{ kind: 'stealth', remaining: 2 }];
    const vision = buildVision(buildBoard(OPEN));
    expect(visibleEnemiesForTeam(vision, s, caster.owner).map((u) => u.unitId)).toEqual([]); // premise
    const shown = previewNumbers(s, caster, [{ def: rail, squares }], seenBy(s, caster.owner));
    expect(shown.some((n) => n.targetId === enemy.unitId)).toBe(false);
  });

  it('the gate is exactly the set the board is drawn from, not a second answer', () => {
    const { s, caster, rail, squares } = firingLine(VISION_RANGE + 2);
    const drawn = new Set(fogView(OPEN, s, caster.owner).units.map((u) => u.unitId));
    const numbered = new Set(
      previewNumbers(s, caster, [{ def: rail, squares }], drawn).map((n) => n.targetId),
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

  it('an expired trap disappears too (TRAP-LIFETIME)', () => {
    // The other way a trap leaves the board. Folding only `trapTriggered` would
    // leave a marker over a square that ran out its life.
    const s = empty();
    s.traps = [trap({ id: 't1', owner: 0, pos: { x: 4, y: 4 } })];
    const view = playEvents(s, [
      { type: 'trapExpired', trapId: 't1', pos: { x: 4, y: 4 }, owner: 0 },
    ]);
    expect(view.traps.size).toBe(0);
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


// ── CAMO-REVEAL (client half) ───────────────────────────────────────────────

/**
 * The red thicket. The engine decides who is revealed; this only asks which of
 * them are still standing in the brush that gave them away, and — like every
 * other client consumer — refuses to say it about a unit the viewer cannot see.
 */
describe('CAMO-REVEAL: a camouflage tile burns red under a revealed unit', () => {
  const BRUSH = { x: 6, y: 7 };
  /** Wisp-side unit standing in a one-square thicket, enemy 3 away and looking. */
  const thicket = (revealed: boolean): GameState => {
    const m: MapDef = { ...OPEN, brush: [BRUSH] };
    const s = createMatch(m, '1v1', [[VEX], [AEGIS]]);
    const hider = s.units[0]!;
    hider.pos = { ...BRUSH };
    if (revealed) hider.statuses = [{ kind: 'reveal', remaining: 2 }];
    s.units[1]!.pos = { x: 9, y: 7 };
    return s;
  };
  const mapWithBrush: MapDef = { ...OPEN, brush: [BRUSH] };

  it('lights the square the revealed unit is standing on', () => {
    expect(fogView(mapWithBrush, thicket(true), 0).camoTiles).toEqual([BRUSH]);
  });

  it('and lights nothing while the unit is merely hidden', () => {
    expect(fogView(mapWithBrush, thicket(false), 0).camoTiles).toEqual([]);
  });

  it('the ENEMY sees the tell too — that is the entire point of it', () => {
    // Reveal beats brush, so the unit is visible to them; the red tile is the
    // thing that says "and it is standing right there".
    expect(fogView(mapWithBrush, thicket(true), 1).camoTiles).toEqual([BRUSH]);
  });

  it('a revealed unit standing in the OPEN lights nothing', () => {
    const s = thicket(true);
    s.units[0]!.pos = { x: 2, y: 7 }; // same reveal, no thicket
    expect(fogView(mapWithBrush, s, 0).camoTiles).toEqual([]);
  });

  it('never lights a tile over a unit the viewer cannot see', () => {
    // The leak this would be: a red glow readable through fog is a better
    // tracker than the fog it sits under.
    const s = thicket(true);
    s.units[1]!.pos = { x: 24, y: 14 }; // enemy far away, sees nothing
    expect(fogView(mapWithBrush, s, 1).camoTiles).toEqual([]);
  });

  it('a dead unit lying in brush lights nothing', () => {
    const s = thicket(true);
    s.units[0]!.alive = false;
    expect(fogView(mapWithBrush, s, 0).camoTiles).toEqual([]);
  });

  it('the rule is written once and works on any unit shape', () => {
    // `camoTiles` is shape-agnostic so Decision (engine units) and playback
    // (folded view units) cannot drift apart. Same map, same answer.
    const asView = [{ pos: BRUSH, alive: true, revealed: true }];
    expect(camoTiles(mapWithBrush, asView)).toEqual([BRUSH]);
    expect(camoTiles(mapWithBrush, [{ pos: BRUSH, alive: true, revealed: false }])).toEqual([]);
    expect(camoTiles(mapWithBrush, [{ pos: { x: 2, y: 7 }, alive: true, revealed: true }])).toEqual([]);
  });

  it('a board with no brush at all lights nothing, whoever is revealed', () => {
    const s = thicket(true);
    expect(fogView(OPEN, s, 0).camoTiles).toEqual([]);
  });
});


// ── LAST-KNOWN ──────────────────────────────────────────────────────────────

/**
 * LAST-KNOWN — "Your character icon would remain at your last spotted location
 * until you stepped back into their sight."
 *
 * Without it an enemy that steps behind a wall simply evaporates, and the player
 * is left guessing whether it is still there or already flanking. The ghost
 * leaks nothing — every square in the memory is one this team was already shown
 * — but it is the only stateful thing the client keeps, so these tests are as
 * much about *when the memory must not update* as about when it must.
 */
describe('LAST-KNOWN: an enemy you lose sight of leaves a ghost behind', () => {
  /** Vex at (2,7); the enemy wherever the case needs it. */
  const facing = (enemyAt: { x: number; y: number }): GameState => {
    const s = board();
    at(s, s.units[0]!.unitId, 2, 7);
    at(s, s.units[1]!.unitId, enemyAt.x, enemyAt.y);
    return s;
  };
  const NEAR = { x: 5, y: 7 };   // inside VISION_RANGE
  const FAR = { x: 20, y: 7 };   // well outside it
  const enemyId = (s: GameState) => s.units[1]!.unitId;

  it('remembers where an enemy was standing while it was visible', () => {
    const s = facing(NEAR);
    const memory = rememberSightings(new Map(), OPEN, s, 0);
    expect(memory.get(sightingKey(0, enemyId(s)))).toEqual(NEAR);
  });

  it('draws no ghost while the enemy is still visible — the real thing is there', () => {
    const s = facing(NEAR);
    const memory = rememberSightings(new Map(), OPEN, s, 0);
    const view = fogView(OPEN, s, 0, memory);
    expect(view.units.map((u) => u.unitId)).toContain(enemyId(s));
    expect(view.ghosts).toEqual([]);
  });

  it('leaves the ghost at the LAST SEEN square once it goes dark', () => {
    // Seen at (5,7), then it walks to (20,7). The ghost stays where it was seen.
    const seenState = facing(NEAR);
    const memory = rememberSightings(new Map(), OPEN, seenState, 0);
    const moved = facing(FAR);
    const view = fogView(OPEN, moved, 0, memory);
    expect(view.units.map((u) => u.unitId)).not.toContain(enemyId(moved)); // hidden
    expect(view.ghosts).toHaveLength(1);
    expect(view.ghosts[0]!.pos).toEqual(NEAR);
  });

  it('the ghost never reports the LIVE position — that is the whole contract', () => {
    const memory = rememberSightings(new Map(), OPEN, facing(NEAR), 0);
    const moved = facing(FAR);
    expect(fogView(OPEN, moved, 0, memory).ghosts[0]!.pos).not.toEqual(FAR);
  });

  it('the ghost moves to the new sighting when the team re-sees it', () => {
    const later = { x: 6, y: 9 };
    let memory = rememberSightings(new Map(), OPEN, facing(NEAR), 0);
    memory = rememberSightings(memory, OPEN, facing(FAR), 0); // out of sight: no update
    expect(memory.get(sightingKey(0, enemyId(facing(NEAR))))).toEqual(NEAR);

    const back = facing(later);
    memory = rememberSightings(memory, OPEN, back, 0);
    expect(memory.get(sightingKey(0, enemyId(back)))).toEqual(later);
    // …and while it is visible again there is no ghost at all.
    expect(fogView(OPEN, back, 0, memory).ghosts).toEqual([]);
  });

  it('an enemy never seen leaves no ghost — you cannot remember what you never saw', () => {
    const s = facing(FAR);
    const memory = rememberSightings(new Map(), OPEN, s, 0);
    expect(fogView(OPEN, s, 0, memory).ghosts).toEqual([]);
  });

  it('a dead enemy leaves no ghost — its corpse is already drawn', () => {
    // `fogView` keeps corpses on the board, so a ghost as well would double it.
    const seen = facing(NEAR);
    const memory = rememberSightings(new Map(), OPEN, seen, 0);
    const dead = facing(FAR);
    dead.units[1]!.alive = false;
    const view = fogView(OPEN, dead, 0, memory);
    expect(view.ghosts).toEqual([]);
    expect(view.units.map((u) => u.unitId)).toContain(enemyId(dead)); // the corpse
  });

  it('the two teams remember separately', () => {
    const s = facing(NEAR);
    const memory = rememberSightings(new Map(), OPEN, s, 0);
    expect(memory.has(sightingKey(0, enemyId(s)))).toBe(true);
    expect(memory.has(sightingKey(1, enemyId(s)))).toBe(false);
  });

  it('never ghosts your OWN units — they are always drawn', () => {
    const s = createMatch(OPEN, '2v2', [[VEX, AEGIS], [AEGIS, VEX]]);
    const [me, ally] = s.units.filter((u) => u.owner === 0);
    at(s, me!.unitId, 2, 7);
    at(s, ally!.unitId, 22, 2); // an ally miles away, still yours
    // Park both enemies out of sight so nothing else can account for the result.
    for (const e of s.units.filter((u) => u.owner === 1)) at(s, e.unitId, 23, 13);
    const memory = rememberSightings(new Map(), OPEN, s, 0);
    const view = fogView(OPEN, s, 0, memory);
    expect(view.ghosts).toEqual([]);
    expect(view.units.map((u) => u.unitId)).toContain(ally!.unitId);
  });

  it('is pure — remembering returns a new map and never mutates the old one', () => {
    // The memo in `app.ts` re-runs `fogView` on every `(state, team)` change; a
    // memory that mutated in place would be impossible to reason about across
    // those repaints, and impossible to test without a render loop.
    const before = new Map<string, { x: number; y: number }>();
    const after = rememberSightings(before, OPEN, facing(NEAR), 0);
    expect(before.size).toBe(0);
    expect(after.size).toBe(1);
    expect(after).not.toBe(before);
  });

  it('with no memory at all it simply draws no ghosts, rather than guessing', () => {
    // The safe direction to fail: a missing ghost tells the player less, never
    // more. `fogView`'s memory argument is optional for exactly this reason.
    expect(fogView(OPEN, facing(FAR), 0).ghosts).toEqual([]);
  });

  it('playback reveals everything, so nothing is a ghost once the turn is history', () => {
    // The trajectory-through-fog half of the Dev Note falls out of this: during
    // playback every unit and every area is drawn, so an attack fired from
    // positional fog animates across the viewer's board without any extra work.
    const seen = facing(NEAR);
    expect(revealedView(facing(FAR), 0).ghosts).toEqual([]);
    expect(revealedView(seen, 0).units.map((u) => u.unitId)).toContain(enemyId(seen));
  });
});
