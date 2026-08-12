import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { makeMap, makeState, makeUnit } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, PlayerOrders, TurnEvent } from '../src/types.js';

// ── A small deterministic match to replay ────────────────────────────────────

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id,
  phase: 'blast',
  shape: 'square',
  range: 8,
  cooldown: 0,
  energyGain: 0,
  effects: [],
  description: over.id,
  ...over,
});

const char: CharacterDef = {
  id: 'test-char',
  name: 'Test',
  archetype: 'firepower',
  maxHp: 100,
  abilities: [
    ability({ id: 'shoot', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'guard', phase: 'prep', shape: 'self', range: 0, energyGain: 6, effects: [{ kind: 'shield', amount: 20, duration: 1 }] }),
    ability({ id: 'blink', phase: 'dash', shape: 'square', range: 4, energyGain: 4, effects: [{ kind: 'teleport' }] }),
    ability({ id: 'noop', phase: 'prep', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'shield', amount: 1, duration: 1 }] }),
};
const ROSTER: Roster = { 'test-char': char };

const MAP = () => makeMap(Array.from({ length: 15 }, () => '.'.repeat(15)), { spawns: [[{ x: 1, y: 7 }], [{ x: 13, y: 7 }]] });

const freshState = (): GameState => makeState([makeUnit('A', 0, { x: 1, y: 7 }), makeUnit('B', 1, { x: 13, y: 7 })]);

/** A fixed 12-turn order log: approach, then trade line shots down row 7. */
function orderLog(): [PlayerOrders, PlayerOrders][] {
  const approach: [PlayerOrders, PlayerOrders] = [
    { team: 0, units: [{ unitId: 'A', sprint: true, movePath: [2, 3, 4, 5, 6].map((x) => ({ x, y: 7 })) }] },
    { team: 1, units: [{ unitId: 'B', sprint: true, movePath: [12, 11, 10, 9, 8].map((x) => ({ x, y: 7 })) }] },
  ];
  const trade: [PlayerOrders, PlayerOrders] = [
    { team: 0, units: [{ unitId: 'A', ability: { abilityId: 'shoot', target: [{ x: 14, y: 7 }] } }] },
    { team: 1, units: [{ unitId: 'B', ability: { abilityId: 'shoot', target: [{ x: 0, y: 7 }] } }] },
  ];
  return [approach, ...Array.from({ length: 11 }, () => trade)];
}

/** Stable, key-sorted stringify so the hash never depends on property order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Play the whole recorded match, returning the final state and full event log. */
function playMatch(): { state: GameState; events: TurnEvent[] } {
  let state = freshState();
  const events: TurnEvent[] = [];
  for (const [o0, o1] of orderLog()) {
    const result = resolveTurn(state, MAP(), [o0, o1], ROSTER);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

describe('determinism harness', () => {
  it('a replayed 12-turn match yields an identical final-state hash across 100 runs', () => {
    const golden = playMatch();
    const goldenHash = stableStringify(golden.state);
    const goldenEvents = stableStringify(golden.events);

    for (let i = 0; i < 100; i++) {
      const run = playMatch();
      expect(stableStringify(run.state), `state diverged on run ${i}`).toBe(goldenHash);
      expect(stableStringify(run.events), `events diverged on run ${i}`).toBe(goldenEvents);
    }
  });

  it('the recorded match actually exercises combat and reaches the turn limit', () => {
    const { state, events } = playMatch();
    expect(state.turn).toBe(13); // 12 turns resolved (turn 12 tie → sudden death → 13)
    expect(events.filter((e) => e.type === 'death').length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'respawn')).toBe(true);
  });
});

// ── Static guard: no nondeterminism/IO in the engine source ──────────────────

describe('engine source stays pure (golden rule #1)', () => {
  it('contains no clock, randomness, crypto or IO', () => {
    const dir = fileURLToPath(new URL('../src', import.meta.url));
    const forbidden = /Math\.random|Date\.now|new Date|performance\.now|\bcrypto\.|\brequire\(|\bprocess\.|\bfetch\(|from '(?:fs|path|os|crypto|node:[a-z]+)'/;
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(`${dir}/${f}`, 'utf8');
      expect(forbidden.test(src), `${f} contains a forbidden nondeterministic/IO token`).toBe(false);
    }
  });
});
