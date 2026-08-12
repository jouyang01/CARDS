import { describe, expect, it } from 'vitest';
import { addShield, applyDamage, applyHeal, scaleDamage, scaleEnergyGain } from '../src/combat.js';
import { makeUnit, status, withStatuses } from './helpers.js';
import type { UnitState } from '../src/types.js';

const unit = (over: Partial<UnitState> = {}): UnitState => makeUnit('u', 0, { x: 0, y: 0 }, over);

describe('scaleDamage — Might / Weaken (round down)', () => {
  it('leaves base damage unmodified with no statuses', () => {
    expect(scaleDamage(26, unit())).toBe(26);
  });

  it('adds 25% under Might and drops 25% under Weaken, rounding down', () => {
    expect(scaleDamage(26, withStatuses(unit(), status('might')))).toBe(32); // 32.5 → 32
    expect(scaleDamage(26, withStatuses(unit(), status('weaken')))).toBe(19); // 19.5 → 19
    expect(scaleDamage(10, withStatuses(unit(), status('might')))).toBe(12); // 12.5 → 12
    expect(scaleDamage(10, withStatuses(unit(), status('weaken')))).toBe(7); // 7.5 → 7
  });

  it('nets to base when Might and Weaken are both held (AC: net 0)', () => {
    expect(scaleDamage(26, withStatuses(unit(), status('might'), status('weaken')))).toBe(26);
    expect(scaleDamage(37, withStatuses(unit(), status('weaken'), status('might')))).toBe(37);
  });
});

describe('applyDamage — shields first, then HP', () => {
  it('subtracts straight from HP with no shield', () => {
    const r = applyDamage(unit({ hp: 100 }), 30);
    expect(r).toMatchObject({ hpDamage: 30, absorbed: 0 });
    expect(r.unit.hp).toBe(70);
  });

  it('spends a shield before HP and drops it when empty (AC: shield overflow)', () => {
    const shielded = withStatuses(unit({ hp: 100 }), status('shield', 2, 10));
    const r = applyDamage(shielded, 30);
    expect(r).toMatchObject({ absorbed: 10, hpDamage: 20 });
    expect(r.unit.hp).toBe(80);
    expect(r.unit.statuses.some((s) => s.kind === 'shield')).toBe(false);
  });

  it('keeps a partially spent shield (amount and duration) and spares HP', () => {
    const shielded = withStatuses(unit({ hp: 100 }), status('shield', 3, 30));
    const r = applyDamage(shielded, 10);
    expect(r).toMatchObject({ absorbed: 10, hpDamage: 0 });
    expect(r.unit.hp).toBe(100);
    expect(r.unit.statuses).toEqual([{ kind: 'shield', remaining: 3, amount: 20 }]);
  });

  it('drains multiple shields in order', () => {
    const shielded = withStatuses(unit({ hp: 100 }), status('shield', 1, 5), status('shield', 2, 5));
    const r = applyDamage(shielded, 8);
    expect(r).toMatchObject({ absorbed: 8, hpDamage: 0 });
    expect(r.unit.statuses).toEqual([{ kind: 'shield', remaining: 2, amount: 2 }]);
  });

  it('reports HP actually lost, not overkill, and floors at 0', () => {
    const r = applyDamage(unit({ hp: 20 }), 50);
    expect(r).toMatchObject({ hpDamage: 20, absorbed: 0 });
    expect(r.unit.hp).toBe(0);
  });

  it('does not mutate its input', () => {
    const u = withStatuses(unit({ hp: 100 }), status('shield', 2, 10));
    const before = structuredClone(u);
    applyDamage(u, 30);
    expect(u).toEqual(before);
  });
});

describe('applyHeal — capped at maxHp', () => {
  it('restores up to the cap and never overheals', () => {
    expect(applyHeal(unit({ hp: 50 }), 30, 100)).toMatchObject({ healed: 30 });
    expect(applyHeal(unit({ hp: 90 }), 30, 100)).toMatchObject({ healed: 10 });
    expect(applyHeal(unit({ hp: 100 }), 30, 100)).toMatchObject({ healed: 0 });
  });
});

describe('addShield', () => {
  it('appends a shield status with amount and duration', () => {
    const u = addShield(unit(), 25, 2);
    expect(u.statuses).toContainEqual({ kind: 'shield', remaining: 2, amount: 25 });
  });
});

describe('scaleEnergyGain — Energized (round down)', () => {
  it('banks the base gain unmodified without Energized', () => {
    expect(scaleEnergyGain(8, unit())).toBe(8);
  });

  it('adds 50% under Energized, rounding down', () => {
    expect(scaleEnergyGain(8, withStatuses(unit(), status('energized')))).toBe(12);
    expect(scaleEnergyGain(5, withStatuses(unit(), status('energized')))).toBe(7); // 7.5 → 7
  });
});
