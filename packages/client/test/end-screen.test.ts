import { describe, expect, it } from 'vitest';
import { createMatch, resolveTurn, type CharacterDef, type GameState, type MapDef, type Roster } from '@cards/engine';
import { FRONT_DOOR, HOT_SEAT_DOOR, endHeadline, exitLabel, outcomeFor } from '../src/end-screen.js';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * M3-END-SCREEN — a decided match, from the point of view of whoever is looking
 * at it.
 *
 * The board already cleared, printed the reason and laid out SCORE1's
 * breakdown when a match ended. Two things were missing, and they are different
 * in kind:
 *
 * 1. **Whose win it was.** "Team 2 wins on kills, 4–2" is exactly right for a
 *    hot-seat, where one screen holds both sides, and useless to a networked
 *    seat that does not know whether it *is* Team 2.
 * 2. **A way out.** However it ended, the player was left on it.
 *
 * The winner is the engine's — `resolveOutcome` sets `status` and `winner`, and
 * nothing here re-derives either. What this file owns is the point of view,
 * which is why the tests are mostly about *perspective* rather than about
 * outcomes.
 */

const VEX = vex as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const roster: Roster = { vex: VEX, bastion: BASTION };
const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 7 }, { x: 2, y: 9 }], [{ x: 12, y: 7 }, { x: 12, y: 9 }]],
};

/** A state carrying just the two fields the outcome is read from. */
const ended = (over: Partial<Pick<GameState, 'status' | 'winner'>>): Pick<GameState, 'status' | 'winner'> =>
  ({ status: 'finished', ...over });

describe('M3-END-SCREEN: the outcome is a point of view', () => {
  it('a live match has none — which is the signal not to show a screen', () => {
    expect(outcomeFor({ status: 'active' }, 0)).toBeUndefined();
    expect(outcomeFor({ status: 'active', winner: 0 }, 0), 'even with a stale winner').toBeUndefined();
  });

  it('the same finished match is a win to one team and a loss to the other', () => {
    const state = ended({ winner: 1 });
    expect(outcomeFor(state, 1)).toBe('won');
    expect(outcomeFor(state, 0)).toBe('lost');
  });

  it('a draw is a draw from both sides', () => {
    for (const team of [0, 1] as const) {
      expect(outcomeFor({ status: 'draw' }, team)).toBe('draw');
    }
  });

  it('a finished match with no winner recorded reads as a draw, not as a loss', () => {
    // Defensive, and the safe direction: telling a player they lost a match the
    // engine never awarded is worse than calling an unrecorded end a draw.
    expect(outcomeFor(ended({ winner: undefined }), 0)).toBe('draw');
  });

  it('the headline is one blunt word', () => {
    expect(endHeadline('won')).toBe('Victory');
    expect(endHeadline('lost')).toBe('Defeat');
    expect(endHeadline('draw')).toBe('Draw');
  });
});

describe('M3-END-SCREEN: the way out', () => {
  it('a networked match goes back to the lobby, a hot-seat to a fresh one', () => {
    // The front door rather than a rematch: re-entering a room is a protocol
    // conversation nobody has specced, and the create form is already one click
    // from a new match.
    expect(FRONT_DOOR).toBe('?create');
    expect(HOT_SEAT_DOOR).toBe('?');
  });

  it('and says which it is, because the two are different journeys', () => {
    expect(exitLabel(true)).toMatch(/lobby/i);
    expect(exitLabel(false)).toMatch(/new match/i);
  });
});

describe('M3-END-SCREEN: against a match the engine actually ended', () => {
  /**
   * The claim that matters: the outcome is read off `resolveOutcome`'s own
   * fields rather than recomputed from kills. Driving a real match to its end
   * is the only way to be sure the two agree.
   */
  const toTheEnd = (): GameState => {
    let state = createMatch(OPEN, '1v1', [[VEX], [BASTION]]);
    // Park them next to each other and let team 0 shoot until the format's kill
    // target is met. `killsToWin` for 1v1 is 3, so this is a short match.
    state.units[0]!.pos = { x: 6, y: 7 };
    state.units[1]!.pos = { x: 7, y: 7 };
    for (let i = 0; i < 40 && state.status === 'active'; i++) {
      const shooter = state.units[0]!;
      const target = state.units[1]!;
      const orders = target.alive
        ? [{ unitId: shooter.unitId, ability: { abilityId: 'rail_shot', target: [{ ...target.pos }] } }]
        : [];
      state = resolveTurn(state, OPEN, [{ team: 0, units: orders }, { team: 1, units: [] }], roster).state;
    }
    return state;
  };

  it('the engine ends it, and both seats read the same match differently', () => {
    const state = toTheEnd();
    expect(state.status, 'the match is over').not.toBe('active');
    const winner = state.winner;
    if (state.status === 'draw' || winner === undefined) {
      expect(outcomeFor(state, 0)).toBe('draw');
      return;
    }
    expect(outcomeFor(state, winner)).toBe('won');
    expect(outcomeFor(state, winner === 0 ? 1 : 0)).toBe('lost');
  });

  it('and nothing here recomputed the winner — it is the engine\'s field', () => {
    // Stated as a property: flip the engine's own answer and the view follows
    // it, which it could not do if the view were deriving the winner from kills.
    const state = toTheEnd();
    if (state.status !== 'finished' || state.winner === undefined) return;
    const flipped = { status: state.status, winner: (state.winner === 0 ? 1 : 0) as 0 | 1 };
    expect(outcomeFor(flipped, state.winner), 'the view follows the field').toBe('lost');
  });

  it('every turn before the end offers no outcome at all', () => {
    let state = createMatch(OPEN, '1v1', [[VEX], [BASTION]]);
    for (let i = 0; i < 3; i++) {
      state = resolveTurn(state, OPEN, [{ team: 0, units: [] }, { team: 1, units: [] }], roster).state;
      expect(outcomeFor(state, 0), `turn ${state.turn}`).toBeUndefined();
    }
  });
});
