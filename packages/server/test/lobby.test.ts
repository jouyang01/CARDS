import { describe, expect, it } from 'vitest';
import { buildCatalystPool, type CatalystData, type CatalystPool, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import {
  charactersPerSeat, createRoom, join, lobbyReady, setPicks, startFromPicks, startMatch,
  teamCovered, teamSplit, teamsFromPicks, type Pick, type Room,
} from '../src/room.js';

/**
 * M3-LOBBY (server half) — the ruled pick model, as data.
 *
 * The lobby's whole job before the start button is to collect a legal set of
 * picks, and "legal" is a ruling rather than a preference (edge-cases,
 * "M3-LOBBY pick model", Builder OQ 2026-09-08 #4):
 *
 * - **A seat is not a character.** A seat picks N characters, N being however
 *   many it will order, so a 2-player 2v2 collects two picks per player and a
 *   4-player 4v4 collects two each as well. The split has to be *the engine's*
 *   split — `deriveSeats` will slice the team's list back apart at start, and if
 *   the lobby asked for a different shape a player would pick a character that
 *   comes back under somebody else's control.
 * - **The triad is per character**, not per player, because a loadout belongs to
 *   a character. Two characters on one seat carry two triads.
 * - **R3 spans the whole team.** Uniqueness is a property of the team's
 *   complement: two players on one side may not bring the same character
 *   *between them*. Cross-team mirrors stay legal.
 *
 * The validations are the interesting half — a lobby that accepts an illegal
 * pick has produced a match nobody can play — so each rule gets the case that
 * would have slipped past its absence.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [
    [{ x: 1, y: 5 }, { x: 1, y: 7 }, { x: 1, y: 9 }, { x: 1, y: 11 }],
    [{ x: 13, y: 5 }, { x: 13, y: 7 }, { x: 13, y: 9 }, { x: 13, y: 11 }],
  ],
};
const shot = {
  id: 'shot', name: 'shot', phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: 'shot',
};
const character = (id: string): CharacterDef => ({
  id, name: id, archetype: 'firepower', maxHp: 100,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
});
const roster: Roster = Object.fromEntries(
  ['ash', 'bry', 'cyn', 'dex', 'eir', 'fen', 'gil', 'hal'].map((id) => [id, character(id)]),
);

/** A pool with one catalyst per phase, which is all a triad rule needs. */
const cat = (id: string, phase: 'prep' | 'dash' | 'blast') => ({
  id, name: id, phase, shape: 'self' as const, range: 0, cooldown: 0, energyGain: 0,
  free: true, oncePerMatch: true, effects: [], description: id,
});
const POOL: CatalystPool = buildCatalystPool({
  prep: [cat('ward', 'prep'), cat('brace', 'prep')],
  dash: [cat('shift', 'dash')],
  blast: [cat('surge', 'blast')],
} as unknown as CatalystData);
const TRIAD = ['ward', 'shift', 'surge'];

/** A room with `names.length` seats, seated in order (join auto-balances teams). */
const seated = (format: '2v2' | '4v4' | '1v1', names: string[]): Room => {
  let room = createRoom('WXYZ', format);
  for (const name of names) {
    const result = join(room, name);
    expect(result.ok, `seat ${name} joined`).toBe(true);
    if (result.ok) room = result.room;
  }
  return room;
};
const pick = (...ids: string[]): Pick[] => ids.map((characterId) => ({ characterId, catalysts: TRIAD }));
/** Apply picks and insist they were accepted — the setup path, not the assertion. */
const withPicks = (room: Room, seatId: string, picks: Pick[]): Room => {
  const result = setPicks(room, seatId, picks, roster, POOL);
  expect(result.ok ? '' : result.errors.join('; '), `seat ${seatId} picks`).toBe('');
  if (!result.ok) throw new Error('unreachable');
  return result.room;
};

describe('M3-LOBBY: a seat is asked for as many characters as it will order', () => {
  it('a 2-player 2v2 asks each player for TWO — the case a per-seat model gets wrong', () => {
    const room = seated('2v2', ['a', 'b']); // one per team
    expect(charactersPerSeat(room, 'a')).toBe(2);
    expect(charactersPerSeat(room, 'b')).toBe(2);
  });

  it('a 4-player 2v2 asks each for ONE', () => {
    const room = seated('2v2', ['a', 'b', 'c', 'd']);
    for (const id of ['a', 'b', 'c', 'd']) expect(charactersPerSeat(room, id)).toBe(1);
  });

  it('a 3-player 4v4 team splits 2+1+1, exactly as the spec writes it', () => {
    // GAME_SPEC §1: "a 4v4 team of three players splits control 2+1+1".
    const room = seated('4v4', ['a', 'b', 'c', 'd', 'e', 'f']); // 3 per team
    expect(teamSplit(room, 0)).toEqual([2, 1, 1]);
    expect(teamSplit(room, 1)).toEqual([2, 1, 1]);
  });

  it('and the split is the one `deriveSeats` will slice back apart', () => {
    // The property that matters, checked against the engine rather than restated:
    // a seat's picks must come back to that seat as its own units.
    let room = seated('4v4', ['a', 'b', 'c', 'd', 'e', 'f']);
    const ids = ['ash', 'bry', 'cyn', 'dex', 'eir', 'fen', 'gil', 'hal'];
    room = withPicks(room, 'a', pick(ids[0]!, ids[1]!));
    room = withPicks(room, 'c', pick(ids[2]!));
    room = withPicks(room, 'e', pick(ids[3]!));
    room = withPicks(room, 'b', pick(ids[4]!, ids[5]!));
    room = withPicks(room, 'd', pick(ids[6]!));
    room = withPicks(room, 'f', pick(ids[7]!));

    const started = startFromPicks(room, OPEN, roster);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    for (const seat of started.room.seats) {
      const picked = seat.picks.map((p) => p.characterId);
      const dealt = seat.unitIds.map((u) => started.room.state!.units.find((x) => x.unitId === u)!.characterId);
      expect(dealt, `seat ${seat.seatId} controls what it picked`).toEqual(picked);
    }
  });

  it('a seat that is not in the room is owed nothing', () => {
    expect(charactersPerSeat(seated('2v2', ['a', 'b']), 'ghost')).toBe(0);
  });
});

describe('M3-LOBBY: a team its seats cannot cover is not a lobby that can start', () => {
  it('a 2-seat 4v4 covers its four characters, two each', () => {
    const room = seated('4v4', ['a', 'b', 'c', 'd']);
    expect(teamCovered(room, 0)).toBe(true);
    expect(teamCovered(room, 1)).toBe(true);
  });

  it('a 1-seat 4v4 team does NOT — one player cannot run four characters', () => {
    // GAME_SPEC §1's "4v4 requires a minimum of 4 players", derived rather than
    // tabulated: the cap of 2 per player is the only input.
    const room = seated('4v4', ['a', 'b']);
    expect(teamCovered(room, 0)).toBe(false);
    expect(lobbyReady(room), 'and so the lobby is not ready, whatever it picked').toBe(false);
  });
});

describe('M3-LOBBY: what a pick is refused for', () => {
  const room = seated('2v2', ['a', 'b']);

  it('the wrong number of characters — one short leaves a character unowned', () => {
    const short = setPicks(room, 'a', pick('ash'), roster, POOL);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.reason).toBe('wrongCount');
    const long = setPicks(room, 'a', pick('ash', 'bry', 'cyn'), roster, POOL);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.reason).toBe('wrongCount');
  });

  it('a character nobody can spawn, caught here rather than inside createMatch', () => {
    const result = setPicks(room, 'a', pick('ash', 'nobody'), roster, POOL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknownCharacter');
      expect(result.errors.join(' '), 'and it says which').toContain('nobody');
    }
  });

  it('R3 within one seat: the same character twice is the degenerate stall case', () => {
    const result = setPicks(room, 'a', pick('ash', 'ash'), roster, POOL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('duplicateCharacter');
  });

  it('R3 ACROSS the team — two players, one character between them', () => {
    // The rule's sharpest edge, and the one a per-seat check misses entirely.
    let four = seated('2v2', ['a', 'b', 'c', 'd']); // a,c on team 0; b,d on team 1
    four = withPicks(four, 'a', pick('ash'));
    const clash = setPicks(four, 'c', pick('ash'), roster, POOL);
    expect(clash.ok, 'a teammate cannot bring the same character').toBe(false);
    if (!clash.ok) expect(clash.reason).toBe('duplicateCharacter');
  });

  it('but a MIRROR across teams is legal — blind picks are not a conflict', () => {
    let four = seated('2v2', ['a', 'b', 'c', 'd']);
    four = withPicks(four, 'a', pick('ash'));
    const mirror = setPicks(four, 'b', pick('ash'), roster, POOL);
    expect(mirror.ok, 'the enemy may field the same character').toBe(true);
  });

  it('a triad that is not one per phase — delegated to the engine, not re-implemented', () => {
    const twoPrep = setPicks(
      room, 'a',
      [{ characterId: 'ash', catalysts: ['ward', 'brace', 'surge'] }, { characterId: 'bry', catalysts: TRIAD }],
      roster, POOL,
    );
    expect(twoPrep.ok).toBe(false);
    if (!twoPrep.ok) {
      expect(twoPrep.reason).toBe('badCatalysts');
      expect(twoPrep.errors.join(' '), 'named by the character that picked it').toContain('ash');
    }
  });

  it('a catalyst that is not in the pool at all', () => {
    const result = setPicks(
      room, 'a',
      [{ characterId: 'ash', catalysts: ['ward', 'shift', 'nope'] }, { characterId: 'bry', catalysts: TRIAD }],
      roster, POOL,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('badCatalysts');
  });

  it('a seat that is not in the room', () => {
    const result = setPicks(room, 'ghost', pick('ash', 'bry'), roster, POOL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknownSeat');
  });

  it('and a pick submitted after the match started', () => {
    let started = withPicks(room, 'a', pick('ash', 'bry'));
    started = withPicks(started, 'b', pick('cyn', 'dex'));
    const running = startFromPicks(started, OPEN, roster);
    expect(running.ok).toBe(true);
    if (!running.ok) return;
    const late = setPicks(running.room, 'a', pick('eir', 'fen'), roster, POOL);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe('inProgress');
  });

  it('a refused pick leaves the room exactly as it was', () => {
    // Rejections are values and the room is replaced wholesale, so a refused
    // pick cannot half-write the record it was refused from.
    const before = withPicks(room, 'a', pick('ash', 'bry'));
    setPicks(before, 'a', pick('ash', 'ash'), roster, POOL);
    expect(before.seats.find((s) => s.seatId === 'a')!.picks.map((p) => p.characterId))
      .toEqual(['ash', 'bry']);
  });
});

describe('M3-LOBBY: a triad belongs to a character, not to a player', () => {
  it('two characters on one seat carry their own triads', () => {
    let room = seated('2v2', ['a', 'b']);
    room = withPicks(room, 'a', [
      { characterId: 'ash', catalysts: ['ward', 'shift', 'surge'] },
      { characterId: 'bry', catalysts: ['brace', 'shift', 'surge'] },
    ]);
    room = withPicks(room, 'b', pick('cyn', 'dex'));

    const started = startFromPicks(room, OPEN, roster);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const of = (id: string) => started.room.state!.units.find((u) => u.characterId === id)!.catalysts;
    expect(of('ash')).toEqual(['ward', 'shift', 'surge']);
    expect(of('bry'), 'a different loadout on the same player').toEqual(['brace', 'shift', 'surge']);
  });

  it('an unchosen triad falls back to the defaults rather than blocking the start', () => {
    // A lobby mid-pick is the normal state of a lobby: choosing a character and
    // not yet its catalysts must not be an error, and `createMatch` already has
    // the fallback.
    let room = seated('2v2', ['a', 'b']);
    room = withPicks(room, 'a', [{ characterId: 'ash' }, { characterId: 'bry' }]);
    room = withPicks(room, 'b', pick('cyn', 'dex'));
    expect(lobbyReady(room), 'complete without a triad').toBe(true);

    const started = startFromPicks(room, OPEN, roster);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const ash = started.room.state!.units.find((u) => u.characterId === 'ash')!;
    expect(ash.catalysts).toEqual(['second_wind', 'shift', 'adrenaline']);
  });

  it('the stored picks are copies — a caller keeping its array cannot edit the room', () => {
    const mutable = ['ward', 'shift', 'surge'];
    const room = withPicks(seated('2v2', ['a', 'b']), 'a', [
      { characterId: 'ash', catalysts: mutable }, { characterId: 'bry' },
    ]);
    mutable[0] = 'brace';
    expect(room.seats.find((s) => s.seatId === 'a')!.picks[0]!.catalysts).toEqual(['ward', 'shift', 'surge']);
  });
});

describe('M3-LOBBY: ready is stricter than startable', () => {
  it('a seated, coverable room with no picks can start as a ROOM but not as a LOBBY', () => {
    const room = seated('2v2', ['a', 'b']);
    expect(lobbyReady(room)).toBe(false);
    expect(startFromPicks(room, OPEN, roster).ok, 'and start refuses it').toBe(false);
    // The interim deal is untouched — it is what M3-START still uses.
    expect(startMatch(room, OPEN, [[roster['ash']!, roster['bry']!], [roster['cyn']!, roster['dex']!]]).ok)
      .toBe(true);
  });

  it('one seat still choosing holds the whole lobby', () => {
    const room = withPicks(seated('2v2', ['a', 'b']), 'a', pick('ash', 'bry'));
    expect(lobbyReady(room)).toBe(false);
    expect(teamsFromPicks(room, roster)).toBeUndefined();
  });

  it('everybody picked, both teams covered — ready', () => {
    let room = withPicks(seated('2v2', ['a', 'b']), 'a', pick('ash', 'bry'));
    room = withPicks(room, 'b', pick('cyn', 'dex'));
    expect(lobbyReady(room)).toBe(true);

    const chosen = teamsFromPicks(room, roster)!;
    expect(chosen.teams[0].map((c) => c.id)).toEqual(['ash', 'bry']);
    expect(chosen.teams[1].map((c) => c.id)).toEqual(['cyn', 'dex']);
    expect(chosen.picks[0]).toEqual([TRIAD, TRIAD]);
  });

  it('a lobby that lost a seat is not ready any more, and says so before starting', () => {
    // The counts move when a player leaves — the remaining player now owes two
    // characters, not one — so a lobby that was complete no longer is.
    let room = seated('2v2', ['a', 'b', 'c', 'd']);
    for (const [seatId, id] of [['a', 'ash'], ['c', 'bry'], ['b', 'cyn'], ['d', 'dex']] as const) {
      room = withPicks(room, seatId, pick(id));
    }
    expect(lobbyReady(room)).toBe(true);
    const short = { ...room, seats: room.seats.filter((s) => s.seatId !== 'c') };
    expect(charactersPerSeat(short, 'a'), 'the survivor now runs both').toBe(2);
    expect(lobbyReady(short)).toBe(false);
  });

  it('a started room is never "ready" again — the lobby is over', () => {
    let room = withPicks(seated('2v2', ['a', 'b']), 'a', pick('ash', 'bry'));
    room = withPicks(room, 'b', pick('cyn', 'dex'));
    const started = startFromPicks(room, OPEN, roster);
    expect(started.ok).toBe(true);
    if (started.ok) expect(lobbyReady(started.room)).toBe(false);
  });
});
