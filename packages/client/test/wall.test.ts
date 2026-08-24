import { describe, expect, it } from 'vitest';
import { WALL_ABILITY, panelThrough, panelsFor, panelsFromCues, panelsFromTraps, runsOf } from '../src/wall.js';
import type { Cue } from '../src/choreograph.js';
import type { Vec2 } from '@cards/engine';

/**
 * A Warding Wall is a BARRIER, and a barrier is vertical.
 *
 * It used to be drawn like any other trap — flat markers on four squares, which
 * says "these tiles are dangerous" rather than "there is a thing here". These
 * specs are about the footprint the standing panel is raised from.
 */

const sq = (x: number, y: number): Vec2 => ({ x, y });

describe('panelThrough', () => {
  it('WALL-SPANS-THE-RUN: a horizontal wall runs the length of its squares', () => {
    const panel = panelThrough([sq(3, 5), sq(4, 5), sq(5, 5), sq(6, 5)])!;
    expect(panel.from.y).toBe(5);
    expect(panel.to.y).toBe(5);
    // Outer edge to outer edge, not centre to centre.
    expect(panel.from.x).toBe(2.5);
    expect(panel.to.x).toBe(6.5);
  });

  it('WALL-COVERS-ITS-ENDS: the panel is exactly as wide as the tiles it blocks', () => {
    // Centre-to-centre would leave half a tile of gap at each end, which a
    // player would reasonably read as a way past a wall that has no way past.
    const panel = panelThrough([sq(3, 5), sq(4, 5), sq(5, 5), sq(6, 5)])!;
    expect(panel.to.x - panel.from.x).toBe(4);
  });

  it('WALL-VERTICAL-RUN: a wall turned the other way spans in y', () => {
    const panel = panelThrough([sq(7, 2), sq(7, 3), sq(7, 4)])!;
    expect(panel.from.x).toBe(7);
    expect(panel.from.y).toBe(1.5);
    expect(panel.to.y).toBe(4.5);
  });

  it('WALL-UNORDERED: the squares arrive as a set and are put back in order', () => {
    // Drawing a panel between them in arbitrary order would zigzag.
    const shuffled = panelThrough([sq(6, 5), sq(3, 5), sq(5, 5), sq(4, 5)])!;
    expect(shuffled.from.x).toBe(2.5);
    expect(shuffled.to.x).toBe(6.5);
  });

  it('WALL-SINGLE-TILE: one square still has a face to present', () => {
    const panel = panelThrough([sq(4, 4)])!;
    expect(panel.to.x - panel.from.x).toBe(1);
  });

  it('WALL-EMPTY: no squares, no panel', () => {
    expect(panelThrough([])).toBeUndefined();
  });
});

describe('runsOf', () => {
  it('RUNS-SPLIT: two separate walls do not become one panel through the gap', () => {
    // Otherwise a single face stretches between them, straight through whatever
    // is standing in between.
    const runs = runsOf([sq(1, 1), sq(2, 1), sq(8, 1), sq(9, 1)]);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.length).sort()).toEqual([2, 2]);
  });

  it('RUNS-JOIN: touching squares are one run', () => {
    expect(runsOf([sq(1, 1), sq(2, 1), sq(3, 1)])).toHaveLength(1);
  });

  it('RUNS-ORTHOGONAL-ONLY: a diagonal touch is not a wall joint', () => {
    expect(runsOf([sq(1, 1), sq(2, 2)])).toHaveLength(2);
  });

  it('RUNS-EMPTY: nothing in, nothing out', () => {
    expect(runsOf([])).toEqual([]);
  });
});

describe('panelsFor', () => {
  it('PANELS-PER-RUN: one panel per wall, not one per board', () => {
    const panels = panelsFor([sq(1, 1), sq(2, 1), sq(8, 3), sq(8, 4)]);
    expect(panels).toHaveLength(2);
  });
});

describe('panelsFromTraps', () => {
  it('TRAPS-ONLY-WALLS: an Overwatch Trap is a mine, not a barrier', () => {
    const traps = [
      { pos: sq(3, 3), abilityId: 'overwatch_trap' },
      { pos: sq(5, 5), abilityId: WALL_ABILITY },
      { pos: sq(6, 5), abilityId: WALL_ABILITY },
    ];
    const panels = panelsFromTraps(traps);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.from.x).toBe(4.5);
  });

  it('TRAPS-UNKNOWN-ABILITY: a trap that does not say what laid it raises nothing', () => {
    // `trapPlaced` does not carry the ability, so a trap folded from the event
    // log has no id. Guessing would put a wall wherever a mine went down.
    expect(panelsFromTraps([{ pos: sq(1, 1) }, { pos: sq(2, 1) }])).toEqual([]);
  });
});

describe('panelsFromCues', () => {
  const cast = (t: number, area: Vec2[]): Cue =>
    ({ kind: 'ability', phase: 'prep', t, dur: 1, unitId: 'a', abilityId: WALL_ABILITY, area }) as Cue;

  it('CUE-RAISES: the wall is up from the moment it is cast', () => {
    const cues = [cast(2, [sq(4, 4), sq(5, 4)])];
    expect(panelsFromCues(cues, 2.1)).toHaveLength(1);
  });

  it('CUE-NOT-BEFORE: and not before', () => {
    const cues = [cast(2, [sq(4, 4), sq(5, 4)])];
    expect(panelsFromCues(cues, 1.9)).toEqual([]);
  });

  it('CUE-STAYS: it stands for the rest of the resolution, not one beat', () => {
    const cues = [cast(2, [sq(4, 4), sq(5, 4)])];
    expect(panelsFromCues(cues, 9)).toHaveLength(1);
  });

  it('CUE-ONLY-WALLS: another ability firing raises nothing', () => {
    const other = { kind: 'ability', phase: 'prep', t: 0, dur: 1, unitId: 'a', abilityId: 'shield_bash', area: [sq(1, 1), sq(2, 1)] } as Cue;
    expect(panelsFromCues([other], 1)).toEqual([]);
  });
});
