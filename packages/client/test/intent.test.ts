import { describe, expect, it } from 'vitest';
import type {
  CharacterDef, Roster, StatusInstance, TeamId, UnitState,
} from '@cards/engine';
import { abilitySlot, intentBadge, intentBadges } from '../src/intent.js';
import { emptyDraft, type OrderDraft } from '../src/targeting.js';
import vex from '../../../data/characters/vex.json';
import wisp from '../../../data/characters/wisp.json';

/**
 * UI-INTENT (ar-parity §4.6) — teammates' plans, drawn.
 *
 * The ruling that teammates see each other's orders has been in force since the
 * Teams batch and has had no UI the whole time: legal, available, invisible.
 * 2v2 is the default format, so a duo that cannot see each other's plan is not
 * playing a team turn — they are playing two solo turns on one board.
 *
 * The test that matters most is the negative one. This is the only module whose
 * job is to draw plans, so it is the only one that could draw the wrong team's.
 */

const VEX = vex as unknown as CharacterDef;
const WISP = wisp as unknown as CharacterDef;
const roster: Roster = { [VEX.id]: VEX, [WISP.id]: WISP };

const unit = (id: string, owner: TeamId, characterId = VEX.id): UnitState => ({
  unitId: id, characterId, owner, pos: { x: 2, y: 2 }, hp: 95, maxHp: 95, energy: 0,
  alive: true, respawnIn: 0, cooldowns: {}, statuses: [] as StatusInstance[],
  catalysts: [], catalystsUsed: [],
});

const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({ ...emptyDraft('u'), ...over });
const badge = (over: Partial<OrderDraft> | undefined, locked = false) =>
  intentBadge(unit('u', 0), VEX, over === undefined ? undefined : draft(over), locked);

describe('UI-INTENT: the slot number is the thing a teammate reads', () => {
  it('is the hotbar position, 1-based, not the ability id', () => {
    // A teammate is matching the number against their own hotbar. "3" travels;
    // "vex_pierce" does not.
    expect(abilitySlot(VEX, VEX.abilities[0]!.id)).toBe(1);
    expect(abilitySlot(VEX, VEX.abilities[1]!.id)).toBe(2);
  });

  it('the ultimate is the slot after the last ability', () => {
    expect(abilitySlot(VEX, VEX.ultimate.id)).toBe(VEX.abilities.length + 1);
  });

  it('and an ability from another character is not on this hotbar at all', () => {
    expect(abilitySlot(VEX, WISP.abilities[0]!.id)).toBeUndefined();
  });

  it('a queued ability shows its NAME, and still records the slot', () => {
    // TEAMMATE-MOVE-VISIBLE: *"it should be VERY CLEAR what action your ally is
    // taking."* The number this used to draw is only legible to somebody who
    // knows that character's hotbar — which, when the ally is a different
    // character, is nobody. The slot is still on the badge (it is what a player
    // presses); it is no longer what the board says.
    expect(badge({ abilityId: VEX.abilities[1]!.id }))
      .toMatchObject({ slot: 2, label: VEX.abilities[1]!.name });
  });
});

describe('UI-INTENT: the additive slots get their own marks', () => {
  it('a free action rides alongside the ability, as the engine treats it', () => {
    const b = badge({ abilityId: VEX.abilities[0]!.id, freeAbilityId: 'trap' })!;
    expect(b.free).toBe(true);
    expect(b.label).toBe(`${VEX.abilities[0]!.name} +`);
  });

  it('so does a catalyst', () => {
    const b = badge({ abilityId: VEX.abilities[0]!.id, catalystId: 'shift' })!;
    expect(b.catalyst).toBe(true);
    expect(b.label).toContain(VEX.abilities[0]!.name);
  });

  it('and a free action declared on its own still shows', () => {
    // "Place the trap and take your turn" is a real plan even with no ability
    // queued, and a teammate routing around the trap needs to know.
    const b = badge({ freeAbilityId: 'trap' })!;
    expect(b.slot).toBeUndefined();
    expect(b.free).toBe(true);
  });
});

describe('UI-INTENT: the Move-phase plan, when there is no ability', () => {
  it('a drawn path reads Move', () => {
    expect(badge({ movePath: [{ x: 3, y: 2 }] })!.move).toBe('move');
    expect(badge({ movePath: [{ x: 3, y: 2 }] })!.label).toBe('Move');
  });

  it('a sprint reads Sprint — the longer reposition is the useful distinction', () => {
    expect(badge({ movePath: [{ x: 3, y: 2 }], sprint: true })!.move).toBe('sprint');
  });

  it('a chase reads Chase, since its destination is not knowable at plan time', () => {
    expect(badge({ chaseTargetId: 'e1' })!.move).toBe('chase');
  });

  it('an ability outranks the walk it is paired with', () => {
    // Move-and-shoot is one plan, and the ability is the half a teammate is
    // coordinating around — the walk has the route on the board to say it.
    const b = badge({ abilityId: VEX.abilities[0]!.id, movePath: [{ x: 3, y: 2 }] })!;
    expect(b.label).toBe(VEX.abilities[0]!.name);
    expect(b.move, 'the walk is still recorded, just not the headline').toBe('move');
  });
});

describe('UI-INTENT: the lock tick', () => {
  it('appears once that seat has locked in', () => {
    expect(badge({ abilityId: VEX.abilities[0]!.id }, true)!.locked).toBe(true);
    expect(badge({ abilityId: VEX.abilities[0]!.id }, true)!.label)
      .toBe(`${VEX.abilities[0]!.name} ✓`);
  });

  it('a locked hold still shows — "done, and standing still" is a plan', () => {
    // Holding is not worth a tile while a player is still deciding. Once they
    // have committed to it, it is exactly what a teammate needs to know.
    expect(badge(undefined, false)).toBeUndefined();
    expect(badge(undefined, true)).toMatchObject({ label: '✓', locked: true });
  });

  it('an empty draft with nothing chosen is silent until it locks', () => {
    expect(badge({}, false)).toBeUndefined();
  });
});

describe('UI-INTENT: enemies get nothing, ever', () => {
  const units = [unit('ally', 0), unit('mate', 0), unit('foe', 1), unit('foe2', 1)];
  const drafts = new Map<string, OrderDraft>([
    ['ally', draft({ abilityId: VEX.abilities[0]!.id })],
    ['mate', draft({ movePath: [{ x: 3, y: 2 }] })],
    ['foe', draft({ abilityId: VEX.abilities[1]!.id })],
    ['foe2', draft({ chaseTargetId: 'ally' })],
  ]);

  it('badges cover the viewer\'s own team and nobody else', () => {
    const badges = intentBadges(units, roster, drafts, new Set(), 0);
    expect(badges.map((b) => b.unitId)).toEqual(['ally', 'mate']);
  });

  it('not even a redacted marker for an enemy', () => {
    // The *existence* of a tile is itself information: it says they have
    // decided. Hidden information is team-vs-team, so there is no tile at all.
    const badges = intentBadges(units, roster, drafts, new Set(['foe']), 0);
    expect(badges.some((b) => b.unitId.startsWith('foe'))).toBe(false);
  });

  it('and the other seat sees the mirror image', () => {
    const badges = intentBadges(units, roster, drafts, new Set(), 1);
    expect(badges.map((b) => b.unitId)).toEqual(['foe', 'foe2']);
  });

  it('a dead ally is not planning anything', () => {
    const dead = [{ ...unit('ally', 0), alive: false }];
    expect(intentBadges(dead, roster, drafts, new Set(['ally']), 0)).toEqual([]);
  });

  it('an unknown character is skipped rather than crashing the paint', () => {
    const odd = [{ ...unit('ally', 0), characterId: 'nope' }];
    expect(intentBadges(odd, roster, drafts, new Set(), 0)).toEqual([]);
  });

  it('the lock tick reaches the right teammate and only them', () => {
    const badges = intentBadges(units, roster, drafts, new Set(['mate']), 0);
    expect(badges.find((b) => b.unitId === 'mate')?.locked).toBe(true);
    expect(badges.find((b) => b.unitId === 'ally')?.locked).toBe(false);
  });
});
