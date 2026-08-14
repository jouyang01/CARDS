// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_LOG_LINES, createCombatLog, type LogNames } from '../src/combat-log.js';
import type { TurnEvent } from '@cards/engine';

/**
 * UI6's panel half: it **accumulates across turns** with a per-turn separator.
 * The entry text itself is covered in `combat-log.test.ts` against real engine
 * output; this pins the accumulation, which is the part a "render the current
 * turn" implementation would silently get wrong.
 */

const names: LogNames = { unit: (id) => id, ability: (id) => id };
const hit = (source: string, target: string, amount: number): TurnEvent =>
  ({ type: 'damage', unitId: target, amount, absorbed: 0, sourceUnitId: source, abilityId: 'shoot' });

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
});

const lines = () => [...root.querySelectorAll('.log-line')].map((n) => n.textContent);
const separators = () => [...root.querySelectorAll('.log-turn')].map((n) => n.textContent);

describe('UI6: the panel accumulates across turns', () => {
  it('keeps earlier turns and adds a separator per turn', () => {
    const log = createCombatLog(root);
    log.appendTurn(1, [hit('a', 'e', 20)], names);
    log.appendTurn(2, [hit('e', 'a', 15), hit('a', 'e', 20)], names);

    expect(separators()).toEqual(['Turn 1', 'Turn 2']);
    expect(lines()).toHaveLength(3); // turn 1 is still there
    expect(lines()[0]).toContain('a hit e for 20');
    expect(lines()[1]).toContain('e hit a for 15');
    expect(log.entries()).toHaveLength(3);
  });

  it('adds no separator for a turn in which nothing happened', () => {
    const log = createCombatLog(root);
    log.appendTurn(1, [hit('a', 'e', 20)], names);
    log.appendTurn(2, [{ type: 'phaseStart', phase: 'prep' }], names); // a quiet turn
    log.appendTurn(3, [hit('a', 'e', 20)], names);
    expect(separators()).toEqual(['Turn 1', 'Turn 3']);
  });

  it('tags each line with its tone so the panel colours without parsing text', () => {
    const log = createCombatLog(root);
    log.appendTurn(1, [
      hit('a', 'e', 20),
      { type: 'heal', unitId: 'a', amount: 10, sourceUnitId: 'doc', abilityId: 'mend' },
      { type: 'death', unitId: 'e', killer: 0 },
    ], names);
    expect([...root.querySelectorAll('.log-line')].map((n) => n.className))
      .toEqual(['log-line damage', 'log-line heal', 'log-line death']);
  });
});

describe('UI6-cap: the panel is bounded so a long session cannot grow forever', () => {
  it('keeps the most recent lines and drops the oldest', () => {
    const log = createCombatLog(root);
    // Two lines per turn, well past the cap.
    const turns = MAX_LOG_LINES; // → 2x MAX_LOG_LINES lines before trimming
    for (let t = 1; t <= turns; t++) log.appendTurn(t, [hit('a', 'e', t), hit('e', 'a', t)], names);

    expect(root.querySelectorAll('.log-line').length + root.querySelectorAll('.log-turn').length)
      .toBeLessThanOrEqual(MAX_LOG_LINES);
    // The newest turn survives; the first does not.
    expect(separators()).toContain(`Turn ${turns}`);
    expect(separators()).not.toContain('Turn 1');
    expect(log.entries().length).toBeLessThanOrEqual(MAX_LOG_LINES);
  });

  it('never leaves a turn separator with nothing under it', () => {
    const log = createCombatLog(root);
    for (let t = 1; t <= MAX_LOG_LINES; t++) log.appendTurn(t, [hit('a', 'e', t)], names);
    const kinds = [...root.querySelectorAll('.log-list > *')].map((n) => n.className);
    for (const [i, kind] of kinds.entries()) {
      if (kind !== 'log-turn') continue;
      expect(kinds[i + 1], 'a separator must be followed by at least one line').not.toBe('log-turn');
    }
  });

  it('leaves a normal match untouched — the cap is a backstop, not a feature', () => {
    // A 20-turn 4v4 is a couple of hundred lines; nothing should be trimmed.
    const log = createCombatLog(root);
    for (let t = 1; t <= 20; t++) {
      log.appendTurn(t, Array.from({ length: 8 }, (_, i) => hit(`a${i}`, `e${i}`, 10)), names);
    }
    expect(separators()).toContain('Turn 1');
    expect(log.entries()).toHaveLength(160);
  });
});
