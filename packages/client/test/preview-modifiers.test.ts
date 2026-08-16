import { describe, expect, it } from 'vitest';
import {
  buildBoard, computeDamage, createMatch, isBehindCover,
  type AbilityDef, type Board, type CharacterDef, type GameState, type MapDef,
} from '@cards/engine';
import { abilityPreview } from '../src/targeting.js';
import { previewNumbers } from '../src/preview-numbers.js';
import vex from '../../../data/characters/vex.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * PREVIEW-MODIFIERS — the damage preview shows what the hit would actually deal.
 *
 * Owner Dev Note: *"Should account for Might + Cover + Weakness."* A nominal 20
 * over a target in cover is wrong by half, and a player who plans around it
 * learns that the preview lies — which is worse than no preview, because they
 * trusted it once.
 *
 * The assertion that matters is not "the number went up" but that it matches a
 * **direct `computeDamage` call**. The client must not own a second copy of the
 * damage math: a preview that agrees with the resolution by coincidence will
 * stop agreeing the first time either side is touched.
 */

const VEX = vex as unknown as CharacterDef;
const AEGIS = aegis as unknown as CharacterDef;

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 5 }], [{ x: 13, y: 7 }, { x: 13, y: 5 }]],
};
/** The same board with one cover square, so a target can hide behind it. */
const COVERED: MapDef = { ...OPEN, cover: [{ x: 8, y: 7 }] };

const ability = (c: CharacterDef, id: string): AbilityDef =>
  [...c.abilities, c.ultimate].find((a) => a.id === id)!;
const RAIL = ability(VEX, 'rail_shot');
const NOMINAL = RAIL.effects.find((e) => e.kind === 'damage')!.amount!;

const match = (map: MapDef): GameState => createMatch(map, '2v2', [[VEX, AEGIS], [AEGIS, VEX]]);
const at = (s: GameState, unitId: string, x: number, y: number): void => {
  s.units.find((u) => u.unitId === unitId)!.pos = { x, y };
};
const allSeen = (s: GameState): Set<string> => new Set(s.units.map((u) => u.unitId));

/** Vex at (2,7) firing east; the first enemy parked wherever the case needs. */
const firingLine = (map: MapDef, enemyX: number) => {
  const s = match(map);
  const caster = s.units.find((u) => u.characterId === 'vex' && u.owner === 0)!;
  const enemy = s.units.find((u) => u.owner === 1)!;
  at(s, caster.unitId, 2, 7);
  at(s, enemy.unitId, enemyX, 7);
  // Park the other two well clear so only the intended target is in the beam.
  for (const u of s.units) if (u.unitId !== caster.unitId && u.unitId !== enemy.unitId) u.pos = { x: 1, y: 1 };
  return { s, board: buildBoard(map), caster, enemy };
};

const damageOn = (s: GameState, board: Board, casterId: string, targetId: string): number | undefined => {
  const caster = s.units.find((u) => u.unitId === casterId)!;
  const shown = previewNumbers(
    s, board, caster,
    [{ def: RAIL, squares: abilityPreview(board.map, caster, RAIL, [{ x: 14, y: 7 }]) }],
    allSeen(s),
  );
  return shown.find((n) => n.targetId === targetId && n.kind === 'damage')?.amount;
};

describe('PREVIEW-MODIFIERS: Might and Weaken move the number', () => {
  it('a Might\'d attacker previews more than nominal', () => {
    const { s, board, caster, enemy } = firingLine(OPEN, 7);
    const before = damageOn(s, board, caster.unitId, enemy.unitId);
    expect(before).toBe(NOMINAL);

    s.units.find((u) => u.unitId === caster.unitId)!.statuses.push({ kind: 'might', remaining: 2 });
    const after = damageOn(s, board, caster.unitId, enemy.unitId);
    expect(after).toBeGreaterThan(NOMINAL);
  });

  it('a Weakened attacker previews less', () => {
    const { s, board, caster, enemy } = firingLine(OPEN, 7);
    s.units.find((u) => u.unitId === caster.unitId)!.statuses.push({ kind: 'weaken', remaining: 2 });
    expect(damageOn(s, board, caster.unitId, enemy.unitId)).toBeLessThan(NOMINAL);
  });

  it('and both at once net out exactly as the engine says', () => {
    const { s, board, caster, enemy } = firingLine(OPEN, 7);
    const attacker = s.units.find((u) => u.unitId === caster.unitId)!;
    attacker.statuses.push({ kind: 'might', remaining: 2 }, { kind: 'weaken', remaining: 2 });
    expect(damageOn(s, board, caster.unitId, enemy.unitId))
      .toBe(computeDamage(NOMINAL, attacker, false));
  });

  it('the number is the engine\'s, not a second implementation of it', () => {
    // The whole point. A preview that agrees by coincidence stops agreeing the
    // first time either side is touched.
    const { s, board, caster, enemy } = firingLine(OPEN, 7);
    const attacker = s.units.find((u) => u.unitId === caster.unitId)!;
    attacker.statuses.push({ kind: 'might', remaining: 1 });
    expect(damageOn(s, board, caster.unitId, enemy.unitId))
      .toBe(computeDamage(NOMINAL, attacker, false));
  });

  it('the DEFENDER\'s Might changes nothing — it is an outgoing rule', () => {
    const { s, board, caster, enemy } = firingLine(OPEN, 7);
    s.units.find((u) => u.unitId === enemy.unitId)!.statuses.push({ kind: 'might', remaining: 2 });
    expect(damageOn(s, board, caster.unitId, enemy.unitId)).toBe(NOMINAL);
  });
});

describe('PREVIEW-MODIFIERS: cover halves it, and the preview knows', () => {
  it('a target behind cover previews the reduced number', () => {
    // Cover is pure geometry and knowable at plan time, so there is no excuse
    // for the preview not to know it.
    const { s, board, caster, enemy } = firingLine(COVERED, 9);
    const attacker = s.units.find((u) => u.unitId === caster.unitId)!;
    const target = s.units.find((u) => u.unitId === enemy.unitId)!;
    expect(isBehindCover(board, attacker.pos, target.pos, RAIL.range), 'premise').toBe(true);
    expect(damageOn(s, board, caster.unitId, enemy.unitId))
      .toBe(computeDamage(NOMINAL, attacker, true));
  });

  it('and the same target on open ground previews the full number', () => {
    const { s, board, caster, enemy } = firingLine(OPEN, 9);
    expect(damageOn(s, board, caster.unitId, enemy.unitId)).toBe(NOMINAL);
  });

  it('Might and cover compose in the engine\'s order, each rounded down', () => {
    const { s, board, caster, enemy } = firingLine(COVERED, 9);
    const attacker = s.units.find((u) => u.unitId === caster.unitId)!;
    attacker.statuses.push({ kind: 'might', remaining: 2 });
    expect(damageOn(s, board, caster.unitId, enemy.unitId))
      .toBe(computeDamage(NOMINAL, attacker, true));
  });
});

describe('PREVIEW-MODIFIERS: what it deliberately does NOT do', () => {
  it('does not predict a status that lands this turn', () => {
    // Adrenaline's Might resolves at the start of Blast, after the plan is
    // locked. The preview reflects current state; guessing what the enemy is
    // about to do is worse than being occasionally conservative.
    const { s, board, caster, enemy } = firingLine(OPEN, 7);
    const attacker = s.units.find((u) => u.unitId === caster.unitId)!;
    // A catalyst is *carried*, not active — nothing about it moves the number.
    attacker.catalysts = ['adrenaline'];
    expect(damageOn(s, board, caster.unitId, enemy.unitId)).toBe(NOMINAL);
  });

  it('an expired Might instance does not count', () => {
    const { s, board, caster, enemy } = firingLine(OPEN, 7);
    s.units.find((u) => u.unitId === caster.unitId)!.statuses.push({ kind: 'might', remaining: 0 });
    expect(damageOn(s, board, caster.unitId, enemy.unitId)).toBe(NOMINAL);
  });

  it('does not subtract shields — the number is post-cover damage', () => {
    // Flagged, not required (edge-cases): the owner named Might/Cover/Weaken,
    // and the nameplate shows the shield pool separately.
    const { s, board, caster, enemy } = firingLine(OPEN, 7);
    s.units.find((u) => u.unitId === enemy.unitId)!.statuses.push({ kind: 'shield', remaining: 2, amount: 40 });
    expect(damageOn(s, board, caster.unitId, enemy.unitId)).toBe(NOMINAL);
  });

  it('leaves heals and shields at their authored amounts', () => {
    // Might, Weaken and cover are outgoing-*damage* rules. Applying them to a
    // heal would be the client inventing a mechanic.
    const s = match(OPEN);
    const board = buildBoard(OPEN);
    const medic = s.units.find((u) => u.characterId === 'aegis' && u.owner === 0)!;
    const ally = s.units.find((u) => u.owner === 0 && u.unitId !== medic.unitId)!;
    medic.statuses.push({ kind: 'might', remaining: 2 });
    at(s, medic.unitId, 5, 7);
    at(s, ally.unitId, 6, 7);

    const support = [...AEGIS.abilities, AEGIS.ultimate]
      .find((a) => a.effects.some((e) => e.kind === 'heal' || e.kind === 'shield'))!;
    const effect = support.effects.find((e) => e.kind === 'heal' || e.kind === 'shield')!;
    const shown = previewNumbers(
      s, board, medic,
      [{ def: support, squares: abilityPreview(OPEN, medic, support, [ally.pos]) }],
      allSeen(s),
    );
    const number = shown.find((n) => n.targetId === ally.unitId && n.kind === effect.kind);
    expect(number?.amount).toBe(effect.amount);
  });
});
