import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch } from '../src/setup.js';
import { resolveTurn, type Roster } from '../src/resolve.js';
import { buildCatalystPool, type CatalystData } from '../src/catalysts.js';
import { hasStatus } from '../src/status.js';
import type {
  CharacterDef, GameState, MapDef, PlayerOrders, TurnEvent, UnitOrders, UnitState, Vec2,
} from '../src/types.js';

/**
 * INTERCEPT-GUARD — Aegis's thesis ability, and the eight tests the design owes
 * (`docs/design/intercept-guard.md` §6).
 *
 * > *Teleport adjacent to an ally within 5. For the rest of that turn, damage
 * > that ally would take is dealt to Aegis instead. Aegis — and only Aegis —
 * > gains a shield sized to cover most but not all of one regular attack.*
 *
 * **The owner's argument is the design, and the first test is that argument:**
 * Dash resolves before Blast. The enemy aimed at the ally during Decision; Aegis
 * interposes in Dash; their locked Blast finds him standing there. The phase
 * order the whole game runs on is what makes bodyguarding mechanically real
 * rather than flavour — it turns "aim where they will be" into a kit, because
 * the enemy must now predict not one position but *whether the Bodyguard
 * commits*.
 *
 * The seven rulings this file pins are not derived here; they are in the design
 * doc and the edge-cases entry, and the tests exist so that none of them can
 * quietly stop being true.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const AEGIS = load('aegis');
const VEX = load('vex');
const KESTREL = load('kestrel');
const RAVOK = load('ravok');
const THORN = load('thorn');
const BASTION = load('bastion');
const INTERCEPT = AEGIS.abilities.find((a) => a.id === 'intercept')!;
const SHIELD = INTERCEPT.effects.find((e) => e.kind === 'shield')!.amount!;
/** Vex's basic — the plain enemy shot every redirect test is measured against. */
const RAIL = VEX.abilities.find((a) => a.id === 'rail_shot')!;
const RAIL_DAMAGE = RAIL.effects.find((e) => e.kind === 'damage')!.amount!;

const roster: Roster = Object.fromEntries(
  [AEGIS, VEX, KESTREL, RAVOK, THORN, BASTION].map((c) => [c.id, c]),
);

/** Only the fizzle test needs catalysts, and it needs a real Shift. */
const POOL = buildCatalystPool(JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', 'data/catalysts.json'), 'utf8'),
) as CatalystData);

/** An open field; cover and walls are added per-test where they are the point. */
const open = (extra: Partial<MapDef> = {}): MapDef => ({
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 2, y: 8 }, { x: 2, y: 10 }, { x: 2, y: 12 }, { x: 2, y: 14 }],
    [{ x: 18, y: 8 }, { x: 18, y: 10 }, { x: 18, y: 12 }, { x: 18, y: 14 }],
  ],
  ...extra,
});

const unit = (s: GameState, id: string): UnitState => s.units.find((u) => u.unitId === id)!;
const hpLost = (before: GameState, after: GameState, id: string): number =>
  unit(before, id).hp - unit(after, id).hp;
const damageOn = (events: readonly TurnEvent[], id: string): number => events
  .filter((e) => e.type === 'damage' && e.unitId === id)
  .reduce((n, e) => n + (e as { amount: number }).amount, 0);
const redirects = (events: readonly TurnEvent[]) =>
  events.flatMap((e) => (e.type === 'damageRedirected' ? [e] : []));
/**
 * Statuses of `kind` applied to `id` **this turn**, read off the log.
 *
 * Read from events rather than from the finished state on purpose: both the
 * guard and the shield are `duration: 1`, applied in Dash, and swept by the same
 * turn's end-of-turn tick — so a test that looks at `state.statuses` afterwards
 * finds nothing whether or not the ability worked, and would certify the bug as
 * fixed. Assert what the turn DID.
 */
const applied = (events: readonly TurnEvent[], id: string, kind: string) => events
  .flatMap((e) => (e.type === 'statusApplied' && e.unitId === id && e.status === kind ? [e] : []));

/**
 * The standard field: Aegis and an ally on team 0, one or two enemies on team 1,
 * everybody placed by the caller.
 *
 * 2v2 rather than the 1v1 the rest of the engine tests use, because the ability
 * *is* about a second friendly unit — a bodyguard with nobody to guard is the
 * fallback case, and it gets its own test.
 */
const field = (
  mine: CharacterDef[], theirs: CharacterDef[], at: Vec2[], map: MapDef = open(),
  format: '2v2' | '4v4' = '2v2',
) => {
  const state = createMatch(map, format, [mine, theirs]);
  const ordered = [
    ...state.units.filter((u) => u.owner === 0),
    ...state.units.filter((u) => u.owner === 1),
  ];
  ordered.forEach((u, i) => { const p = at[i]; if (p !== undefined) u.pos = { ...p }; });
  return { state, map, us: ordered.slice(0, mine.length), them: ordered.slice(mine.length) };
};

const turn = (
  state: GameState, map: MapDef, mine: UnitOrders[], theirs: UnitOrders[],
): { state: GameState; events: TurnEvent[] } => resolveTurn(state, map, [
  { team: 0, units: mine }, { team: 1, units: theirs },
] as [PlayerOrders, PlayerOrders], roster);

/**
 * Aegis intercepts for `allyId`, landing on the square he was told to.
 *
 * INTERCEPT-LANDING-CHOICE: the square is a parameter because it is now the
 * PLAYER's, not the engine's. Every call below names it explicitly for that
 * reason — a default here would quietly re-create the auto-landing this ruling
 * removed, and the tests would stop being able to tell the difference.
 */
const intercept = (aegisId: string, allyId: string, at: Vec2): UnitOrders =>
  ({ unitId: aegisId, ability: { abilityId: INTERCEPT.id, targetUnitId: allyId, target: [{ ...at }] } });

/** Most fixtures below stand the ally on (10,10) and guard from the north. */
const NORTH_OF_ALLY: Vec2 = { x: 10, y: 9 };

/** An enemy fires its basic at a square. */
const shoot = (unitId: string, abilityId: string, at: Vec2): UnitOrders =>
  ({ unitId, ability: { abilityId, target: [{ ...at }] } });

describe('INTERCEPT-GUARD (1): the thesis — he arrives, then the damage lands on him', () => {
  it('the enemy Blast aimed at the ally is dealt to Aegis, and the ally takes zero', () => {
    // The whole design in one turn. Vex locks Rail Shot at Kestrel's square
    // during Decision; Aegis Intercepts in DASH, which resolves first; the shot
    // finds him standing there. The 18 shield eats most of it and his HP takes
    // the rest — "most but not all of one regular attack", exactly as directed.
    // Aegis comes from the NORTH and lands at (10,9): off the row the shot
    // travels down, so the only damage he takes is the damage he took FOR them.
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 16, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const out = turn(f.state, f.map,
      [intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY)],
      [shoot(f.them[0]!.unitId, RAIL.id, ally!.pos)]);

    expect(unit(out.state, aegis!.unitId).pos, 'he interposed').toEqual({ x: 10, y: 9 });
    expect(hpLost(f.state, out.state, ally!.unitId), 'the ally is untouched').toBe(0);
    expect(redirects(out.events), 'one shot bent').toHaveLength(1);
    expect(redirects(out.events)[0], 'from the ally, to the guardian').toMatchObject({
      from: ally!.unitId, to: aegis!.unitId, amount: RAIL_DAMAGE,
    });
    // Shield first, then HP: the 18 absorbs, and only the remainder is real.
    expect(hpLost(f.state, out.state, aegis!.unitId), 'shield first, HP for the rest')
      .toBe(Math.max(0, RAIL_DAMAGE - SHIELD));
  });

  it('and he is standing next to them when it happens', () => {
    // Not incidental — it is the fiction and the tell. The enemy reads Aegis's
    // position and knows the guard is on.
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 16, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const out = turn(f.state, f.map, [intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY)], []);
    const landed = unit(out.state, aegis!.unitId).pos;
    expect(Math.abs(landed.x - ally!.pos.x) + Math.abs(landed.y - ally!.pos.y),
      'orthogonally adjacent to the ally').toBe(1);
    expect(out.events.some((e) => e.type === 'guardApplied'
      && e.casterId === aegis!.unitId && e.allyId === ally!.unitId), 'and the guard is announced')
      .toBe(true);
  });

  it('the guard is on the ALLY and the shield is on AEGIS — not the other way round', () => {
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 16, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const out = turn(f.state, f.map, [intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY)], []);
    expect(applied(out.events, ally!.unitId, 'guard')[0], 'the ally carries the guard')
      .toMatchObject({ sourceUnitId: aegis!.unitId });
    expect(applied(out.events, ally!.unitId, 'shield'), 'the ally gets no shield').toHaveLength(0);
    expect(applied(out.events, aegis!.unitId, 'shield'), 'Aegis gets it, and only Aegis')
      .toHaveLength(1);
    // A unit standing in for itself is meaningless and a redirect loop waiting
    // to be written, so the caster is explicitly excluded from his own guard.
    expect(applied(out.events, aegis!.unitId, 'guard'), 'and nobody guards themselves')
      .toHaveLength(0);
  });
});

describe('INTERCEPT-GUARD (2): the amount is the ally\'s, the mitigation is Aegis\'s', () => {
  it('the ALLY\'s cover reduces the redirected number', () => {
    // Design §4.3: the shot was fired at the ally's square, so the ally's cover
    // is part of what "would have reached them". Cover halves it, and the halved
    // number is what arrives on Aegis.
    const shielded = open({ cover: [{ x: 11, y: 10 }] });
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 16, y: 10 }, { x: 1, y: 1 }], shielded);
    const [aegis, ally] = f.us;
    const out = turn(f.state, f.map,
      [intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY)],
      [shoot(f.them[0]!.unitId, RAIL.id, ally!.pos)]);
    const bent = redirects(out.events)[0];
    expect(bent, 'the shot still bent').toBeDefined();
    expect(bent!.amount, 'halved by the ally\'s cover, then redirected')
      .toBe(Math.floor(RAIL_DAMAGE / 2));
  });

  it('and AEGIS\'s own cover does not — he is not where it was aimed', () => {
    // The other half, and the one a naive "just re-run the damage on Aegis"
    // implementation gets wrong: his cover is irrelevant because the shot was
    // never aimed at his square. His shield is the mitigation he brought.
    // Cover beside AEGIS's landing square, not beside the ally's.
    const behindCover = open({ cover: [{ x: 11, y: 9 }] });
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 16, y: 10 }, { x: 1, y: 1 }], behindCover);
    const [aegis, ally] = f.us;
    const out = turn(f.state, f.map,
      [intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY)],
      [shoot(f.them[0]!.unitId, RAIL.id, ally!.pos)]);
    expect(redirects(out.events)[0]?.amount, 'the full number, uncovered').toBe(RAIL_DAMAGE);
  });
});

describe('INTERCEPT-GUARD (3): a bodyguard takes the bullet, not the leash', () => {
  it('a pull aimed at the ally still drags the ALLY', () => {
    // Design §4.1: damage only. Statuses, displacement and Move-loss land on the
    // ally as normal — the most common way a redirect design goes wrong is by
    // quietly moving everything with the damage. Bastion's Chain Hook is the
    // roster's clearest case: 23 and a two-square drag, in one ability.
    const f = field([AEGIS, KESTREL], [BASTION, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 14, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const hook = BASTION.abilities.find((a) => a.id === 'chain_hook')!;
    const out = turn(f.state, f.map,
      [intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY)],
      [shoot(f.them[0]!.unitId, hook.id, ally!.pos)]);

    expect(redirects(out.events), 'the damage bent').toHaveLength(1);
    expect(damageOn(out.events, ally!.unitId), 'the ally took none of it').toBe(0);
    expect(unit(out.state, ally!.unitId).pos, 'but the ally was still dragged')
      .not.toEqual(ally!.pos);
    expect(unit(out.state, aegis!.unitId).pos, 'and the guardian was not')
      .toEqual({ x: 10, y: 9 });
  });
});

describe('INTERCEPT-GUARD (4): which damage redirects, and which does not', () => {
  it('an enemy trap the ally walks into in Move redirects', () => {
    // Enemy-dealt, guard-live damage — the phase it lands in is not the test.
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 14, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const mine = VEX.abilities.find((a) => a.id === 'overwatch_trap')!;
    const armed = turn(f.state, f.map, [],
      [{ unitId: f.them[0]!.unitId, ability: { abilityId: mine.id, target: [{ x: 11, y: 10 }] } }]);

    const out = turn(armed.state, f.map, [
      intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY),
      { unitId: ally!.unitId, movePath: [{ x: 11, y: 10 }] },
    ], []);
    expect(redirects(out.events), 'the trap bit the bodyguard').toHaveLength(1);
    expect(damageOn(out.events, ally!.unitId), 'and not the ally').toBe(0);
    // …and the trap's RIDER still lands on the ally: the leash, not the bullet.
    expect(hasStatus(unit(out.state, ally!.unitId), 'reveal'), 'the trap still revealed them')
      .toBe(true);
  });

  it('an end-of-turn DoT tick on the ally does NOT redirect', () => {
    // Design §4.2: the burn was applied to the ally before or despite the guard,
    // and a tick is not a hit — nobody steps in front of a poison. Cinder's
    // Flare Burst lands the DoT on turn 1; the guard goes up on turn 2, and the
    // tick at the end of turn 2 still burns the ally.
    const cinder = load('cinder');
    const wide: Roster = { ...roster, cinder };
    const f = field([AEGIS, KESTREL], [cinder, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 13, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const burn = cinder.abilities.find((a) => a.id === 'flare_burst')!;
    const lit = resolveTurn(f.state, f.map, [
      { team: 0, units: [] },
      { team: 1, units: [shoot(f.them[0]!.unitId, burn.id, ally!.pos)] },
    ] as [PlayerOrders, PlayerOrders], wide);
    expect(hasStatus(unit(lit.state, ally!.unitId), 'damageOverTime'), 'the ally is burning')
      .toBe(true);

    const guarded = resolveTurn(lit.state, f.map, [
      { team: 0, units: [intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY)] },
      { team: 1, units: [] },
    ] as [PlayerOrders, PlayerOrders], wide);
    expect(redirects(guarded.events), 'no tick bent').toHaveLength(0);
    expect(damageOn(guarded.events, ally!.unitId), 'the ally took its own burn')
      .toBeGreaterThan(0);
  });

  it('and the ally\'s OWN recoil does not', () => {
    // Design §4.2 again, and the reason is named in the doc: guarding somebody
    // against their own recklessness is neither the fantasy nor good for the
    // Ravok-plus-Aegis case. Whirling Cleave charges Ravok half its damage; that
    // half is his, guarded or not.
    const f = field([AEGIS, RAVOK], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    // A self-centred circle: it is aimed at the swinger's own square, and the
    // enemy standing next to him is what it catches.
    const cleave = RAVOK.abilities.find((a) => a.id === 'cleave')!;
    const out = turn(f.state, f.map, [
      intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY),
      shoot(ally!.unitId, cleave.id, ally!.pos),
    ], []);
    expect(redirects(out.events), 'recoil never bends').toHaveLength(0);
    expect(hpLost(f.state, out.state, ally!.unitId), 'Ravok paid his own price')
      .toBeGreaterThan(0);
  });
});

describe('INTERCEPT-GUARD (5): the guard dies with its guardian', () => {
  it('Aegis killed by the first redirected hit → the second lands on the ally', () => {
    // Design §4.5, and the read the enemy gets to make: commit two shots and you
    // go THROUGH the bodyguard. Both Vexes fire down the x=10 column at the
    // ally; Aegis comes from the west and stands at (9,10), off the column, so
    // the only damage reaching him is the damage he took for them.
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 7, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 15 }, { x: 10, y: 5 }]);
    const [aegis, ally] = f.us;
    // Just enough that one shot through the 18 shield finishes him.
    unit(f.state, aegis!.unitId).hp = 1;
    const out = turn(f.state, f.map, [intercept(aegis!.unitId, ally!.unitId, { x: 9, y: 10 })], [
      shoot(f.them[0]!.unitId, RAIL.id, ally!.pos),
      shoot(f.them[1]!.unitId, RAIL.id, ally!.pos),
    ]);

    expect(unit(out.state, aegis!.unitId).pos, 'he interposed to the west').toEqual({ x: 9, y: 10 });
    expect(unit(out.state, aegis!.unitId).alive, 'the bodyguard fell').toBe(false);
    expect(redirects(out.events), 'exactly one shot bent').toHaveLength(1);
    expect(damageOn(out.events, ally!.unitId), 'and the second one found the ally')
      .toBe(RAIL_DAMAGE);
  });
});

describe('INTERCEPT-LANDING-CHOICE (6): the square is the player’s, and the fizzle', () => {
  /**
   * *"The player should be able to only choose a square that is adjacent to an
   * ally. Right now you can only choose the ally square and can’t choose which
   * adjacent square to go to."*
   *
   * The auto-landing INTERCEPT-GUARD shipped with — nearest open orthogonal,
   * `ORTHOGONAL_STEPS` breaking ties — is gone, and with it the determinism test
   * that pinned that tiebreak. Which side of his teammate the bodyguard stands
   * on decides which lane he blocks, which enemy he faces and whether he ends in
   * cover, so it belongs to the player. What is left to prove is that the engine
   * takes the pick, refuses the picks it should, and fizzles when a legal pick
   * stops being legal before Dash gets to it.
   */

  it('THE ITEM: the same board, two picks, two different landings', () => {
    // The one assertion the old auto-landing could not have passed: nothing
    // about the board differs between these two turns, only the order.
    const at = [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 16, y: 12 }, { x: 1, y: 1 }];
    const north = field([AEGIS, KESTREL], [VEX, VEX], at);
    const south = field([AEGIS, KESTREL], [VEX, VEX], at);
    const n = turn(north.state, north.map,
      [intercept(north.us[0]!.unitId, north.us[1]!.unitId, { x: 10, y: 9 })], []);
    const s = turn(south.state, south.map,
      [intercept(south.us[0]!.unitId, south.us[1]!.unitId, { x: 10, y: 11 })], []);

    expect(unit(n.state, north.us[0]!.unitId).pos, 'he went where he was told')
      .toEqual({ x: 10, y: 9 });
    expect(unit(s.state, south.us[0]!.unitId).pos, 'and so did he').toEqual({ x: 10, y: 11 });
    // The far side is the square the old tiebreak would never have chosen, and
    // the rest of the ability has to work identically from it.
    expect(applied(s.events, south.us[1]!.unitId, 'guard'), 'the guard still binds').toHaveLength(1);
    expect(applied(s.events, south.us[0]!.unitId, 'shield')[0], 'and the shield still lands')
      .toMatchObject({ amount: SHIELD });
  });

  it('a square that is not beside the named ally is refused outright', () => {
    // "Only choose a square that is adjacent to an ally", enforced. A refusal
    // rather than a fizzle: the order was never legal, so it costs nothing —
    // the same silent drop every other malformed component gets.
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 16, y: 12 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    // Diagonal, and two out: neither is adjacent to anybody.
    for (const bad of [{ x: 11, y: 11 }, { x: 10, y: 8 }]) {
      const out = turn(f.state, f.map, [intercept(aegis!.unitId, ally!.unitId, bad)], []);
      expect(unit(out.state, aegis!.unitId).pos, `${bad.x},${bad.y} is not beside the ally`)
        .toEqual({ x: 10, y: 7 });
      expect(unit(out.state, aegis!.unitId).cooldowns[INTERCEPT.id] ?? 0, 'and cost nothing').toBe(0);
    }
  });

  it('and neither is a blocked one — the wall is refused, its neighbour is not', () => {
    // Both halves on one fixture, because "refused" only means something if the
    // square next to it is accepted on the same board.
    const walled = open({ walls: [{ x: 10, y: 9 }] });
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 6 }, { x: 10, y: 10 }, { x: 16, y: 12 }, { x: 1, y: 1 }], walled);
    const [aegis, ally] = f.us;
    const into = turn(f.state, f.map, [intercept(aegis!.unitId, ally!.unitId, { x: 10, y: 9 })], []);
    expect(unit(into.state, aegis!.unitId).pos, 'he cannot stand inside a wall')
      .toEqual({ x: 10, y: 6 });
    expect(unit(into.state, aegis!.unitId).cooldowns[INTERCEPT.id] ?? 0, 'and it cost nothing').toBe(0);

    const beside = turn(f.state, f.map, [intercept(aegis!.unitId, ally!.unitId, { x: 9, y: 10 })], []);
    expect(unit(beside.state, aegis!.unitId).pos, 'but the west square is his to take')
      .toEqual({ x: 9, y: 10 });
  });

  it('somebody else claims the square → the cast fizzles, cooldown spent', () => {
    // The teleport precedent, taken to the whole ability: he never arrived, so
    // there is nothing to interpose and no shield for a bodyguard still across
    // the room. The cooldown is spent either way — that is what "fizzle" costs.
    //
    // With the square being the player's own pick, this is a *race* rather than
    // the engine running out of options: an enemy Shift claims (10,9) in the
    // same Dash, BLINK-CLASH marks it contested, and BLINK-ADJ slides the
    // ordinary blink to the next square along.
    //
    // **The bodyguard gets no such slide, and that is the point.** "Near
    // enough" would leave him diagonally off his teammate — outside the
    // ability's own area, so the shield gate refuses him — with the guard bound
    // anyway: a half-cast that reads on the board as a working Intercept. The
    // ruling gave the square to the player, so it is that square or nothing.
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 8, y: 8 }, { x: 10, y: 10 }, { x: 10, y: 7 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const out = resolveTurn(f.state, f.map, [
      { team: 0, units: [intercept(aegis!.unitId, ally!.unitId, { x: 10, y: 9 })] },
      {
        team: 1,
        units: [{
          unitId: f.them[0]!.unitId,
          catalyst: { abilityId: 'shift', target: [{ x: 10, y: 9 }] },
        }],
      },
    ] as [PlayerOrders, PlayerOrders], roster, POOL);

    expect(unit(out.state, f.them[0]!.unitId).pos, 'the enemy slid aside, as a blink does')
      .toEqual({ x: 10, y: 8 });
    expect(unit(out.state, aegis!.unitId).pos, 'and the bodyguard did not move at all')
      .toEqual({ x: 8, y: 8 });
    expect(applied(out.events, ally!.unitId, 'guard'), 'nobody is guarded').toHaveLength(0);
    expect(applied(out.events, aegis!.unitId, 'shield'), 'and no shield was handed out')
      .toHaveLength(0);
    expect(unit(out.state, aegis!.unitId).cooldowns[INTERCEPT.id], 'but the cooldown is spent')
      .toBeGreaterThan(0);
  });

  it('a guarded ally who dashes away STAYS guarded', () => {
    // Design §3: the guard binds to the unit, not to adjacency — which is what
    // stops "does it fizzle or does it track?" from ever being a question.
    //
    // Proved by a hit rather than by a status: Kestrel skims two squares east in
    // the same Dash phase, ending nowhere near her bodyguard, and the enemy shot
    // locked at her NEW square still bends back to him.
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 10 }, { x: 16, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const skim = KESTREL.abilities.find((a) => a.id === 'skim')!;
    const out = turn(f.state, f.map, [
      intercept(aegis!.unitId, ally!.unitId, NORTH_OF_ALLY),
      { unitId: ally!.unitId, ability: { abilityId: skim.id, target: [{ x: 11, y: 10 }, { x: 12, y: 10 }] } },
    ], [shoot(f.them[0]!.unitId, RAIL.id, { x: 12, y: 10 })]);

    expect(unit(out.state, ally!.unitId).pos, 'the ally really left').toEqual({ x: 12, y: 10 });
    expect(unit(out.state, aegis!.unitId).pos, 'and the guardian stayed put').toEqual({ x: 10, y: 9 });
    expect(redirects(out.events), 'the guard followed the unit, not the square').toHaveLength(1);
    expect(damageOn(out.events, ally!.unitId), 'the ally took nothing').toBe(0);
  });
});

describe('INTERCEPT-GUARD (7): the 1v1 fallback is a fallback, not a choice', () => {
  it('with no living ally, a square aim works — teleport and shield, no guard', () => {
    // The Support/hybrid self-applicability rule, standing: alone, Intercept
    // degrades to exactly the escape it used to be, so the kit stays 1v1-viable.
    const state = createMatch(open(), '1v1', [[AEGIS], [VEX]]);
    const aegis = state.units.find((u) => u.owner === 0)!;
    aegis.pos = { x: 10, y: 10 };
    state.units.find((u) => u.owner === 1)!.pos = { x: 18, y: 18 };
    const out = resolveTurn(state, open(), [
      { team: 0, units: [{ unitId: aegis.unitId, ability: { abilityId: INTERCEPT.id, target: [{ x: 13, y: 10 }] } }] },
      { team: 1, units: [] },
    ] as [PlayerOrders, PlayerOrders], roster);

    expect(unit(out.state, aegis.unitId).pos, 'he teleported').toEqual({ x: 13, y: 10 });
    expect(applied(out.events, aegis.unitId, 'shield')[0], 'and still got his shield')
      .toMatchObject({ amount: SHIELD });
    expect(out.events.some((e) => e.type === 'guardApplied'), 'nobody to guard').toBe(false);
  });

  it('with an ally alive, square-targeting an empty square is INVALID', () => {
    // The half that makes it a fallback. If both aims were legal the ability
    // would have two modes and only one of them would be the design — an Aegis
    // could take the escape tool and leave the bodyguard on the shelf.
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 8, y: 10 }, { x: 10, y: 10 }, { x: 16, y: 12 }, { x: 1, y: 1 }]);
    const [aegis] = f.us;
    const out = turn(f.state, f.map,
      [{ unitId: aegis!.unitId, ability: { abilityId: INTERCEPT.id, target: [{ x: 9, y: 12 }] } }], []);
    expect(unit(out.state, aegis!.unitId).pos, 'the order was refused outright').toEqual({ x: 8, y: 10 });
    expect(unit(out.state, aegis!.unitId).cooldowns[INTERCEPT.id] ?? 0, 'and cost nothing').toBe(0);
  });

  it('and naming an ENEMY, a corpse or somebody out of range is refused too', () => {
    const f = field([AEGIS, KESTREL], [VEX, VEX],
      [{ x: 2, y: 2 }, { x: 18, y: 18 }, { x: 16, y: 10 }, { x: 1, y: 1 }]);
    const [aegis, ally] = f.us;
    const refused = (targetUnitId: string): GameState => turn(f.state, f.map,
      [{ unitId: aegis!.unitId, ability: { abilityId: INTERCEPT.id, targetUnitId } }], []).state;
    expect(unit(refused(f.them[0]!.unitId), aegis!.unitId).pos, 'an enemy is not an ally')
      .toEqual({ x: 2, y: 2 });
    expect(unit(refused(ally!.unitId), aegis!.unitId).pos, 'and 22 squares is not within 5')
      .toEqual({ x: 2, y: 2 });
    expect(unit(refused(aegis!.unitId), aegis!.unitId).pos, 'and he cannot guard himself')
      .toEqual({ x: 2, y: 2 });
  });
});

describe('INTERCEPT-GUARD (8): two bodyguards, one ally', () => {
  it('the second guard replaces the first — refresh, latest caster wins', () => {
    // Design §4.6, the mirror-4v4 case. Refresh-not-stack is the rule every
    // other status already follows, so this ruling falls out of the machinery
    // rather than being a special case: whoever stepped in last is the one
    // standing there, and the redirect follows him.
    const f = field([AEGIS, AEGIS, KESTREL, KESTREL], [VEX, VEX, VEX, VEX],
      [{ x: 10, y: 7 }, { x: 10, y: 13 }, { x: 10, y: 10 }, { x: 2, y: 2 },
        { x: 16, y: 10 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 1, y: 5 }],
      open(), '4v4');
    const [first, second, ally] = f.us;
    const out = turn(f.state, f.map, [
      // Opposite sides, each the player's own pick — and the fixture puts the
      // two Aegises north and south of the ally, so each takes the near square.
      intercept(first!.unitId, ally!.unitId, { x: 10, y: 9 }),
      intercept(second!.unitId, ally!.unitId, { x: 10, y: 11 }),
    ], [shoot(f.them[0]!.unitId, RAIL.id, ally!.pos)]);

    const guards = applied(out.events, ally!.unitId, 'guard');
    expect(guards, 'both stepped in').toHaveLength(2);
    expect(out.events.filter((e) => e.type === 'guardApplied'), 'and both said so').toHaveLength(2);
    // Exactly one hit, exactly one redirect: two candidates must not split or
    // double the damage.
    const bent = redirects(out.events);
    expect(bent, 'one shot, one redirect').toHaveLength(1);
    expect(bent[0]!.to, 'and it went to the LAST bodyguard to step in')
      .toBe(guards[guards.length - 1]!.sourceUnitId);
    expect(damageOn(out.events, ally!.unitId), 'the ally still took nothing').toBe(0);
  });
});
