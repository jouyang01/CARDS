import { describe, expect, it } from 'vitest';
import type { CharacterDef } from '@cards/engine';
import {
  canStart,
  characterOptions,
  chooseCatalyst,
  chooseCharacter,
  draftPicks,
  emptyDraft,
  enemyProgress,
  lobbyStatus,
  resizeDraft,
  seatRows,
  takenByTeam,
} from '../src/lobby.js';
import { applyServerMessage, initialNet, type NetState } from '../src/net.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * M3-LOBBY-UI — the pick screen's view-model.
 *
 * Two properties carry this file. The first is that the model **forwards** and
 * never re-derives: the owed count, which characters a teammate has taken and
 * whether the room may start are all the server's answers, arriving in a
 * `lobby` message. A client that recomputed them would be a second rulebook,
 * and — the sharper half — it *could not* recompute the room-level ones, because
 * BLIND-PICK means the enemy's picks are not on this machine at all.
 *
 * The second is that a **draft may be junk**. What the player has clicked is not
 * a pick until it is complete; a screen that refused a click until the whole
 * loadout was valid would be a screen nobody could use. `draftPicks` is the one
 * gate, and everything upstream of it is permissive on purpose.
 */

const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];

/** A client that has joined and been told about its team's lobby. */
const lobbied = (over: {
  seatId?: string;
  team?: 0 | 1;
  seats?: { seatId: string; team: 0 | 1; name: string }[];
  picks?: Record<string, { characterId: string; catalysts?: string[] }[]>;
  owed?: Record<string, number>;
  ready?: string[];
  enemyReady?: number;
  enemyOf?: number;
  canStart?: boolean;
  /** LOBBY-READY: own-team seats that have said they are happy to start. */
  readied?: string[];
  /** LOBBY-READY: the seat holding the Start button. */
  creator?: string;
} = {}): NetState => {
  const seatId = over.seatId ?? 'a';
  const team = over.team ?? 0;
  const seats = over.seats ?? [{ seatId: 'a', team: 0, name: 'Ada' }, { seatId: 'b', team: 1, name: 'Bo' }];
  const joined = applyServerMessage(initialNet(), {
    type: 'joined',
    seat: { seatId, team, name: 'Ada', unitIds: [], picks: [], ready: false, connected: true, missedTurns: 0 },
    room: {
      code: 'WXYZ', format: '2v2', turn: 0, canStart: false, started: false, locked: [],
      seats: seats.map((s) => ({ ...s, unitIds: [], picks: [], ready: false, connected: true, missedTurns: 0 })),
    },
  });
  return applyServerMessage(joined, {
    type: 'lobby',
    room: joined.room!,
    lobby: {
      picks: over.picks ?? { [seatId]: [] },
      owed: over.owed ?? { [seatId]: 2 },
      ready: over.ready ?? [],
      enemyReady: over.enemyReady ?? 0,
      enemyOf: over.enemyOf ?? 1,
      canStart: over.canStart ?? false,
      readied: over.readied ?? [],
      ...(over.creator === undefined ? {} : { creator: over.creator }),
    },
  });
};

describe('the draft: permissive until it is sent', () => {
  it('a slot per character the seat owes, and no more', () => {
    // The count is a rule (`charactersPerSeat`), so offering a third slot in a
    // four-player 2v2 would be offering something the server refuses.
    expect(emptyDraft(2).slots).toHaveLength(2);
    expect(emptyDraft(1).slots).toHaveLength(1);
    expect(emptyDraft(0).slots).toEqual([]);
  });

  it('an incomplete draft is not sendable', () => {
    const draft = chooseCharacter(emptyDraft(2), 0, 'vex');
    expect(draftPicks(draft), 'one of two chosen').toBeUndefined();
    expect(draftPicks(chooseCharacter(draft, 1, 'wisp'))).toEqual([
      { characterId: 'vex' }, { characterId: 'wisp' },
    ]);
  });

  it('a PARTIAL triad is sent as no triad, not as two-thirds of one', () => {
    // The engine falls back to DEFAULT_CATALYSTS for an unchosen triad, and the
    // server rejects a triad with the wrong number of catalysts — so a half-made
    // loadout has to travel as absence, not as a short list.
    let draft = chooseCharacter(emptyDraft(1), 0, 'vex');
    draft = chooseCatalyst(draft, 0, 'prep', 'second_wind');
    expect(draftPicks(draft), 'still a legal pick').toEqual([{ characterId: 'vex' }]);

    draft = chooseCatalyst(draft, 0, 'dash', 'shift');
    draft = chooseCatalyst(draft, 0, 'blast', 'adrenaline');
    expect(draftPicks(draft)).toEqual([
      { characterId: 'vex', catalysts: ['second_wind', 'shift', 'adrenaline'] },
    ]);
  });

  it('one catalyst per phase — a second Dash replaces rather than adds', () => {
    // CAT1's rule, held by the shape: a triad keyed by phase cannot grow a
    // fourth entry the server would refuse with `badCatalysts`.
    let draft = chooseCharacter(emptyDraft(1), 0, 'vex');
    for (const [phase, id] of [['prep', 'second_wind'], ['dash', 'shift'], ['blast', 'adrenaline']] as const) {
      draft = chooseCatalyst(draft, 0, phase, id);
    }
    draft = chooseCatalyst(draft, 0, 'dash', 'blink_step');
    expect(draftPicks(draft)![0]!.catalysts).toEqual(['second_wind', 'blink_step', 'adrenaline']);
  });

  it('clicking the same choice again clears it — a lobby lets you change your mind', () => {
    const picked = chooseCharacter(emptyDraft(1), 0, 'vex');
    expect(chooseCharacter(picked, 0, 'vex').slots[0]!.characterId).toBeUndefined();
    const withCat = chooseCatalyst(picked, 0, 'dash', 'shift');
    expect(chooseCatalyst(withCat, 0, 'dash', 'shift').slots[0]!.catalysts.dash).toBeUndefined();
  });

  it('a click at a slot that does not exist changes nothing', () => {
    const draft = emptyDraft(1);
    expect(chooseCharacter(draft, 5, 'vex')).toBe(draft);
    expect(chooseCatalyst(draft, -1, 'dash', 'shift')).toBe(draft);
  });

  it('re-sizing keeps what was already chosen', () => {
    // The owed count moves under the player: a teammate joins and a two-character
    // seat becomes a one-character seat. Losing the pick they had already made
    // because somebody else walked in would be its own bug.
    const two = chooseCharacter(chooseCharacter(emptyDraft(2), 0, 'vex'), 1, 'wisp');
    expect(resizeDraft(two, 1).slots.map((s) => s.characterId)).toEqual(['vex']);
    expect(resizeDraft(two, 3).slots.map((s) => s.characterId)).toEqual(['vex', 'wisp', undefined]);
    expect(resizeDraft(two, 2), 'unchanged is the same object').toBe(two);
  });
});

describe('what the screen is allowed to know', () => {
  it("a teammate's picks are shown; the enemy's are a count and nothing else", () => {
    // BLIND-PICK, from the client's side. There is nothing to hide *from* here —
    // the payload never contained an enemy pick.
    const net = lobbied({
      seats: [
        { seatId: 'a', team: 0, name: 'Ada' }, { seatId: 'c', team: 0, name: 'Cy' },
        { seatId: 'b', team: 1, name: 'Bo' }, { seatId: 'd', team: 1, name: 'Di' },
      ],
      picks: { a: [], c: [{ characterId: 'wisp' }] },
      owed: { a: 1, c: 1 },
      ready: ['c'],
      enemyReady: 2, enemyOf: 2,
    });
    const rows = seatRows(net, CATALOG);
    expect(rows.map((r) => r.seatId), 'own team only').toEqual(['a', 'c']);
    expect(rows.find((r) => r.seatId === 'c')!.picked, 'resolved to a name').toEqual(['Wisp']);
    // NET-PRESENCE-ENEMY added `present` to the same shape, and it belongs to
    // the same rule: three counts, no lists — nothing that names an opponent.
    expect(enemyProgress(net)).toEqual({ ready: 2, of: 2, present: 2 });
  });

  it('R3 greys a character a teammate already took', () => {
    const net = lobbied({
      seats: [{ seatId: 'a', team: 0, name: 'Ada' }, { seatId: 'c', team: 0, name: 'Cy' }],
      picks: { a: [], c: [{ characterId: 'wisp' }] },
      owed: { a: 1, c: 1 },
    });
    expect(takenByTeam(net)).toEqual(new Set(['wisp']));
    const options = characterOptions(CATALOG, net, emptyDraft(1), 0);
    expect(options.find((o) => o.id === 'wisp')!.taken).toBe(true);
    expect(options.find((o) => o.id === 'vex')!.taken, 'the rest are free').toBe(false);
  });

  it("…and one of this seat's OWN other slots, because R3 is per team", () => {
    const net = lobbied();
    const draft = chooseCharacter(emptyDraft(2), 0, 'vex');
    const forSlotOne = characterOptions(CATALOG, net, draft, 1);
    expect(forSlotOne.find((o) => o.id === 'vex')!.taken, 'already in my other slot').toBe(true);
    const forSlotZero = characterOptions(CATALOG, net, draft, 0);
    expect(forSlotZero.find((o) => o.id === 'vex')!.chosen, 'but shown as mine, not blocked').toBe(true);
    expect(forSlotZero.find((o) => o.id === 'vex')!.taken).toBe(false);
  });

  it("my own accepted picks do not block me — I may change my mind", () => {
    // The trap in reading `lobby.picks` naively: my last accepted pick is in it,
    // and greying it would make a chosen character unchoosable.
    const net = lobbied({ picks: { a: [{ characterId: 'vex' }] }, owed: { a: 1 } });
    expect(takenByTeam(net).has('vex')).toBe(false);
  });

  it('start is the SERVER\'s answer, forwarded — never the client\'s own', () => {
    // This client cannot see the other side's picks, so it is structurally
    // incapable of deciding the room is ready. One boolean, straight through.
    expect(canStart(lobbied({ canStart: false }))).toBe(false);
    expect(canStart(lobbied({ canStart: true }))).toBe(true);
    expect(canStart(initialNet()), 'and false before any lobby arrives').toBe(false);
  });

  it('the status line says what it is waiting for, on both sides', () => {
    const waiting = lobbyStatus(lobbied({ owed: { a: 1 }, ready: [], enemyReady: 0, enemyOf: 2 }));
    expect(waiting).toContain('WXYZ');
    expect(waiting).toContain('0/1');
    expect(waiting).toContain('0/2');
    expect(lobbyStatus(lobbied({ canStart: true }))).toMatch(/start/i);
  });

  it('and it degrades rather than throwing before anything has arrived', () => {
    expect(seatRows(initialNet(), CATALOG)).toEqual([]);
    expect(enemyProgress(initialNet())).toEqual({ ready: 0, of: 0, present: 0 });
    expect(lobbyStatus(initialNet())).toMatch(/connect/i);
    expect(lobbyStatus({ ...initialNet(), phase: 'closed' })).toMatch(/disconnect/i);
  });
});
