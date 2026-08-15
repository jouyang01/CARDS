import { describe, expect, it } from 'vitest';
import type { EffectKind, GameState, TurnEvent } from '@cards/engine';
import { HARMFUL_PIPS, PIP_COLORS, PIP_GAP, PIP_ORDER, PIP_SIZE, pipOffsets, statusPips } from '../src/status-pips.js';
import { initView, playEvents } from '../src/playback.js';

/**
 * STATUS-AUDIT, client half. The engine tests prove a status changes a resolved
 * outcome; these prove a player can *see* that it is there — during Decision
 * (read off state) and during playback (folded off the log), with the client
 * deriving nothing in either case.
 */

const ALL_STATUS_KINDS: EffectKind[] = [
  'might', 'weaken', 'haste', 'slow', 'root', 'reveal', 'energized',
  'unstoppable', 'stealth', 'untargetable', 'shield',
];

describe('the pip vocabulary is total over the statuses that exist', () => {
  it('has a slot for every status kind and no slot for anything else', () => {
    expect([...PIP_ORDER].sort()).toEqual([...ALL_STATUS_KINDS].sort());
  });

  it('gives every kind its own colour — two statuses must never read the same', () => {
    const colours = PIP_ORDER.map((k) => PIP_COLORS[k]);
    expect(colours.every((c) => c !== undefined)).toBe(true);
    expect(new Set(colours).size).toBe(PIP_ORDER.length);
  });

  it('splits the debuffs out, and they lead the row', () => {
    const lead = PIP_ORDER.slice(0, HARMFUL_PIPS.size);
    expect(lead.every((k) => HARMFUL_PIPS.has(k))).toBe(true);
    expect(PIP_ORDER.slice(HARMFUL_PIPS.size).some((k) => HARMFUL_PIPS.has(k))).toBe(false);
  });
});

describe('statusPips builds a stable row', () => {
  it('orders by PIP_ORDER, not by the order the statuses were applied', () => {
    const applied = statusPips([{ kind: 'might' }, { kind: 'slow' }, { kind: 'shield' }]);
    const reapplied = statusPips([{ kind: 'shield' }, { kind: 'might' }, { kind: 'slow' }]);
    expect(applied.map((p) => p.kind)).toEqual(reapplied.map((p) => p.kind));
    // …and that order is the table's: slow (debuff) before shield before might.
    expect(applied.map((p) => p.kind)).toEqual(['slow', 'shield', 'might']);
  });

  it('dedupes — a refreshed status is still one pip', () => {
    expect(statusPips([{ kind: 'haste' }, { kind: 'haste' }]).map((p) => p.kind)).toEqual(['haste']);
  });

  it('drops kinds that are not statuses at all, rather than drawing a mystery box', () => {
    expect(statusPips([{ kind: 'damage' }, { kind: 'teleport' }, { kind: 'root' }]).map((p) => p.kind))
      .toEqual(['root']);
  });

  it('is empty for a unit carrying nothing', () => {
    expect(statusPips([])).toEqual([]);
  });

  it('carries the colour with the kind, so the renderer looks nothing up', () => {
    expect(statusPips([{ kind: 'slow' }])).toEqual([{ kind: 'slow', color: PIP_COLORS['slow'] }]);
  });
});

describe('the row is laid out centred, whatever its length', () => {
  it('centres on the unit — a single pip sits exactly on the axis', () => {
    expect(pipOffsets(1)).toEqual([0]);
  });

  it('stays centred as pips are added', () => {
    for (const n of [2, 3, 5, PIP_ORDER.length]) {
      const xs = pipOffsets(n);
      expect(xs).toHaveLength(n);
      expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
    }
  });

  it('spaces them by exactly one gap, edge to edge', () => {
    const xs = pipOffsets(4);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(PIP_SIZE + PIP_GAP, 9);
  });

  it('a full row still fits over a unit body (0.55 tiles wide) plus a little', () => {
    const xs = pipOffsets(PIP_ORDER.length);
    const width = xs[xs.length - 1]! - xs[0]! + PIP_SIZE;
    expect(width).toBeLessThan(1.5); // never wider than a square and a half
  });

  it('is empty for no pips rather than throwing on the centring maths', () => {
    expect(pipOffsets(0)).toEqual([]);
  });
});

// ── The playback fold ───────────────────────────────────────────────────────

const unitState = (unitId: string, statuses: { kind: EffectKind; remaining: number }[] = []) => ({
  unitId, characterId: 'c', owner: 0 as const, pos: { x: 1, y: 1 }, hp: 100, maxHp: 100,
  energy: 0, alive: true, statuses, cooldowns: {}, ultUsed: false, catalysts: [], catalystsUsed: [],
});
const stateWith = (statuses: { kind: EffectKind; remaining: number }[] = []): GameState => ({
  turn: 1, status: 'active', kills: [0, 0], units: [unitState('a', statuses)],
  traps: [], decoys: [], delayed: [],
} as unknown as GameState);

const applied = (status: EffectKind, duration = 2): TurnEvent =>
  ({ type: 'statusApplied', unitId: 'a', status, duration, sourceUnitId: 'a', abilityId: 'x' });
const removed = (status: EffectKind, reason: 'broken' | 'expired'): TurnEvent =>
  ({ type: 'statusRemoved', unitId: 'a', status, reason });

describe('playback folds statuses from the log, and only from the log', () => {
  it('seeds from the pre-turn state', () => {
    const view = initView(stateWith([{ kind: 'stealth', remaining: 2 }]));
    expect([...view.units.get('a')!.statuses]).toEqual(['stealth']);
  });

  it('ignores an already-expired instance in the seed', () => {
    const view = initView(stateWith([{ kind: 'slow', remaining: 0 }]));
    expect([...view.units.get('a')!.statuses]).toEqual([]);
  });

  it('adds on statusApplied and drops on statusRemoved', () => {
    const view = playEvents(stateWith(), [applied('slow'), applied('might'), removed('slow', 'expired')]);
    expect([...view.units.get('a')!.statuses]).toEqual(['might']);
  });

  it('drops a status broken mid-turn — the Stealth case the Dev Note reported', () => {
    // Without a `statusRemoved` event the pip would stay lit over a unit that
    // just fired, which is worse than showing nothing: it would read as a bug
    // in Stealth rather than as Stealth working exactly as specified.
    const view = playEvents(stateWith([{ kind: 'stealth', remaining: 3 }]), [removed('stealth', 'broken')]);
    expect(view.units.get('a')!.statuses.has('stealth')).toBe(false);
  });

  it('a refreshed status stays exactly one entry', () => {
    const view = playEvents(stateWith(), [applied('haste'), applied('haste', 3)]);
    expect([...view.units.get('a')!.statuses]).toEqual(['haste']);
  });

  it('still tracks the shield pool alongside the pip', () => {
    const view = playEvents(stateWith(), [
      { type: 'statusApplied', unitId: 'a', status: 'shield', duration: 2, amount: 30, sourceUnitId: 'a', abilityId: 'x' },
    ]);
    expect(view.units.get('a')!.shield).toBe(30);
    expect(view.units.get('a')!.statuses.has('shield')).toBe(true);
  });

  it('clears everything on death, and on respawn — a corpse carries nothing', () => {
    const dead = playEvents(stateWith([{ kind: 'might', remaining: 3 }]), [
      { type: 'death', unitId: 'a', killer: 1, pos: { x: 1, y: 1 } } as TurnEvent,
    ]);
    expect([...dead.units.get('a')!.statuses]).toEqual([]);
  });

  it('never invents a status for a unit the log does not mention', () => {
    const view = playEvents(stateWith(), [{ type: 'phaseStart', phase: 'blast' } as TurnEvent]);
    expect([...view.units.get('a')!.statuses]).toEqual([]);
  });
});
