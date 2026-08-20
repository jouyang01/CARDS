import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBoard } from '../src/board.js';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { expandShape, wallSquares } from '../src/shapes.js';
import { hasStatus } from '../src/status.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, TurnEvent, Vec2 } from '../src/types.js';

/**
 * WARDING-WALL — *"Change Aegis's Grounding Strike to be a prep phase, 4 cool
 * down skill named Warding Wall which puts down a 4 tile long wall that lasts
 * until the end of this turn that does 25 damage to those who walk through it
 * and weakens them for the next turn."* Plus, the same day: *"Warding Wall
 * should be a freely placed, 4 tile line during prep phase. It will hit dashes,
 * moves, and displacements, but not blinks."*
 *
 * Two genuinely new pieces of engine, and the reason each exists:
 *
 * **A `wall` shape.** `line` was the near miss: it is four tiles in a row, but
 * it starts at the caster and runs away from them, so *where it lands* is
 * decided by where you are standing. "Freely placed" is the whole point of a
 * wall — you put it between them and you, or across the lane they are coming
 * down. So the aim is a square (like a circle's), and the segment is laid
 * **across** the caster's line to it.
 *
 * **A trap that says which arrivals set it off.** Everything else about the
 * hazard is a trap already — placement, expiry, team-exclusion, the rider it
 * applies — but a trap's trigger rule was one global opinion: entry under your
 * own power, never a shove (edge-cases, RULED). A wall disagrees in *both*
 * directions at once. It catches a shove, because being thrown through a
 * barrier is going through it; and it misses a blink, because a blink does not
 * go through anything. Those are coherent readings of "walk through it" for a
 * wall and wrong ones for a mine, so the trap now carries the list and the mines
 * keep the default.
 *
 * The tests below drive the **shipped Aegis**, not a fixture ability, because
 * half the item is the data.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const ALL_CHARACTERS: CharacterDef[] = [
  'aegis', 'bastion', 'cinder', 'kestrel', 'lumen', 'ravok', 'thorn', 'vex', 'wisp',
].map(load);
const AEGIS = load('aegis');
const VEX = load('vex');
const RAVOK = load('ravok');
const WISP = load('wisp');
const WALL: AbilityDef = AEGIS.abilities.find((a) => a.id === 'warding_wall')!;

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }, { x: 3, y: 10 }], [{ x: 18, y: 10 }, { x: 17, y: 10 }]],
};
const BOARD = buildBoard(OPEN);
const roster: Roster = { aegis: AEGIS, vex: VEX, ravok: RAVOK, wisp: WISP };

const unit = (state: GameState, unitId: string) => state.units.find((u) => u.unitId === unitId)!;
const key = (p: Vec2): string => `${p.x},${p.y}`;

describe('WARDING-WALL: the shape is freely placed, and laid across the aim', () => {
  it('is four tiles long, and none of them is the caster\'s own square', () => {
    // The `line` it replaces started under Aegis's feet; this does not touch him.
    const tiles = expandShape(BOARD, WALL, { x: 10, y: 10 }, [{ x: 13, y: 10 }]);
    expect(tiles).toHaveLength(4);
    expect(tiles.map(key)).not.toContain('10,10');
  });

  it('lies ACROSS the caster\'s line to the aim, not along it', () => {
    // Aiming due east puts the wall on a north–south column: one x, four ys.
    // A `line` aimed the same way would have been four xs on one y, which is the
    // difference the whole shape exists for.
    const tiles = expandShape(BOARD, WALL, { x: 10, y: 10 }, [{ x: 13, y: 10 }]);
    expect(new Set(tiles.map((p) => p.x)), 'one column').toEqual(new Set([13]));
    expect(tiles.map((p) => p.y).sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
  });

  it('and rotates with the aim — north puts it on a row', () => {
    const tiles = expandShape(BOARD, WALL, { x: 10, y: 10 }, [{ x: 10, y: 7 }]);
    expect(new Set(tiles.map((p) => p.y)), 'one row').toEqual(new Set([7]));
    expect(tiles.map((p) => p.x).sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
  });

  it('is placed where it is AIMED, anywhere in range — the freely-placed half', () => {
    // Four aims, four different walls, one caster who never moved. Under `line`
    // every one of these would have started at (10,10).
    const from: Vec2 = { x: 10, y: 10 };
    const walls = [{ x: 13, y: 10 }, { x: 10, y: 13 }, { x: 8, y: 8 }, { x: 12, y: 12 }]
      .map((at) => expandShape(BOARD, WALL, from, [at]).map(key).join(' '));
    expect(new Set(walls).size, 'four distinct placements').toBe(4);
    for (const w of walls) expect(w, 'and none of them under the caster').not.toContain('10,10');
  });

  it('drops tiles that fall off the board rather than shortening the aim', () => {
    // A wall laid at the edge is a shorter wall, not an illegal one — the same
    // treatment `circleSquares` gives a disc that overhangs.
    // Cast from the west edge, aimed north: the wall runs east–west across the
    // board's own edge, so its first tile would be at x = -1.
    const tiles = expandShape(BOARD, WALL, { x: 0, y: 10 }, [{ x: 0, y: 7 }]);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(4);
    for (const p of tiles) expect(p.x).toBeGreaterThanOrEqual(0);
  });

  it('covers nothing when aimed at the caster — there is no across', () => {
    expect(expandShape(BOARD, WALL, { x: 10, y: 10 }, [{ x: 10, y: 10 }])).toEqual([]);
  });

  it('`wallSquares` is deterministic — the same call, the same order', () => {
    const a = wallSquares(BOARD, { x: 10, y: 10 }, { x: 1, y: 0 }, 4);
    const b = wallSquares(BOARD, { x: 10, y: 10 }, { x: 1, y: 0 }, 4);
    expect(a).toEqual(b);
    expect(a.map(key)).toEqual(['10,9', '10,10', '10,11', '10,12']);
  });
});

/**
 * A 1v1 field: Aegis at (10,10) and an enemy placed by the test, with the wall
 * cast at (12,10) so it stands as the column x=12, y=9..12.
 */
const field = (enemy: CharacterDef, enemyAt: Vec2) => {
  const state = createMatch(OPEN, '1v1', [[AEGIS], [enemy]]);
  const me = state.units.find((u) => u.owner === 0)!;
  const foe = state.units.find((u) => u.owner === 1)!;
  me.pos = { x: 10, y: 10 };
  foe.pos = { ...enemyAt };
  return { state, me, foe };
};

const WALL_AT: Vec2 = { x: 12, y: 10 };

/** Aegis raises the wall; the enemy does whatever the test says. */
const turn = (
  state: GameState, aegisId: string, enemyOrder: Record<string, unknown> | undefined,
  raise = true,
): { state: GameState; events: TurnEvent[] } => resolveTurn(state, OPEN, [
  {
    team: 0,
    units: raise
      ? [{ unitId: aegisId, ability: { abilityId: WALL.id, target: [{ ...WALL_AT }] } }]
      : [],
  },
  { team: 1, units: enemyOrder === undefined ? [] : [enemyOrder as never] },
], roster);

const hpLost = (before: GameState, after: GameState, unitId: string): number =>
  unit(before, unitId).hp - unit(after, unitId).hp;

/** Where the turn's `trapPlaced` events put traps, sorted — the wall as laid. */
const placedAt = (events: readonly TurnEvent[]): string[] => events
  .flatMap((e) => (e.type === 'trapPlaced' ? [key(e.pos)] : [])).sort();

describe('WARDING-WALL: walking through it costs 25 and a Weaken', () => {
  it('the wall really does stand where the test thinks it does', () => {
    // The fixture, asserted before anything is concluded from it — and read off
    // the **events**, not off `state.traps`, because `lifetime: 1` means the
    // wall is swept at the end of the very turn it goes up. "Lasts until the end
    // of this turn" is exactly a hazard you cannot find in the state afterwards.
    const { state, me } = field(VEX, { x: 14, y: 10 });
    const out = turn(state, me.unitId, undefined);
    expect(placedAt(out.events)).toEqual(['12,10', '12,11', '12,12', '12,9']);
  });

  it('all four tiles are armed — it is a wall, not a mine at the aim', () => {
    // The TRAP-CENTRE generalisation, which is the reusable half of the item.
    const { state, me } = field(VEX, { x: 14, y: 10 });
    const out = turn(state, me.unitId, undefined);
    const placed = out.events.filter((e) => e.type === 'trapPlaced');
    expect(placed, 'four traps from one cast').toHaveLength(4);
    expect(new Set(placed.map((e) => (e as { trapId: string }).trapId)).size,
      'each individually consumable').toBe(4);
  });

  it('an enemy WALKING through takes 25 and is Weakened for the next turn', () => {
    // The sentence the owner wrote, end to end.
    const { state, me, foe } = field(VEX, { x: 14, y: 10 });
    const out = turn(state, me.unitId, {
      unitId: foe.unitId, movePath: [{ x: 13, y: 10 }, { x: 12, y: 10 }],
    });
    expect(hpLost(state, out.state, foe.unitId)).toBe(25);
    // `duration: 2` and not 1, so it survives this turn's end-of-turn tick and
    // is still on them while they act next turn — "weakens them for the NEXT
    // turn" is a promise about a turn that has not happened yet.
    expect(hasStatus(unit(out.state, foe.unitId), 'weaken'), 'still Weakened').toBe(true);
  });

  it('a DASH through it is caught too', () => {
    // Ravok's Bullrush is a `path` charge, so it crosses the wall tile by tile.
    const { state, me, foe } = field(RAVOK, { x: 14, y: 10 });
    const out = turn(state, me.unitId, {
      unitId: foe.unitId,
      ability: { abilityId: 'bullrush', target: [{ x: 13, y: 10 }, { x: 12, y: 10 }] },
    });
    expect(hpLost(state, out.state, foe.unitId)).toBeGreaterThanOrEqual(25);
    expect(hasStatus(unit(out.state, foe.unitId), 'weaken')).toBe(true);
  });

  it('but a BLINK is not — it goes around, not through', () => {
    // The half of the dev note that is a genuine departure from the trap rule:
    // *"It will hit dashes, moves, and displacements, but not blinks."* Wisp's
    // Blink is a teleport, so it arrives on the far side without crossing.
    const { state, me, foe } = field(WISP, { x: 14, y: 10 });
    const out = turn(state, me.unitId, {
      unitId: foe.unitId, ability: { abilityId: 'blink', target: [{ x: 11, y: 10 }] },
    });
    expect(unit(out.state, foe.unitId).pos, 'past the wall').toEqual({ x: 11, y: 10 });
    expect(hpLost(state, out.state, foe.unitId), 'and untouched by it').toBe(0);
    expect(hasStatus(unit(out.state, foe.unitId), 'weaken')).toBe(false);
  });

  it('nor is a blink that lands ON a wall tile', () => {
    // The corner the note does not spell out, ruled the same way for the same
    // reason: the wall hurts what passes through it, and nothing passed.
    const { state, me, foe } = field(WISP, { x: 14, y: 10 });
    const out = turn(state, me.unitId, {
      unitId: foe.unitId, ability: { abilityId: 'blink', target: [{ x: 12, y: 12 }] },
    });
    expect(unit(out.state, foe.unitId).pos).toEqual({ x: 12, y: 12 });
    expect(hpLost(state, out.state, foe.unitId)).toBe(0);
  });

  it('an ORDINARY mine still fires on a blink — the default did not move', () => {
    // The guard on the whole mechanism. `triggers` is opt-in; every shipped trap
    // leaves it unset and keeps the v1 rule, blink landing included.
    const state = createMatch(OPEN, '1v1', [[VEX], [WISP]]);
    const vex = state.units.find((u) => u.owner === 0)!;
    const wisp = state.units.find((u) => u.owner === 1)!;
    vex.pos = { x: 10, y: 10 };
    wisp.pos = { x: 14, y: 10 };
    const armed = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: vex.unitId, freeAbility: { abilityId: 'overwatch_trap', target: [{ x: 12, y: 10 }] } }] },
      { team: 1, units: [] },
    ], roster).state;
    expect(armed.traps, 'the mine is down').toHaveLength(1);
    const blinked = resolveTurn(armed, OPEN, [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: wisp.unitId, ability: { abilityId: 'blink', target: [{ x: 12, y: 10 }] } }] },
    ], roster).state;
    expect(unit(blinked, wisp.unitId).hp, 'blinked onto it and set it off')
      .toBeLessThan(unit(armed, wisp.unitId).hp);
  });
});

describe('WARDING-WALL: a shove through it counts', () => {
  it('a knockback that carries an enemy across the wall triggers it', () => {
    // The other departure from the v1 trap rule, and the reason it is a
    // per-trap list rather than a change to the rule: a mine is something you
    // tread on, so a shove onto one is not your doing — but a wall is something
    // you are pushed *through*.
    //
    // Ravok's Bullrush knocks its victim back 1. Aegis stands west of the wall
    // and charges the enemy standing just west of it, shoving them east through
    // the barrier.
    const state = createMatch(OPEN, '2v2', [[AEGIS, RAVOK], [VEX, VEX]]);
    const aegis = state.units.find((u) => u.characterId === 'aegis')!;
    const ravok = state.units.find((u) => u.characterId === 'ravok')!;
    const foes = state.units.filter((u) => u.owner === 1);
    aegis.pos = { x: 10, y: 7 };  // out of the lane, and within the wall's range 4
    ravok.pos = { x: 9, y: 10 };
    foes[0]!.pos = { x: 11, y: 10 }; // just west of the wall column at x=12
    foes[1]!.pos = { x: 20, y: 0 };  // parked

    const before = state;
    const out = resolveTurn(state, OPEN, [
      {
        team: 0,
        units: [
          { unitId: aegis.unitId, ability: { abilityId: WALL.id, target: [{ x: 12, y: 10 }] } },
          { unitId: ravok.unitId, ability: { abilityId: 'bullrush', target: [{ x: 10, y: 10 }] } },
        ],
      },
      { team: 1, units: [] },
    ], roster);

    const victim = unit(out.state, foes[0]!.unitId);
    expect(victim.pos.x, 'shoved east, onto or past the wall').toBeGreaterThanOrEqual(12);
    // Bullrush's own 14 plus the wall's 25. Asserted as "more than the charge
    // alone" rather than as a total, so a balance pass on Bullrush does not
    // rewrite this test's claim.
    expect(hpLost(before, out.state, foes[0]!.unitId), 'the charge AND the wall')
      .toBeGreaterThan(14);
    expect(hasStatus(victim, 'weaken'), 'and Weakened by the wall').toBe(true);
  });

  it('an ordinary mine now fires on a shove too — TRAP-TRIGGER', () => {
    // **This assertion is reversed.** It shipped in PR #97 as "an ordinary mine
    // still ignores a shove — the RULED v1 behaviour", pinning the carve-out
    // that said a trap only fires on entry under your own power. The owner then
    // ruled the other way: *"Traps should trigger if an enemy is knocked through
    // the trap"*, so `DEFAULT_TRAP_ENTRIES` gained `displacement` and every mine
    // now behaves like the wall did.
    //
    // Kept in this file, next to the wall's version, because the pair is the
    // point: they used to be the two sides of a deliberate difference, and now
    // they agree. What still separates the wall from a mine is the *other*
    // arrival — a blink — which the two tests below and above still hold apart.
    //
    // Same geometry as before: Ravok's Bullrush shoves the victim east onto the
    // mine at (12,10).
    const state = createMatch(OPEN, '2v2', [[VEX, RAVOK], [VEX, VEX]]);
    const trapper = state.units.filter((u) => u.owner === 0).find((u) => u.characterId === 'vex')!;
    const ravok = state.units.find((u) => u.characterId === 'ravok')!;
    const foes = state.units.filter((u) => u.owner === 1);
    trapper.pos = { x: 10, y: 7 }; // within Overwatch Trap's range 4 of (12,10)
    ravok.pos = { x: 9, y: 10 };
    foes[0]!.pos = { x: 11, y: 10 };
    foes[1]!.pos = { x: 20, y: 0 };

    const armed = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: trapper.unitId, freeAbility: { abilityId: 'overwatch_trap', target: [{ x: 12, y: 10 }] } }] },
      { team: 1, units: [] },
    ], roster).state;
    expect(armed.traps).toHaveLength(1);

    const shoved = resolveTurn(armed, OPEN, [
      { team: 0, units: [{ unitId: ravok.unitId, ability: { abilityId: 'bullrush', target: [{ x: 10, y: 10 }] } }] },
      { team: 1, units: [] },
    ], roster);
    expect(shoved.state.traps, 'the mine is spent').toHaveLength(0);
    // More than Bullrush's own 14, so the extra is the mine and not the charge.
    // Read as an inequality rather than a total, so a balance pass on either
    // number does not rewrite the claim.
    expect(hpLost(armed, shoved.state, foes[0]!.unitId), 'the charge AND the mine')
      .toBeGreaterThan(14);
    expect(shoved.events.some((e) => e.type === 'trapTriggered'), 'and it really fired')
      .toBe(true);
  });

  it('and every shipped mine inherits that default — only the wall opts out', () => {
    // The resolution test above proves the DEFAULT fires on a shove; this proves
    // which abilities are on it. Named as a sweep of the data rather than as
    // three near-identical resolution tests (Vex's Overwatch Trap, Thorn's
    // Barbed Sling and Snare Bloom), so a fourth trap added tomorrow is covered
    // the day it lands instead of the day somebody remembers.
    const trapping = ALL_CHARACTERS.flatMap((c) => [...c.abilities, c.ultimate]
      .flatMap((a) => a.effects
        .filter((e) => e.kind === 'trap')
        .map((e) => ({ where: `${c.id}.${a.id}`, triggers: e.triggers }))));
    expect(trapping.length, 'the roster really does carry traps').toBeGreaterThanOrEqual(3);
    for (const { where, triggers } of trapping) {
      if (where === 'aegis.warding_wall') {
        expect(triggers, 'the wall is the one authored exception')
          .toEqual(['move', 'dash', 'displacement']);
      } else {
        expect(triggers, `${where} takes the default, so it fires on a shove`).toBeUndefined();
      }
    }
  });

  it('but a blink PAST a mine still leaves it armed', () => {
    // The other half of the owner's ruling: *"Trap should not trigger if enemy
    // blinks PAST the trap."* It needs no rule of its own — a teleport calls
    // `triggerTrapsOnEntry` once, at its landing square, so a mine it flew over
    // was never offered the chance. Which is exactly why the ruling is about
    // **crossing** rather than about whose idea the movement was: a shove drags
    // you over every square in between; a blink occupies only where it lands.
    const state = createMatch(OPEN, '2v2', [[VEX, RAVOK], [WISP, VEX]]);
    const trapper = state.units.filter((u) => u.owner === 0).find((u) => u.characterId === 'vex')!;
    const wisp = state.units.find((u) => u.characterId === 'wisp')!;
    const spare = state.units.filter((u) => u.owner === 1).find((u) => u.characterId === 'vex')!;
    trapper.pos = { x: 10, y: 7 };
    wisp.pos = { x: 14, y: 10 };
    spare.pos = { x: 20, y: 0 };

    const armed = resolveTurn(state, OPEN, [
      { team: 0, units: [{ unitId: trapper.unitId, freeAbility: { abilityId: 'overwatch_trap', target: [{ x: 12, y: 10 }] } }] },
      { team: 1, units: [] },
    ], roster).state;
    expect(armed.traps, 'the mine is down at (12,10)').toHaveLength(1);

    // From (14,10) to (11,10): straight over the mine, landing one square past.
    const blinked = resolveTurn(armed, OPEN, [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: wisp.unitId, ability: { abilityId: 'blink', target: [{ x: 11, y: 10 }] } }] },
    ], roster);
    expect(unit(blinked.state, wisp.unitId).pos, 'landed beyond it').toEqual({ x: 11, y: 10 });
    expect(blinked.state.traps, 'and the mine is still waiting').toHaveLength(1);
    expect(hpLost(armed, blinked.state, wisp.unitId), 'untouched').toBe(0);
  });
});

describe('WARDING-WALL: whose wall it is, and how long it stands', () => {
  it('the caster\'s own team walks through it unharmed', () => {
    // Not new — the trap's team-exclusion has always done this — pinned because
    // a four-tile hazard in your own half is where it would be noticed.
    const state = createMatch(OPEN, '2v2', [[AEGIS, VEX], [VEX, VEX]]);
    const aegis = state.units.find((u) => u.characterId === 'aegis')!;
    const mate = state.units.filter((u) => u.owner === 0).find((u) => u.characterId === 'vex')!;
    const foes = state.units.filter((u) => u.owner === 1);
    aegis.pos = { x: 10, y: 10 };
    mate.pos = { x: 14, y: 10 };
    foes.forEach((f, i) => { f.pos = { x: 20, y: i }; });

    const before = state;
    const out = resolveTurn(state, OPEN, [
      {
        team: 0,
        units: [
          { unitId: aegis.unitId, ability: { abilityId: WALL.id, target: [{ ...WALL_AT }] } },
          { unitId: mate.unitId, movePath: [{ x: 13, y: 10 }, { x: 12, y: 10 }] },
        ],
      },
      { team: 1, units: [] },
    ], roster);
    expect(unit(out.state, mate.unitId).pos, 'walked right through').toEqual({ x: 12, y: 10 });
    expect(hpLost(before, out.state, mate.unitId), 'unscratched').toBe(0);
    expect(out.events.some((e) => e.type === 'trapTriggered'), 'nothing fired at all').toBe(false);
  });

  it('it is gone at the end of the turn it was raised', () => {
    // *"lasts until the end of this turn"* — `lifetime: 1`, measured the way a
    // `duration: 1` status is: `expiresOnTurn = placedTurn`, so the end-of-turn
    // sweep takes it the same turn it went up. The four `trapExpired` events are
    // what say it was really there and really left, rather than never placed.
    const { state, me } = field(VEX, { x: 18, y: 10 });
    const out = turn(state, me.unitId, undefined);
    expect(placedAt(out.events), 'up during the placement turn').toHaveLength(4);
    expect(out.events.filter((e) => e.type === 'trapExpired'), 'and swept at its end')
      .toHaveLength(4);
    expect(out.state.traps, 'nothing left standing').toHaveLength(0);
  });

  it('so an enemy walking the same line next turn walks free', () => {
    const { state, me, foe } = field(VEX, { x: 14, y: 10 });
    const raised = turn(state, me.unitId, undefined).state;
    const after = resolveTurn(raised, OPEN, [
      { team: 0, units: [] },
      { team: 1, units: [{ unitId: foe.unitId, movePath: [{ x: 13, y: 10 }, { x: 12, y: 10 }] }] },
    ], roster);
    expect(unit(after.state, foe.unitId).pos).toEqual({ x: 12, y: 10 });
    expect(hpLost(raised, after.state, foe.unitId), 'nothing there any more').toBe(0);
    expect(after.events.some((e) => e.type === 'trapTriggered'), 'and nothing fired').toBe(false);
  });

  it('it is a hazard, not a blocker — the walk finishes on the far side', () => {
    // Explicitly out of scope for this item, and easy to implement by accident:
    // the wall must not halt movement or block line of sight. The mover crosses
    // it, pays, and keeps going.
    const { state, me, foe } = field(VEX, { x: 14, y: 10 });
    const out = turn(state, me.unitId, {
      unitId: foe.unitId, movePath: [{ x: 13, y: 10 }, { x: 12, y: 10 }, { x: 11, y: 10 }],
    });
    expect(unit(out.state, foe.unitId).pos, 'came out the other side').toEqual({ x: 11, y: 10 });
    expect(hpLost(state, out.state, foe.unitId)).toBe(25);
  });

  it('crossing it once costs once, however far the walk goes', () => {
    // Each tile is its own trap and each is consumed on firing, so a walk
    // straight through pays 25 — not 25 a step.
    const { state, me, foe } = field(VEX, { x: 16, y: 10 });
    const out = turn(state, me.unitId, {
      unitId: foe.unitId,
      movePath: [{ x: 15, y: 10 }, { x: 14, y: 10 }, { x: 13, y: 10 }, { x: 12, y: 10 }],
    });
    expect(hpLost(state, out.state, foe.unitId)).toBe(25);
    expect(out.events.filter((e) => e.type === 'trapTriggered'), 'one tile fired').toHaveLength(1);
    expect(out.events.filter((e) => e.type === 'trapExpired'), 'the other three simply expired')
      .toHaveLength(3);
  });
});

describe('WARDING-WALL: the ability the owner asked for', () => {
  it('is Prep, cooldown 4, four tiles, and no longer a Blast', () => {
    expect(WALL.phase).toBe('prep');
    expect(WALL.cooldown).toBe(4);
    expect(WALL.wallLength).toBe(4);
    expect(WALL.shape).toBe('wall');
    expect(AEGIS.abilities.some((a) => a.id === 'grounding_strike'), 'replaced, not added')
      .toBe(false);
  });

  it('deals 25 and weakens for 2 — the numbers, read off the data', () => {
    const trap = WALL.effects.find((e) => e.kind === 'trap')!;
    expect(trap.amount).toBe(25);
    expect(trap.lifetime, 'this turn only').toBe(1);
    expect(trap.perTile, 'one per tile, not one at the aim').toBe(true);
    expect(trap.triggers, 'the owner\'s sentence, as data')
      .toEqual(['move', 'dash', 'displacement']);
    expect(WALL.effects.find((e) => e.kind === 'weaken')?.duration).toBe(2);
  });

  it('the description tells the player which arrivals it catches', () => {
    expect(WALL.description).toMatch(/blink/i);
    expect(WALL.description).toContain('25');
  });
});
