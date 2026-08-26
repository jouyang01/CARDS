import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import type { AbilityDef, CharacterDef, GameState, MapDef } from '../src/types.js';

/**
 * BASTION-RAM-LINE — *"Bastion's Ram Charge should be a linear aoe dash that
 * affects all players in a line, not just the first enemy hit."*
 *
 * One data field. `hits: "all"` has existed since FF1-charge, is
 * validated, and is read at the charge's own resolution site; Kestrel's Tempest
 * Run already uses it. Ram Charge simply never asked for it, so a charge through
 * three bodies stopped mattering after the first.
 *
 * A test rather than a shrug, because "the field exists" and "this ability
 * carries it" are different claims and only the second one is the item. The
 * `first`-vs-`all` distinction is also invisible in a one-enemy fixture — which
 * is every fixture unless you write one on purpose — so the run below is
 * deliberately a queue of three.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const BASTION = load('bastion');
const VEX = load('vex');
const RAM: AbilityDef = BASTION.abilities.find((a) => a.id === 'ram_charge')!;
const DAMAGE = RAM.effects.find((e) => e.kind === 'damage')!.amount!;

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 2, y: 10 }, { x: 2, y: 12 }, { x: 2, y: 8 }, { x: 2, y: 14 }],
    [{ x: 18, y: 10 }, { x: 18, y: 12 }, { x: 18, y: 8 }, { x: 18, y: 14 }],
  ],
};
const roster: Roster = { bastion: BASTION, vex: VEX };
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;

/** Bastion at (8,10) with three enemies queued up east of him at 9, 10, 11. */
const queue = () => {
  const state = createMatch(OPEN, '4v4', [
    [BASTION, VEX, VEX, VEX], [VEX, VEX, VEX, VEX],
  ]);
  const me = state.units.find((u) => u.characterId === 'bastion')!;
  const mine = state.units.filter((u) => u.owner === 0 && u.unitId !== me.unitId);
  const foes = state.units.filter((u) => u.owner === 1);
  me.pos = { x: 8, y: 10 };
  foes[0]!.pos = { x: 9, y: 10 };
  foes[1]!.pos = { x: 10, y: 10 };
  foes[2]!.pos = { x: 11, y: 10 };
  foes[3]!.pos = { x: 20, y: 0 }; // parked
  mine.forEach((u, i) => { u.pos = { x: 0, y: i }; }); // teammates well clear
  return { state, me, foes };
};

const charge = (state: GameState, meId: string) => resolveTurn(state, OPEN, [
  {
    team: 0,
    units: [{
      unitId: meId,
      ability: {
        abilityId: RAM.id,
        target: [{ x: 9, y: 10 }, { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }],
      },
    }],
  },
  { team: 1, units: [] },
], roster);

describe('BASTION-RAM-LINE: the charge hits everyone in the line', () => {
  it('the ability carries `hits: "all"`', () => {
    // The item, as data. Asserted on the JSON because a test that only checked
    // the resolution would pass just as well if somebody special-cased Bastion
    // in the engine.
    expect(RAM.hits).toBe('all');
    expect(RAM.shape, 'still a charge, not a teleport').toBe('path');
  });

  it('all three enemies in the queue take the damage, not just the first', () => {
    // The `first`-vs-`all` distinction is invisible with one enemy on the board,
    // which is why there are three.
    const { state, me, foes } = queue();
    const out = charge(state, me.unitId);
    for (const foe of foes.slice(0, 3)) {
      expect(unit(out.state, foe.unitId).hp, `${foe.unitId} was run over`)
        .toBe(unit(state, foe.unitId).hp - DAMAGE);
    }
  });

  it('and each of them is knocked back — the rider travels with the hit', () => {
    // `knockback` rides the same effect list, so "hits all" has to mean all of
    // it. A charge that damaged three and shoved one would be the half-fix.
    //
    // TWO enemies here rather than the queue of three, with a gap between them.
    // A blocked shove emits no `displaced` event (edge-cases: the victim stops
    // on the last open square, and if that is where it started, nothing moved),
    // so three shoulder-to-shoulder victims all shoved the same way pile into
    // each other and only the outermost has anywhere to go. That is the
    // knockback rule working, not the charge failing — but it would make this
    // assertion measure the wrong thing.
    const { state, me, foes } = queue();
    foes[1]!.pos = { x: 11, y: 10 };
    foes[2]!.pos = { x: 19, y: 6 }; // parked; two in the lane, one square apart
    const out = charge(state, me.unitId);
    const shoved = out.events.filter((e) => e.type === 'displaced')
      .map((e) => (e as { unitId: string }).unitId);
    expect(shoved).toContain(foes[0]!.unitId);
    expect(shoved).toContain(foes[1]!.unitId);
  });

  it('the enemy parked off the line is untouched', () => {
    // The guard against "hits all" quietly meaning "hits everyone".
    const { state, me, foes } = queue();
    const out = charge(state, me.unitId);
    expect(unit(out.state, foes[3]!.unitId).hp).toBe(unit(state, foes[3]!.unitId).hp);
  });

  it('a teammate standing in the lane is still run over — FF1 is unchanged', () => {
    // `hits` decides how many of the crossed units are hit, not whose.
    // Friendly fire stays on, which is the price of a charge that goes through
    // everything.
    const { state, me, foes } = queue();
    const mate = state.units.find((u) => u.owner === 0 && u.unitId !== me.unitId)!;
    mate.pos = { x: 10, y: 10 };
    foes[1]!.pos = { x: 19, y: 5 }; // out of the way, so the mate has the square
    const out = charge(state, me.unitId);
    expect(unit(out.state, mate.unitId).hp).toBe(unit(state, mate.unitId).hp - DAMAGE);
  });

  it('the description says every enemy, so the tooltip is not still promising one', () => {
    expect(RAM.description).toMatch(/every enemy/i);
    expect(RAM.description, 'the old "first enemy hit" wording is gone')
      .not.toMatch(/first enemy/i);
  });
});
