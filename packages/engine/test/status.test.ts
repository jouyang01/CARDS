import { describe, expect, it } from 'vitest';
import {
  applyStatus,
  getStatus,
  hasStatus,
  isImmuneTo,
  isStatusKind,
  removeStatus,
  tickStatuses,
  UNSTOPPABLE_BLOCKS,
} from '../src/status.js';
import { makeUnit, status, withStatuses } from './helpers.js';

describe('query helpers', () => {
  it('hasStatus / getStatus ignore expired (remaining 0) instances', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 0, y: 0 }), status('haste', 0), status('might', 2));
    expect(hasStatus(u, 'haste')).toBe(false);
    expect(hasStatus(u, 'might')).toBe(true);
    expect(getStatus(u, 'might')?.remaining).toBe(2);
    expect(getStatus(u, 'slow')).toBeUndefined();
  });

  it('isStatusKind separates timed statuses from instant effects', () => {
    expect(isStatusKind('shield')).toBe(true);
    expect(isStatusKind('unstoppable')).toBe(true);
    expect(isStatusKind('damage')).toBe(false);
    expect(isStatusKind('knockback')).toBe(false);
  });
});

describe('applyStatus — refresh, do not stack', () => {
  it('adds a new status instance', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    applyStatus(u, 'might', 2);
    expect(u.statuses).toEqual([{ kind: 'might', remaining: 2 }]);
  });

  it('refreshes an existing status rather than stacking a second copy', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 0, y: 0 }), status('slow', 1));
    applyStatus(u, 'slow', 3);
    expect(u.statuses.filter((s) => s.kind === 'slow')).toHaveLength(1);
    expect(getStatus(u, 'slow')?.remaining).toBe(3);
  });

  it('carries and replaces an amount for shields', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    applyStatus(u, 'shield', 1, 30);
    expect(getStatus(u, 'shield')).toEqual({ kind: 'shield', remaining: 1, amount: 30 });
    applyStatus(u, 'shield', 2, 50);
    expect(u.statuses.filter((s) => s.kind === 'shield')).toHaveLength(1);
    expect(getStatus(u, 'shield')).toEqual({ kind: 'shield', remaining: 2, amount: 50 });
  });

  it('is a no-op for a non-positive duration', () => {
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    applyStatus(u, 'root', 0);
    expect(u.statuses).toEqual([]);
  });
});

describe('removeStatus', () => {
  it('drops every instance of a kind (Stealth broken by attacking)', () => {
    const u = withStatuses(makeUnit('u', 0, { x: 0, y: 0 }), status('stealth', 1), status('might', 2));
    removeStatus(u, 'stealth');
    expect(hasStatus(u, 'stealth')).toBe(false);
    expect(hasStatus(u, 'might')).toBe(true);
  });
});

describe('tickStatuses — end-of-turn decay', () => {
  it('decrements durations and drops those that reach zero', () => {
    const u = withStatuses(
      makeUnit('u', 0, { x: 0, y: 0 }),
      status('might', 2),
      status('slow', 1),
      status('shield', 1, 20),
    );
    tickStatuses(u);
    expect(getStatus(u, 'might')?.remaining).toBe(1);
    expect(hasStatus(u, 'slow')).toBe(false); // 1 → 0, removed
    expect(hasStatus(u, 'shield')).toBe(false); // shields expire on the same path
  });

  it('a duration-1 status covers exactly the turn it was applied', () => {
    // Applied during resolution, then this same turn's end-of-turn tick removes it.
    const u = makeUnit('u', 0, { x: 0, y: 0 });
    applyStatus(u, 'reveal', 1);
    expect(hasStatus(u, 'reveal')).toBe(true);
    tickStatuses(u);
    expect(hasStatus(u, 'reveal')).toBe(false);
  });

  it('does not mutate the original status objects in place', () => {
    const inst = status('might', 2);
    const u = withStatuses(makeUnit('u', 0, { x: 0, y: 0 }), inst);
    tickStatuses(u);
    expect(inst.remaining).toBe(2); // original untouched; tick copies survivors
  });
});

describe('Unstoppable immunity', () => {
  it('covers exactly knockback, pull, root, slow', () => {
    expect([...UNSTOPPABLE_BLOCKS].sort()).toEqual(['knockback', 'pull', 'root', 'slow']);
  });

  it('isImmuneTo is true for those only when Unstoppable is active', () => {
    const plain = makeUnit('u', 0, { x: 0, y: 0 });
    const unstoppable = withStatuses(makeUnit('v', 0, { x: 0, y: 0 }), status('unstoppable', 2));
    for (const k of ['knockback', 'pull', 'root', 'slow'] as const) {
      expect(isImmuneTo(plain, k)).toBe(false);
      expect(isImmuneTo(unstoppable, k)).toBe(true);
    }
    // Unstoppable does not grant immunity to damage or other statuses
    expect(isImmuneTo(unstoppable, 'damage')).toBe(false);
    expect(isImmuneTo(unstoppable, 'weaken')).toBe(false);
  });
});
