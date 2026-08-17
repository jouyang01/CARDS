import { describe, expect, it } from 'vitest';
import { REVEAL_ON_ATTACK_TURNS, VISION_RANGE } from '../src/constants.js';
import { buildBoard } from '../src/board.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { hasStatus } from '../src/status.js';
import { buildVision, teamCanSee } from '../src/vision.js';
import { makeMap, makeState, makeUnit, status, withStatuses } from './helpers.js';
import type { AbilityDef, CharacterDef, GameState, MapDef, UnitOrders } from '../src/types.js';

/**
 * REVEAL-FIX — you are given away by attacking **only if you were hidden when
 * you attacked**.
 *
 * Owner Dev Note: *"Why are characters being debuffed with 'revealed' when they
 * hit an enemy. This is incorrect … when a character attacks from an area where
 * enemies lack line of sight or vision, attack and movement remain completely
 * hidden."*
 *
 * This **reverses** the 2026-08-31 "dealing damage reveals you whether hidden or
 * not" correction, on the owner's ruling. The old rule was invisible for most of
 * its life — it is a no-op against a positionally-hidden attacker (`canSee` asks
 * about range and line of sight long before it asks about `reveal`) and
 * pointless against an already-visible one — so it cost nothing and nobody
 * noticed. NAMEPLATE-LAYOUT made it *show*, as a red debuff over a unit standing
 * in plain sight, and a debuff you cannot avoid or act on is a worse thing to
 * draw than nothing.
 *
 * Reveal-on-attack now goes through the same `revealIfConcealed` gate
 * CAMO-REVEAL uses, so there is one rule rather than two: **concealment is what
 * a reveal takes away, and you cannot lose what you did not have.**
 *
 * `breakStealth` is untouched (GAME_SPEC §6). Stealth on its own satisfies the
 * concealment gate whatever the tile, so every stealthed attacker still goes
 * through it; the units the gate now skips have no Stealth to break.
 */

/** Brush at x=4..6 on row 10, and a wall column at x=8 to build positional fog. */
const BRUSH_ROW = 10;
const MAP: MapDef = makeMap(
  Array.from({ length: 21 }, (_, y) => (y === BRUSH_ROW ? '....bbb..............' : '.'.repeat(21))),
);
const OPEN: MapDef = makeMap(Array.from({ length: 21 }, () => '.'.repeat(21)));
/** A wall square between the two rows the fog cases use. */
const WALLED: MapDef = makeMap(
  Array.from({ length: 21 }, (_, y) => (y === BRUSH_ROW ? '.......#.............' : '.'.repeat(21))),
);

const ability = (over: Partial<AbilityDef> & Pick<AbilityDef, 'id'>): AbilityDef => ({
  name: over.id, phase: 'blast', shape: 'line', range: 8, cooldown: 0, energyGain: 0,
  effects: [{ kind: 'damage', amount: 20 }], description: over.id, ...over,
});
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [
    ability({ id: 'shot' }),
    // A walked charge that damages what it runs into — the other reveal site.
    ability({ id: 'charge', phase: 'dash', shape: 'path', range: 4, effects: [{ kind: 'damage', amount: 15 }] }),
  ],
  ultimate: ability({ id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] }),
};
const roster: Roster = { 'test-char': CHAR };

const run = (s: GameState, u0: UnitOrders[], map: MapDef = MAP) =>
  resolveTurn(s, map, [{ team: 0, units: u0 }, { team: 1, units: [] }], roster);
const unit = (s: GameState, id: string) => s.units.find((u) => u.unitId === id)!;
const revealed = (s: GameState, id: string) => hasStatus(unit(s, id), 'reveal');

/** `a` on team 0 where you put it; `e` on team 1 six squares east on the same row. */
const board = (aPos: { x: number; y: number }, stealthed = false, ePos = { x: 10, y: BRUSH_ROW }): GameState => {
  const shooter = makeUnit('a', 0, aPos, { characterId: 'test-char' });
  return makeState([
    stealthed ? withStatuses(shooter, status('stealth', 3)) : shooter,
    makeUnit('e', 1, ePos, { characterId: 'test-char' }),
  ]);
};
const AIM = [{ x: 20, y: BRUSH_ROW }];
const landed = (s: GameState) => unit(s, 'e').hp < 100;

describe('REVEAL-FIX: attacking from the open gives nothing away', () => {
  it('an open attacker that DEALS damage gains no reveal', () => {
    // The owner's case, and the one the old rule got wrong.
    const { state } = run(board({ x: 2, y: BRUSH_ROW }), [
      { unitId: 'a', ability: { abilityId: 'shot', target: AIM } },
    ], OPEN);
    expect(landed(state), 'the shot has to land or the test proves nothing').toBe(true);
    expect(revealed(state, 'a')).toBe(false);
  });

  it('and a dash strike from the open gains none either', () => {
    // The second of the two sites the old unconditional reveal lived at.
    const s = board({ x: 2, y: BRUSH_ROW }, false, { x: 4, y: BRUSH_ROW });
    const { state } = run(s, [{
      unitId: 'a',
      ability: { abilityId: 'charge', target: [{ x: 3, y: BRUSH_ROW }, { x: 4, y: BRUSH_ROW }] },
    }], OPEN);
    expect(landed(state)).toBe(true);
    expect(revealed(state, 'a')).toBe(false);
  });
});

describe('REVEAL-FIX: attacking from concealment still gives you away', () => {
  it('a BRUSH attacker that deals damage is revealed', () => {
    const { state } = run(board({ x: 5, y: BRUSH_ROW }), [
      { unitId: 'a', ability: { abilityId: 'shot', target: AIM } },
    ]);
    expect(landed(state)).toBe(true);
    expect(revealed(state, 'a')).toBe(true);
  });

  it('…for this turn and the next (CAMO-REVEAL, unchanged)', () => {
    // Applied with `REVEAL_ON_ATTACK_TURNS` and ticked once at end of turn, so
    // the number to read after the attacking turn is one *less* than the
    // constant — what "and the next" means is that it survives that tick.
    const t1 = run(board({ x: 5, y: BRUSH_ROW }), [
      { unitId: 'a', ability: { abilityId: 'shot', target: AIM } },
    ]);
    expect(REVEAL_ON_ATTACK_TURNS).toBeGreaterThan(1); // or there is no "next"
    expect(unit(t1.state, 'a').statuses.find((st) => st.kind === 'reveal')?.remaining)
      .toBe(REVEAL_ON_ATTACK_TURNS - 1);

    const t2 = run(t1.state, []);
    expect(revealed(t2.state, 'a'), 'and it is spent by the end of the next turn').toBe(false);
  });

  it('a STEALTHED attacker is revealed even standing on open ground', () => {
    // Stealth is concealment wherever you are standing, so the gate opens on
    // the status rather than on the tile.
    const { state } = run(board({ x: 2, y: BRUSH_ROW }, true), [
      { unitId: 'a', ability: { abilityId: 'shot', target: AIM } },
    ], OPEN);
    expect(revealed(state, 'a')).toBe(true);
  });

  it('a dash strike out of brush is revealed — measured from where it launched', () => {
    // The dasher ends on open ground; the tile that hid it is the one it left,
    // which is what the gate reads.
    const s = board({ x: 5, y: BRUSH_ROW }, false, { x: 7, y: BRUSH_ROW });
    const { state } = run(s, [{
      unitId: 'a',
      ability: { abilityId: 'charge', target: [{ x: 6, y: BRUSH_ROW }, { x: 7, y: BRUSH_ROW }] },
    }]);
    expect(landed(state)).toBe(true);
    expect(revealed(state, 'a')).toBe(true);
  });
});

describe('REVEAL-FIX: breakStealth on dealing damage is unchanged (GAME_SPEC §6)', () => {
  it('a stealthed attacker loses Stealth by attacking', () => {
    const { state } = run(board({ x: 2, y: BRUSH_ROW }, true), [
      { unitId: 'a', ability: { abilityId: 'shot', target: AIM } },
    ], OPEN);
    expect(hasStatus(unit(state, 'a'), 'stealth')).toBe(false);
  });

  it('and the units the gate now skips had no Stealth to break', () => {
    // The reason narrowing the reveal cannot narrow `breakStealth` with it.
    const { state } = run(board({ x: 2, y: BRUSH_ROW }), [
      { unitId: 'a', ability: { abilityId: 'shot', target: AIM } },
    ], OPEN);
    expect(hasStatus(unit(state, 'a'), 'stealth')).toBe(false);
  });
});

describe('REVEAL-FIX: an attacker in positional fog stays completely hidden', () => {
  /** Can team 1 see `a`? The engine's own query, not a re-derivation. */
  const seen = (s: GameState, map: MapDef) => teamCanSee(buildVision(buildBoard(map)), s, 1, unit(s, 'a'));

  it('out of vision range: no reveal, and still unseen after attacking', () => {
    // Far enough that range alone hides it. The shot crosses the enemy's
    // vision; the shooter does not enter it.
    const far = { x: 10 + VISION_RANGE + 2, y: BRUSH_ROW };
    const s = board(far, false, { x: 10, y: BRUSH_ROW });
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'shot', target: [{ x: 0, y: BRUSH_ROW }] } }], OPEN);
    expect(landed(state), 'the shot reached the enemy').toBe(true);
    expect(revealed(state, 'a')).toBe(false);
    expect(seen(state, OPEN), 'range hides it whether or not it fired').toBe(false);
  });

  it('behind a wall: no reveal, and still unseen after attacking', () => {
    // Within range but with the line of sight broken. `canSee` tests range then
    // line of sight before it ever asks about concealment, so the reveal was
    // always a no-op here — this pins that it is now also absent.
    const s = board({ x: 9, y: BRUSH_ROW }, false, { x: 5, y: BRUSH_ROW });
    const { state } = run(s, [{ unitId: 'a', ability: { abilityId: 'shot', target: [{ x: 0, y: BRUSH_ROW }] } }], WALLED);
    expect(revealed(state, 'a')).toBe(false);
    expect(seen(state, WALLED)).toBe(false);
  });
});
