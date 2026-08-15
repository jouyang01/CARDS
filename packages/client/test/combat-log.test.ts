import { describe, expect, it } from 'vitest';
import { resolveTurn, type AbilityDef, type CharacterDef, type GameState, type MapDef, type Roster, type TurnEvent, type UnitOrders } from '@cards/engine';
import { logEntriesForTurn, type LogNames } from '../src/combat-log.js';

/**
 * UI6 — the log names **both ends** of an exchange, which is only expressible
 * because A0/A0-heal put a source on damage, heal and statusApplied. The tests
 * that matter are: a support's contribution is attributed, log order is never
 * re-sorted, and nothing is invented that the events did not state.
 */

const OPEN: MapDef = { id: 't', name: 't', width: 13, height: 13, walls: [], cover: [], brush: [], spawns: [[{ x: 1, y: 6 }], [{ x: 11, y: 6 }]] };
const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'square', range: 8, cooldown: 0, energyGain: 0, effects: [], description: over.id, ...over,
});
const gunner: CharacterDef = {
  id: 'gunner', name: 'Vex', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shoot', name: 'Rail Shot', shape: 'line', range: 8, energyGain: 8, effects: [{ kind: 'damage', amount: 20 }] }),
    ability({ id: 'hex', name: 'Bola', shape: 'circle', range: 6, radius: 1, effects: [{ kind: 'slow', duration: 2 }] }),
  ],
  ultimate: ability({ id: 'ult', name: 'Lance', shape: 'square', range: 8, effects: [{ kind: 'damage', amount: 40 }] }),
};
const medic: CharacterDef = {
  id: 'medic', name: 'Aegis', archetype: 'support', maxHp: 100,
  abilities: [
    ability({ id: 'mend', name: 'Mend', shape: 'circle', range: 6, radius: 1, effects: [{ kind: 'heal', amount: 20 }] }),
    ability({ id: 'ward', name: 'Ward', shape: 'circle', range: 6, radius: 1, effects: [{ kind: 'shield', amount: 30, duration: 2 }] }),
  ],
  ultimate: ability({ id: 'sup-ult', name: 'Dawn', shape: 'circle', range: 8, radius: 2, effects: [{ kind: 'heal', amount: 40 }] }),
};
const roster: Roster = { gunner, medic };

const mkUnit = (unitId: string, characterId: string, owner: 0 | 1, x: number, y: number, over: Partial<GameState['units'][number]> = {}) =>
  ({ unitId, characterId, owner, pos: { x, y }, hp: 100, maxHp: 100, energy: 0, alive: true, respawnIn: 0, cooldowns: {}, statuses: [], catalysts: [], catalystsUsed: [], ...over });
const mkState = (units: GameState['units']): GameState =>
  ({ turn: 1, units, traps: [], delayed: [], decoys: [], powerups: [], kills: [0, 0], format: '2v2', status: 'active', suddenDeath: false });
const run = (s: GameState, u0: UnitOrders[], u1: UnitOrders[]) =>
  resolveTurn(s, OPEN, [{ team: 0, units: u0 }, { team: 1, units: u1 }], roster);

const names = (state: GameState): LogNames => ({
  unit: (unitId) => {
    const u = state.units.find((x) => x.unitId === unitId);
    return u === undefined ? unitId : roster[u.characterId]!.name;
  },
  ability: (abilityId) => {
    for (const c of Object.values(roster)) {
      const found = [...c.abilities, c.ultimate].find((a) => a.id === abilityId);
      if (found !== undefined) return found.name;
    }
    return abilityId;
  },
});

describe('UI6: entries name the actor and the target', () => {
  it('a hit reads "<shooter> hit <victim> for N — <ability>"', () => {
    const s = mkState([mkUnit('a', 'gunner', 0, 2, 6), mkUnit('e', 'gunner', 1, 6, 6)]);
    const { events } = run(s, [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } }], []);
    const lines = logEntriesForTurn(1, events, names(s));
    const hit = lines.find((l) => l.tone === 'damage')!;
    expect(hit.text).toBe('Vex hit Vex for 20 — Rail Shot');
    expect(hit.sourceUnitId).toBe('a');
    expect(hit.unitId).toBe('e');
  });

  it('a HEAL on an ally names the healer — the whole reason A0-heal exists', () => {
    const s = mkState([mkUnit('doc', 'medic', 0, 5, 6), mkUnit('hurt', 'gunner', 0, 6, 6, { hp: 50 }), mkUnit('e', 'gunner', 1, 12, 0)]);
    const { events } = run(s, [{ unitId: 'doc', ability: { abilityId: 'mend', target: [{ x: 6, y: 6 }] } }], []);
    const lines = logEntriesForTurn(1, events, names(s));
    expect(lines.map((l) => l.text)).toContain('Aegis healed Vex for 20 — Mend');
  });

  it('a SHIELD on an ally names the caster: "Aegis shielded Vex for 30"', () => {
    const s = mkState([mkUnit('doc', 'medic', 0, 5, 6), mkUnit('ally', 'gunner', 0, 6, 6), mkUnit('e', 'gunner', 1, 12, 0)]);
    const { events } = run(s, [{ unitId: 'doc', ability: { abilityId: 'ward', target: [{ x: 6, y: 6 }] } }], []);
    expect(logEntriesForTurn(1, events, names(s)).map((l) => l.text)).toContain('Aegis shielded Vex for 30 — Ward');
  });

  it('a SELF heal reads as one actor, not "X healed X"', () => {
    const s = mkState([mkUnit('doc', 'medic', 0, 5, 6, { hp: 40 }), mkUnit('e', 'gunner', 1, 12, 0)]);
    const { events } = run(s, [{ unitId: 'doc', ability: { abilityId: 'mend', target: [{ x: 5, y: 6 }] } }], []);
    const heal = logEntriesForTurn(1, events, names(s)).find((l) => l.tone === 'heal')!;
    expect(heal.text).toBe('Aegis healed for 20 — Mend');
  });

  it('states the absorbed portion, because the log carries it and it is the news', () => {
    const s = mkState([
      mkUnit('doc', 'medic', 0, 5, 6), mkUnit('tank', 'gunner', 0, 6, 6),
      mkUnit('e', 'gunner', 1, 6, 8),
    ]);
    const t1 = run(s, [{ unitId: 'doc', ability: { abilityId: 'ward', target: [{ x: 6, y: 6 }] } }], []);
    const t2 = run(t1.state, [], [{ unitId: 'e', ability: { abilityId: 'shoot', target: [{ x: 6, y: 0 }] } }]);
    const hit = logEntriesForTurn(2, t2.events, names(t1.state)).find((l) => l.tone === 'damage')!;
    expect(hit.text).toContain('absorbed');
  });
});

describe('UI6: it is a pure consumer — it states, never derives', () => {
  it('emits entries in LOG ORDER and never re-sorts them', () => {
    // Two shooters and a healer in one turn: the order the engine resolved them
    // in is the order the reader must see. Sorting by team or magnitude would
    // invent a causality the turn did not have.
    const s = mkState([
      mkUnit('a', 'gunner', 0, 2, 4), mkUnit('doc', 'medic', 0, 2, 8),
      mkUnit('hurt', 'gunner', 0, 3, 8, { hp: 40 }), mkUnit('e', 'gunner', 1, 6, 4),
    ]);
    const { events } = run(s, [
      { unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 4 }] } },
      { unitId: 'doc', ability: { abilityId: 'mend', target: [{ x: 3, y: 8 }] } },
    ], []);
    const lines = logEntriesForTurn(1, events, names(s));

    // Every entry corresponds to an event, in the same relative order.
    const eventOrder = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === 'damage' || e.type === 'heal' || e.type === 'death')
      .map(({ i }) => i);
    expect(eventOrder).toEqual([...eventOrder].sort((x, y) => x - y));
    expect(lines.filter((l) => l.tone === 'damage' || l.tone === 'heal').length).toBe(eventOrder.length);
  });

  it('records deaths and respawns', () => {
    const s = mkState([mkUnit('a', 'gunner', 0, 2, 6), mkUnit('e', 'gunner', 1, 6, 6, { hp: 5 })]);
    const { events } = run(s, [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } }], []);
    const tones = logEntriesForTurn(1, events, names(s)).map((l) => l.tone);
    expect(tones).toContain('death');
  });

  it('drops the reveal spam an attack inflicts on its own attacker', () => {
    // Every damaging attack applies `reveal` to the attacker. A line for it each
    // turn would drown the log, and the damage line already says they attacked.
    const s = mkState([mkUnit('a', 'gunner', 0, 2, 6), mkUnit('e', 'gunner', 1, 6, 6)]);
    const { events } = run(s, [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } }], []);
    expect(events.some((e) => e.type === 'statusApplied' && e.status === 'reveal')).toBe(true);
    expect(logEntriesForTurn(1, events, names(s)).some((l) => l.text.includes('reveal'))).toBe(false);
  });

  it('keeps a notable debuff, with its duration and the ability that applied it', () => {
    const s = mkState([mkUnit('a', 'gunner', 0, 2, 6), mkUnit('e', 'gunner', 1, 6, 6)]);
    const { events } = run(s, [{ unitId: 'a', ability: { abilityId: 'hex', target: [{ x: 6, y: 6 }] } }], []);
    expect(logEntriesForTurn(1, events, names(s)).map((l) => l.text)).toContain('Vex is slow for 2t — Bola');
  });

  it('says nothing about movement, energy or phases — that is not what was asked for', () => {
    const s = mkState([mkUnit('a', 'gunner', 0, 2, 6), mkUnit('e', 'gunner', 1, 11, 6)]);
    const { events } = run(s, [{ unitId: 'a', movePath: [{ x: 3, y: 6 }, { x: 4, y: 6 }] }], []);
    expect(events.some((e) => e.type === 'moveStep')).toBe(true);
    expect(logEntriesForTurn(1, events, names(s))).toEqual([]);
  });

  it('falls back to raw ids rather than throwing on an unknown name', () => {
    const events: TurnEvent[] = [
      { type: 'damage', unitId: 'ghost', amount: 7, absorbed: 0, sourceUnitId: 'phantom', abilityId: 'unknown' },
    ];
    const bare: LogNames = { unit: (id) => id, ability: (id) => id };
    expect(logEntriesForTurn(3, events, bare)[0]!.text).toBe('phantom hit ghost for 7 — unknown');
  });

  it('stamps every entry with the turn it belongs to', () => {
    const s = mkState([mkUnit('a', 'gunner', 0, 2, 6), mkUnit('e', 'gunner', 1, 6, 6)]);
    const { events } = run(s, [{ unitId: 'a', ability: { abilityId: 'shoot', target: [{ x: 12, y: 6 }] } }], []);
    for (const entry of logEntriesForTurn(7, events, names(s))) expect(entry.turn).toBe(7);
  });
});

/**
 * LOG-STATUS — the engine emits `statusRemoved`; UI6 never rendered it, so a
 * Slow looked permanent and a Stealth an attack broke left no trace of breaking.
 * "Why did that only do 40?" now has an answer in the place a player already
 * scrolls back through.
 */
describe('LOG-STATUS: a status leaving is news too', () => {
  const s = mkState([mkUnit('a', 'gunner', 0, 2, 6), mkUnit('b', 'medic', 1, 6, 6)]);
  const naming = names(s);
  const removed = (status: string, reason: 'broken' | 'expired', unitId = 'a'): TurnEvent =>
    ({ type: 'statusRemoved', unitId, status, reason } as unknown as TurnEvent);

  it('logs an expiry in the past tense', () => {
    const [entry] = logEntriesForTurn(3, [removed('haste', 'expired')], naming);
    expect(entry!.text).toBe("Vex's haste wore off");
    expect(entry!.tone).toBe('status');
    expect(entry!.turn).toBe(3);
  });

  it('distinguishes a status BROKEN from one that expired', () => {
    // Different events: one was done to you mid-turn, the other is a clock
    // running out. Collapsing them would lose why the Stealth ended.
    const [entry] = logEntriesForTurn(1, [removed('stealth', 'broken')], naming);
    expect(entry!.text).toBe("Vex's stealth broke");
  });

  it('names the unit it happened to, so the panel can attribute it', () => {
    const [entry] = logEntriesForTurn(1, [removed('slow', 'expired')], naming);
    expect(entry!.unitId).toBe('a');
    // Nobody *caused* an expiry, so there is no source to name — and inventing
    // one would credit the original caster for a clock.
    expect(entry!.sourceUnitId).toBeUndefined();
  });

  it('suppresses the same statuses `statusApplied` suppresses', () => {
    // Reveal fires on every attacker every turn, so it is filtered on the way
    // in; logging it on the way out would be noise with no matching arrival.
    expect(logEntriesForTurn(1, [removed('reveal', 'expired')], naming)).toEqual([]);
    expect(logEntriesForTurn(1, [removed('shield', 'expired')], naming)).toEqual([]);
  });

  it('reads as a pair with the line that applied it', () => {
    const entries = logEntriesForTurn(1, [
      { type: 'statusApplied', unitId: 'a', status: 'slow', duration: 2, sourceUnitId: 'b', abilityId: 'hex' },
      removed('slow', 'expired'),
    ], naming);
    expect(entries.map((e) => e.text)).toEqual([
      'Vex is slow for 2t — Bola',
      "Vex's slow wore off",
    ]);
  });

  it('keeps log order — the engine ticks at end of turn and the log says so', () => {
    const entries = logEntriesForTurn(1, [
      { type: 'damage', unitId: 'a', amount: 10, absorbed: 0, sourceUnitId: 'b', abilityId: 'hex' },
      removed('might', 'expired', 'b'),
    ], naming);
    expect(entries.map((e) => e.tone)).toEqual(['damage', 'status']);
  });
});

describe('board features that leave the board announce themselves', () => {
  // Both of these describe something the player planned around quietly ceasing
  // to be true. Nothing else on screen says so, which is the whole argument for
  // spending a log line on them.
  const naming: LogNames = { unit: () => 'Vex', ability: (id) => id };

  it('a trap that ran out its life gets a neutral line (TRAP-LIFETIME)', () => {
    const entries = logEntriesForTurn(4, [
      { type: 'trapExpired', trapId: 't1', pos: { x: 3, y: 7 }, owner: 0 },
    ], naming);
    expect(entries).toEqual([{ turn: 4, tone: 'neutral', text: 'A trap at (3,7) expired' }]);
  });

  it('a power-up pickup names the taker and the flavour (PADS1)', () => {
    const entries = logEntriesForTurn(2, [
      { type: 'heal', unitId: 'a', amount: 10, sourceUnitId: 'a', abilityId: 'powerup-health' },
      { type: 'powerupTaken', unitId: 'a', pos: { x: 8, y: 7 }, powerup: 'health' },
    ], naming);
    // The heal logs itself; the pickup line says *why*, which is the part worth
    // contesting next turn.
    expect(entries.map((e) => e.text)).toEqual([
      'Vex healed for 10 — powerup-health',
      'Vex took the health power-up at (8,7)',
    ]);
  });
});
