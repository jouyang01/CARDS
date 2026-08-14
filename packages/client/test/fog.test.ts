import { describe, expect, it } from 'vitest';
import { createMatch, VISION_RANGE, type CharacterDef, type MapDef } from '@cards/engine';
import { fogView, revealedView } from '../src/fog.js';
import { dealTeams } from '../src/match-setup.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';
import cinder from '../../../data/characters/cinder.json';
import lumen from '../../../data/characters/lumen.json';
import ravok from '../../../data/characters/ravok.json';
import thorn from '../../../data/characters/thorn.json';
import duelArena from '../../../data/maps/duel-arena.json';
import ironBasin from '../../../data/maps/iron-basin.json';

const DUEL_ARENA = duelArena as unknown as MapDef;
const IRON_BASIN = ironBasin as unknown as MapDef;
/** The same dev draft `main.ts` deals from, so these are the real openings. */
const CATALOG = [vex, bastion, wisp, aegis, cinder, lumen, ravok, thorn] as unknown as CharacterDef[];

/**
 * VISION1 — fog of war during the Decision phase.
 *
 * The engine owns the vision *rules*; these tests only assert that the client
 * asks it and paints the answer. Each setup below is one of the three ways the
 * engine hides a unit — distance, a wall, and brush — so a regression in the
 * wiring shows up whichever mechanism the map uses.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;

/** A map with the two spawns wherever the case under test needs them. */
const map = (over: Partial<MapDef>): MapDef => ({
  id: 't', name: 't', width: 21, height: 9, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 4 }], [{ x: 19, y: 4 }]],
  ...over,
});

const match = (m: MapDef) => createMatch(m, '1v1', [[VEX], [BASTION]]);
const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;

describe('VISION1: the Decision phase shows only what the seat can see', () => {
  it('an enemy beyond sight range is not drawn', () => {
    // 18 apart on an open board; sight reaches 6.
    const m = map({});
    const s = match(m);
    const enemy = s.units.find((u) => u.owner === 1)!;
    expect(enemy.pos.x - s.units.find((u) => u.owner === 0)!.pos.x).toBeGreaterThan(VISION_RANGE);

    const view = fogView(m, s, 0);
    expect(view.units.map((u) => u.unitId)).not.toContain(enemy.unitId);
    expect(view.units.map((u) => u.unitId)).toContain(s.units.find((u) => u.owner === 0)!.unitId);
  });

  it('an enemy in range but behind a wall is not drawn', () => {
    // Face to face 4 apart — inside sight range — with a wall between them.
    const m = map({
      spawns: [[{ x: 8, y: 4 }], [{ x: 12, y: 4 }]],
      walls: [{ x: 10, y: 3 }, { x: 10, y: 4 }, { x: 10, y: 5 }],
    });
    const s = match(m);
    const enemy = s.units.find((u) => u.owner === 1)!;
    expect(fogView(m, s, 0).units.map((u) => u.unitId)).not.toContain(enemy.unitId);

    // Remove the wall and the same two units see each other — proof the wall is
    // what hid it, not the distance.
    const open = map({ spawns: [[{ x: 8, y: 4 }], [{ x: 12, y: 4 }]] });
    expect(fogView(open, match(open), 0).units.map((u) => u.unitId)).toContain(enemy.unitId);
  });

  it('an enemy standing in brush is not drawn, but the brush square is still lit', () => {
    const m = map({ spawns: [[{ x: 8, y: 4 }], [{ x: 11, y: 4 }]], brush: [{ x: 11, y: 4 }] });
    const s = match(m);
    const enemy = s.units.find((u) => u.owner === 1)!;
    const view = fogView(m, s, 0);
    expect(view.units.map((u) => u.unitId)).not.toContain(enemy.unitId);
    // Concealment hides the *unit*, not the terrain: you can see the thicket,
    // which is exactly what makes it worth watching.
    expect(view.fogged.map(key)).not.toContain('11,4');
  });

  it('fogs every square outside team sight, and none inside it', () => {
    const m = map({});
    const s = match(m);
    const view = fogView(m, s, 0);
    const fogged = new Set(view.fogged.map(key));
    expect(fogged.has('1,4')).toBe(false); // the team's own square
    expect(fogged.has('4,4')).toBe(false); // 3 clear of it, still inside sight
    expect(fogged.has('19,4')).toBe(true); // the far spawn, well outside sight
    // Nothing is double-counted and nothing lands off the board.
    expect(fogged.size).toBe(view.fogged.length);
    for (const p of view.fogged) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(m.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(m.height);
    }
  });

  it('the two teams get different views of the same state', () => {
    const m = map({ spawns: [[{ x: 8, y: 4 }], [{ x: 11, y: 4 }]], brush: [{ x: 11, y: 4 }] });
    const s = match(m);
    const hidden = s.units.find((u) => u.owner === 1)!;
    // Brush is deliberately one-way: the unit in it sees out while staying
    // hidden, so team 1 sees team 0 even though team 0 cannot see team 1.
    expect(fogView(m, s, 0).units.map((u) => u.unitId)).not.toContain(hidden.unitId);
    expect(fogView(m, s, 1).units.map((u) => u.unitId)).toContain(hidden.unitId);
  });

  it('a corpse stays on the board once it has been seen', () => {
    const m = map({});
    const s = match(m);
    const enemy = s.units.find((u) => u.owner === 1)!;
    const dead = {
      ...s,
      units: s.units.map((u) => (u.unitId === enemy.unitId ? { ...u, alive: false, hp: 0 } : u)),
    };
    expect(fogView(m, dead, 0).units.map((u) => u.unitId)).toContain(enemy.unitId);
  });
});

describe('VISION1: playback reveals', () => {
  it('the enemy the Decision phase hid is drawn once the turn is history', () => {
    const m = map({ spawns: [[{ x: 8, y: 4 }], [{ x: 11, y: 4 }]], brush: [{ x: 11, y: 4 }] });
    const s = match(m);
    const hidden = s.units.find((u) => u.owner === 1)!;
    expect(fogView(m, s, 0).units.map((u) => u.unitId)).not.toContain(hidden.unitId);

    const revealed = revealedView(s);
    expect(revealed.units.map((u) => u.unitId)).toContain(hidden.unitId);
    expect(revealed.fogged).toEqual([]);
  });
});

/**
 * VISION1-opening — the *first* frame is fogged too.
 *
 * This held by accident before: the controller happened to draw its first
 * Decision frame inside the same task that started the render loop, so it beat
 * the first animation frame. Anything asynchronous landing in between would
 * have flashed the full board. The fix is structural (one `paintFog`, called
 * before the loop starts); these tests pin the data half of it — that turn 1,
 * with no orders entered, hides exactly what any later Decision phase hides.
 */
describe('VISION1-opening: no turn-1 grace reveal', () => {
  it('a fresh match already hides an out-of-sight enemy from the seat on the clock', () => {
    const m = map({}); // spawns 18 apart; sight reaches 6
    const s = match(m);
    const enemy = s.units.find((u) => u.owner === 1)!;
    // Turn 1, nothing planned, nothing resolved — the state the opening frame
    // is drawn from.
    expect(s.turn).toBe(1);
    expect(fogView(m, s, 0).units.map((u) => u.unitId)).not.toContain(enemy.unitId);
  });

  it('the opening frame is the same view a later Decision phase would draw', () => {
    // Nothing about the fog computation is turn-dependent, and this is the
    // assertion that keeps it that way: one code path, one answer.
    const m = map({ spawns: [[{ x: 8, y: 4 }], [{ x: 11, y: 4 }]], brush: [{ x: 11, y: 4 }] });
    const s = match(m);
    const opening = fogView(m, s, 0);
    const laterTurn = fogView(m, { ...s, turn: 7 }, 0);
    expect(opening.units.map((u) => u.unitId)).toEqual(laterTurn.units.map((u) => u.unitId));
    expect(opening.fogged).toEqual(laterTurn.fogged);
  });

  it('both shipped maps open with the enemy team invisible in every format', () => {
    // The concrete promise: on the real content, at match start, no seat can
    // see the other team. Spawn separation is 13 and sight is 6 — but that is
    // a map property, so it is asserted rather than assumed.
    for (const [mapDef, format, perTeam] of [
      [DUEL_ARENA, '2v2', 2], [DUEL_ARENA, '4v4', 4], [IRON_BASIN, '4v4', 4],
    ] as const) {
      const teams = dealTeams(CATALOG, perTeam);
      const s = createMatch(mapDef, format, teams);
      for (const team of [0, 1] as const) {
        const drawn = fogView(mapDef, s, team).units;
        expect(drawn.every((u) => u.owner === team), `${mapDef.id} ${format} team ${team}`).toBe(true);
        expect(drawn).toHaveLength(perTeam);
      }
    }
  });
});
