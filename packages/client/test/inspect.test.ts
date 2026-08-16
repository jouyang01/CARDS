import { describe, expect, it } from 'vitest';
import {
  ULT_COST,
  buildCatalystPool,
  type CatalystData, type CatalystPool, type CharacterDef, type GameState, type MapDef,
  type Roster, type StatusInstance, type TeamId, type UnitState,
} from '@cards/engine';
import { fogView } from '../src/fog.js';
import { inspectDecoy, inspectUnit } from '../src/inspect.js';
import { snapshotDecoy } from '../src/nameplates.js';
import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';
import catalystData from '../../../data/catalysts.json';

/**
 * UI-INSPECT (ar-parity §4.3) — the owner's directive, tested.
 *
 * *"Player can see cooldowns of other characters and the buffs/debuffs/energy/hp
 * status when they have vision of the character."*
 *
 * Two halves. The **reading** is a pure projection of state the client already
 * holds, so it is pinned directly. The **gate** is structural — the panel's
 * candidates are the units `fogView` already handed the renderer — so what is
 * tested there is that the candidate list really does exclude a fogged enemy,
 * not that some boolean was written the right way round. This is the most
 * detailed panel on screen; if any gate in the UI batch is going to be the leak,
 * it is this one.
 */

const VEX = vex as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const roster: Roster = { [VEX.id]: VEX, [WISP.id]: WISP };
const pool: CatalystPool = buildCatalystPool(catalystData as unknown as CatalystData);
const CATS = Object.keys(pool).slice(0, 3);

const OPEN: MapDef = {
  id: 't', name: 't', width: 20, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }], [{ x: 18, y: 7 }]],
};

const unit = (id: string, owner: TeamId, x: number, y: number, over: Partial<UnitState> = {}): UnitState => ({
  unitId: id, characterId: VEX.id, owner, pos: { x, y }, hp: 95, maxHp: 95, energy: 0,
  alive: true, respawnIn: 0, cooldowns: {}, statuses: [] as StatusInstance[],
  catalysts: [...CATS], catalystsUsed: [], ...over,
});

const makeState = (units: UnitState[]): GameState => ({
  turn: 1, units, traps: [], delayed: [], decoys: [], powerups: [], lastKnown: [],
  kills: [0, 0], format: '2v2', status: 'active', suddenDeath: false,
});

const panelFor = (u: UnitState, viewer: TeamId = 0) => inspectUnit(u, roster, pool, viewer)!;

describe('UI-INSPECT: the five slots and their cooldowns', () => {
  it('lists every ability plus the ultimate, in kit order', () => {
    const panel = panelFor(unit('vex-t0-0', 0, 2, 2));
    expect(panel.abilities.map((a) => a.id))
      .toEqual([...VEX.abilities.map((a) => a.id), VEX.ultimate.id]);
    expect(panel.abilities.filter((a) => a.isUlt)).toHaveLength(1);
  });

  it('reports the current cooldown number, which is the whole ask', () => {
    const first = VEX.abilities[0]!.id;
    const panel = panelFor(unit('vex-t0-0', 0, 2, 2, { cooldowns: { [first]: 2 } }));
    expect(panel.abilities.find((a) => a.id === first)).toMatchObject({ cooldown: 2, ready: false });
  });

  it('an ability off cooldown reads ready', () => {
    const panel = panelFor(unit('vex-t0-0', 0, 2, 2));
    expect(panel.abilities.filter((a) => !a.isUlt).every((a) => a.ready)).toBe(true);
  });

  it('the ultimate is not ready merely because it is off cooldown', () => {
    // "Can that character do the thing to me this turn" is the question, and for
    // an ult the answer is about energy, not cooldown.
    const flat = panelFor(unit('vex-t0-0', 0, 2, 2, { energy: 0 }));
    expect(flat.abilities.find((a) => a.isUlt)).toMatchObject({ cooldown: 0, ready: false });

    const charged = panelFor(unit('vex-t0-0', 0, 2, 2, { energy: ULT_COST }));
    expect(charged.abilities.find((a) => a.isUlt)?.ready).toBe(true);
    expect(charged.ult).toBe(true);
  });

  it('carries the phase each slot resolves in', () => {
    const panel = panelFor(unit('vex-t0-0', 0, 2, 2));
    for (const a of panel.abilities) expect(a.phase).toBeTruthy();
  });
});

describe('UI-INSPECT: catalysts remaining vs spent', () => {
  it('lists all three, whether or not they are gone', () => {
    // Spent slots stay listed and grey out: "what have they already burned" is
    // half the read, and an empty row cannot answer it.
    const panel = panelFor(unit('vex-t0-0', 0, 2, 2, { catalystsUsed: [CATS[0]!] }));
    expect(panel.catalysts).toHaveLength(3);
    expect(panel.catalysts.find((c) => c.id === CATS[0])?.spent).toBe(true);
    expect(panel.catalysts.find((c) => c.id === CATS[1])?.spent).toBe(false);
  });

  it('names them from the pool rather than echoing the id', () => {
    const panel = panelFor(unit('vex-t0-0', 0, 2, 2));
    expect(panel.catalysts[0]!.name).toBe(pool[CATS[0]!]!.name);
    expect(panel.catalysts[0]!.phase).toBe(pool[CATS[0]!]!.phase);
  });

  it('a catalyst the pool has never heard of still shows, by id', () => {
    const panel = panelFor(unit('vex-t0-0', 0, 2, 2, { catalysts: ['ghost_catalyst'] }));
    expect(panel.catalysts).toEqual([{ id: 'ghost_catalyst', name: 'ghost_catalyst', phase: '', spent: false }]);
  });
});

describe('UI-INSPECT: vitals and statuses', () => {
  it('shows HP, the shield pool and energy', () => {
    const u = unit('vex-t0-0', 0, 2, 2, {
      hp: 40, energy: 55,
      statuses: [{ kind: 'shield', remaining: 2, amount: 20 }],
    });
    expect(panelFor(u)).toMatchObject({ hp: 40, maxHp: 95, shield: 20, energy: 55, ult: false });
  });

  it('shows statuses with their durations', () => {
    const u = unit('vex-t0-0', 0, 2, 2, { statuses: [{ kind: 'slow', remaining: 2 }] });
    expect(panelFor(u).statuses).toMatchObject([{ kind: 'slow', remaining: 2, harmful: true }]);
  });

  it('and hides an enemy\'s Stealth, like every other reader', () => {
    // The panel must not become the one place an enemy's Stealth is spelled out
    // in words after the icon carefully declined to draw it.
    const hidden = unit('wisp-t1-0', 1, 9, 9, {
      characterId: WISP.id,
      statuses: [{ kind: 'stealth', remaining: 1 }, { kind: 'haste', remaining: 1 }],
    });
    expect(panelFor(hidden, 0).statuses.map((s) => s.kind)).toEqual(['haste']);
    expect(panelFor(hidden, 1).statuses.map((s) => s.kind)).toEqual(['haste', 'stealth']);
  });

  it('gives nothing for a character the roster does not know', () => {
    expect(inspectUnit(unit('x-t0-0', 0, 2, 2, { characterId: 'nope' }), roster, pool, 0)).toBeUndefined();
  });
});

describe('UI-INSPECT: the gate is the drawn set, not a flag', () => {
  it('a fogged enemy is not among the inspectable units', () => {
    const far = makeState([unit('vex-t0-0', 0, 1, 7), unit('vex-t1-0', 1, 18, 7)]);
    const view = fogView(OPEN, far, 0, new Map());
    expect(view.units.some((u) => u.owner === 1)).toBe(false);
  });

  it('and the same enemy in sight is', () => {
    const near = makeState([unit('vex-t0-0', 0, 5, 7), unit('vex-t1-0', 1, 8, 7)]);
    const view = fogView(OPEN, near, 0, new Map());
    const enemy = view.units.find((u) => u.owner === 1)!;
    expect(inspectUnit(enemy, roster, pool, 0)?.team).toBe(1);
  });

  it('own units are inspectable regardless of distance', () => {
    const spread = makeState([unit('vex-t0-0', 0, 0, 0), unit('vex-t0-1', 0, 19, 14)]);
    expect(fogView(OPEN, spread, 0, new Map()).units).toHaveLength(2);
  });
});

describe('UI-INSPECT: a decoy answers, and answers with the cast', () => {
  const first = WISP.abilities[0]!.id;
  const cast = makeState([unit('wisp-t1-0', 1, 10, 9, {
    characterId: WISP.id, hp: 44, energy: 30, cooldowns: { [first]: 3 }, catalystsUsed: [CATS[0]!],
  })]);
  const snapshot = snapshotDecoy(cast.units, roster, 1)!;

  it('shows the impersonated character\'s kit, not a refusal', () => {
    // A panel that will not open is a perfect tell — and the louder of the two
    // ways to out a decoy, since the player went looking.
    const panel = inspectDecoy(snapshot, roster, pool, 1)!;
    expect(panel.name).toBe(WISP.name);
    expect(panel.abilities.map((a) => a.id))
      .toEqual([...WISP.abilities.map((a) => a.id), WISP.ultimate.id]);
  });

  it('with cooldowns frozen at the cast, not the real caster\'s live ones', () => {
    const panel = inspectDecoy(snapshot, roster, pool, 1)!;
    expect(panel.abilities.find((a) => a.id === first)?.cooldown).toBe(3);

    // The real Wisp moves on; the decoy's panel does not.
    const later = { ...cast.units[0]!, cooldowns: { [first]: 0 }, hp: 12 };
    const livePanel = inspectUnit(later, roster, pool, 1)!;
    expect(livePanel.abilities.find((a) => a.id === first)?.cooldown).toBe(0);
    expect(inspectDecoy(snapshot, roster, pool, 1)!.hp, 'still the cast-time HP').toBe(44);
  });

  it('and an empty status row — real buffs leak, invented ones are made up', () => {
    expect(inspectDecoy(snapshot, roster, pool, 1)!.statuses).toEqual([]);
    expect(inspectDecoy(snapshot, roster, pool, 1)!.shield).toBe(0);
  });

  it('carries the cast-time catalyst state too, so the two lies agree', () => {
    const panel = inspectDecoy(snapshot, roster, pool, 1)!;
    expect(panel.catalysts.find((c) => c.id === CATS[0])?.spent).toBe(true);
  });

  it('is marked frozen, so nothing downstream mistakes it for live data', () => {
    expect(inspectDecoy(snapshot, roster, pool, 1)!.frozen).toBe(true);
    expect(panelFor(cast.units[0]!, 1).frozen).toBe(false);
  });
});
