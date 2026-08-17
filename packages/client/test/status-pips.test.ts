import { describe, expect, it } from 'vitest';
import { BENEFICIAL_KINDS, HARMFUL_KINDS, type EffectKind, type GameState, type TurnEvent } from '@cards/engine';
import {
  BENEFICIAL_PIPS, HARMFUL_PIPS, PIP_COLORS, PIP_ORDER, PIP_TINT, pipTint, statusPips,
} from '../src/status-pips.js';
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
    expect(statusPips([{ kind: 'slow' }]))
      .toEqual([{ kind: 'slow', color: PIP_COLORS['slow'], tint: PIP_TINT.harmful }]);
  });
});

/**
 * NAMEPLATE-LAYOUT — polarity is the colour (ar-parity §4.8).
 *
 * The point of these is not the two hex values; it is that the *membership*
 * comes from the engine's FF1 table rather than from a list retyped over here.
 * A colour table the engine cannot keep honest is the failure mode this item
 * exists to remove, so the assertions are written against `HARMFUL_KINDS` and
 * `BENEFICIAL_KINDS` and would go red the moment a kind changed sides in the
 * engine and not here.
 */
describe('polarity tint: buffs blue, debuffs red', () => {
  it('tints every harmful drawable status red', () => {
    for (const kind of PIP_ORDER.filter((k) => HARMFUL_KINDS.has(k))) {
      expect(pipTint(kind), kind).toBe(PIP_TINT.harmful);
    }
  });

  it('tints every beneficial drawable status blue', () => {
    for (const kind of PIP_ORDER.filter((k) => BENEFICIAL_KINDS.has(k))) {
      expect(pipTint(kind), kind).toBe(PIP_TINT.beneficial);
    }
  });

  it('and the two are actually different, or nothing above can fail', () => {
    expect(PIP_TINT.harmful).not.toBe(PIP_TINT.beneficial);
  });

  it('covers the whole row — every kind PIP_ORDER draws has a side', () => {
    for (const kind of PIP_ORDER) {
      expect(HARMFUL_KINDS.has(kind) || BENEFICIAL_KINDS.has(kind), kind).toBe(true);
    }
  });

  it('names the sides the owner named: DoT red, HoT blue', () => {
    // The two kinds ar-parity §4.8 calls out by name. Neither is drawable today
    // (they are not in PIP_ORDER), so this pins the *table*, which is the thing
    // that would be wrong if the polarity were retyped instead of derived.
    expect(pipTint('damageOverTime')).toBe(PIP_TINT.harmful);
    expect(pipTint('healOverTime')).toBe(PIP_TINT.beneficial);
  });

  it('derives its debuff set from the engine rather than restating it', () => {
    expect([...HARMFUL_PIPS].sort()).toEqual(PIP_ORDER.filter((k) => HARMFUL_KINDS.has(k)).sort());
    expect([...BENEFICIAL_PIPS].sort()).toEqual(PIP_ORDER.filter((k) => BENEFICIAL_KINDS.has(k)).sort());
    expect([...HARMFUL_PIPS].some((k) => BENEFICIAL_PIPS.has(k)), 'the two sets are disjoint').toBe(false);
  });

  it('and the row carries its tint, so the plate looks nothing up', () => {
    const [debuff, buff] = [statusPips([{ kind: 'root' }])[0]!, statusPips([{ kind: 'might' }])[0]!];
    expect(debuff.tint).toBe(PIP_TINT.harmful);
    expect(buff.tint).toBe(PIP_TINT.beneficial);
    // Identity is still carried alongside it — the HUD strip needs the hue.
    expect(debuff.color).toBe(PIP_COLORS['root']);
  });
});

// ── The playback fold ───────────────────────────────────────────────────────

const unitState = (unitId: string, statuses: { kind: EffectKind; remaining: number }[] = []) => ({
  unitId, characterId: 'c', owner: 0 as const, pos: { x: 1, y: 1 }, hp: 100, maxHp: 100,
  energy: 0, alive: true, statuses, cooldowns: {}, ultUsed: false, catalysts: [], catalystsUsed: [],
});
const stateWith = (statuses: { kind: EffectKind; remaining: number }[] = []): GameState => ({
  turn: 1, status: 'active', kills: [0, 0], units: [unitState('a', statuses)],
  traps: [], decoys: [], delayed: [], powerups: [], lastKnown: [],
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
