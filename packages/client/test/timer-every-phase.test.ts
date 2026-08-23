// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DECISION_SECONDS, type CharacterDef, type MapDef, type Roster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient, applyServerMessage, initialNet } from '../src/net.js';
import { createHud, type HudCharacter, type HudModel } from '../src/hud.js';
import { timerView } from '../src/timer.js';

/**
 * TIMER-EVERY-PHASE — "lock-in timer disappears after turn 1" (Dev Note #5).
 *
 * The clock is the server's and the client re-anchors it whenever a Decision
 * payload arrives. The controller decided "a payload arrived" by watching
 * `remainingMs` and `bank` for a **change** — and that is precisely the one
 * signal that cannot see turn 2:
 *
 *   turn 1 opens →  remainingMs = 40000, bank = 1
 *   turn 2 opens →  remainingMs = 40000, bank = 1
 *
 * Both are a full window measured the instant it opened, so the numbers are
 * identical and the comparison was false. Meanwhile the timer had been stopped
 * for the resolution playback — so it stopped, and nothing ever started it
 * again. The whole match after turn 1 ran with no clock on screen.
 *
 * The fix is to stop inferring the event from the values: `windowSeq` counts
 * Decision payloads, so "a new window arrived" is a fact rather than a guess.
 * The first two tests below are the bug and the fix stated as one pair.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }], [{ x: 13, y: 7 }]],
};
const shot = {
  id: 'shot', name: 'shot', phase: 'blast' as const, shape: 'line' as const, range: 8,
  cooldown: 0, energyGain: 8, effects: [{ kind: 'damage' as const, amount: 20 }],
  description: 'shot',
};
const CHAR: CharacterDef = {
  id: 'test-char', name: 'T', archetype: 'firepower', maxHp: 100,
  abilities: [shot],
  ultimate: { ...shot, id: 'ult', shape: 'self', range: 0, effects: [{ kind: 'might', duration: 1 }] },
};
const roster: Roster = { 'test-char': CHAR };
const config: MatchConfig = { map: OPEN, roster, teams: [[CHAR], [CHAR]] };

/** A socket that hands whatever the hub says straight to a real `RoomClient`. */
class Wire implements Sink {
  constructor(readonly client: RoomClient) {}
  send(data: string): void { this.client.receive(data); }
  close(): void { this.client.closed(); }
}

/** A started 1v1 with a real client on seat 0 and a clock the test drives. */
const wired = () => {
  const client = new RoomClient({ send: () => {}, close: () => {} });
  const clock = { t: 5_000 };
  const hub = new RoomHub(createRoom('WXYZ', '1v1'), config, () => clock.t);
  hub.open('s0', new Wire(client));
  hub.open('s1', { send: () => {}, close: () => {} });
  hub.receive('s0', JSON.stringify({ type: 'join', version: 1, name: 'A' }));
  hub.receive('s1', JSON.stringify({ type: 'join', version: 1, name: 'B' }));
  hub.receive('s0', JSON.stringify({ type: 'start' }));
  const submit = (): void => {
    hub.receive('s0', JSON.stringify({ type: 'submit', orders: [] }));
    hub.receive('s1', JSON.stringify({ type: 'submit', orders: [] }));
  };
  return { hub, clock, client, submit };
};

describe('TIMER-EVERY-PHASE: two consecutive turns', () => {
  it('turn 2 opens with the SAME numbers turn 1 did — the reason it broke', () => {
    // Stated first, because everything else follows from it. Nothing about the
    // values distinguishes a fresh window from the one before it.
    const { client, submit } = wired();
    const first = { remainingMs: client.net.remainingMs, bank: client.net.bank };
    expect(first.remainingMs).toBe(DECISION_SECONDS * 1000);

    submit();
    expect(client.net.state?.turn, 'a second turn really did open').toBe(2);
    expect(client.net.remainingMs, 'identical').toBe(first.remainingMs);
    expect(client.net.bank, 'identical').toBe(first.bank);
  });

  it('…and the client can still tell them apart', () => {
    // The fix, as the counterpart to the test above: same numbers, different
    // window, and the controller re-anchors on the difference it can see.
    const { client, submit } = wired();
    const first = client.net.windowSeq;
    submit();
    expect(client.net.windowSeq, 'turn 2 is a new window').toBeGreaterThan(first);
  });

  it('and goes on telling them apart, turn after turn', () => {
    // The report is "after turn 1", so one extra turn would be a thin proof.
    const { client, submit } = wired();
    const seen = [client.net.windowSeq];
    for (let i = 0; i < 4; i++) {
      submit();
      seen.push(client.net.windowSeq);
    }
    expect(new Set(seen).size, 'five windows, five distinct answers').toBe(seen.length);
    expect([...seen].sort((a, b) => a - b), 'and it only ever goes up').toEqual(seen);
  });

  it('a re-sent Decision inside one turn is a new window too', () => {
    // A teammate locking in, or a Time Bank spend, re-sends the phase with a
    // fresh measurement — the countdown has to re-anchor for those as well, or
    // it drifts from the server's deadline by however long the frame took.
    const { hub, clock, client } = wired();
    const before = client.net.windowSeq;
    clock.t += 9_000;
    hub.receive('s1', JSON.stringify({ type: 'submit', orders: [] }));
    expect(client.net.windowSeq).toBe(before + 1);
    expect(client.net.remainingMs, 'and it carries the newer number')
      .toBe(DECISION_SECONDS * 1000 - 9_000);
  });
});

describe('TIMER-EVERY-PHASE: only a Decision carries a window', () => {
  it('a heartbeat does not move it', () => {
    // The other half of the rule. If every frame counted, the countdown would
    // re-anchor on every `pong` and never actually count down.
    const { client } = wired();
    const before = client.net.windowSeq;
    client.receive(JSON.stringify({ type: 'pong' }));
    expect(client.net.windowSeq).toBe(before);
  });

  it('nor does the resolution that precedes the new phase', () => {
    // `turnResolved` arrives first and carries no window; the `decision` that
    // follows it is the one that does. Pinned so the counter cannot start
    // meaning "a turn happened" instead of "a window opened".
    const { client } = wired();
    const before = client.net.windowSeq;
    client.receive(JSON.stringify({
      type: 'turnResolved', turn: 2, state: client.net.state, visibleSquares: [], events: [], orders: {},
    }));
    expect(client.net.windowSeq).toBe(before);
  });

  it('and it starts from a fresh client at zero, so the first window counts', () => {
    // `-1` in the controller against `0` here: the very first Decision has to
    // fire, or the timer would never appear at all.
    expect(initialNet().windowSeq).toBe(0);
    const first = applyServerMessage(initialNet(), {
      type: 'decision', turn: 1, state: { turn: 1, units: [] } as never, visibleSquares: [],
      orders: {}, locked: [], of: 1, enemyLocked: 0, enemyOf: 1, bank: 1, unitIds: [], remainingMs: 40_000,
    });
    expect(first.windowSeq).toBe(1);
  });
});

const character: HudCharacter = {
  unitId: 'u', name: 'T', archetype: 'firepower', colour: '#4f8cff',
  hp: 100, maxHp: 100, energy: 0, shield: 0, locked: false, hasOrder: false, statuses: [],
};
const noop = (): void => {};
const model: HudModel = {
  active: character,
  roster: [character],
  abilities: [],
  modes: [],
  rotations: [],
  catalysts: [],
  move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
  chase: { armed: false, disabled: false },
  lock: { label: 'Lock In' },
  view: { projection: 'Ortho', orbit: false },
};

describe('TIMER-EVERY-PHASE: the timer comes back after playback hid it', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  const hud = () => createHud(root, {
    selectCharacter: noop, selectAbility: noop, selectCatalyst: noop, hoverAbility: noop,
    selectMove: noop, selectChase: noop, hoverMove: noop, hold: noop, lock: noop,
    toggleProjection: noop, toggleOrbit: noop, recentre: noop, extendTime: noop, selectMode: noop, selectRotation: noop,
  });
  const timerRow = (): HTMLElement => root.querySelector<HTMLElement>('.hud-timer')!;
  const timerText = (): string => root.querySelector<HTMLElement>('.hud-timer-text')!.textContent ?? '';

  it('the turn-1 → playback → turn-2 sequence ends with a visible clock', () => {
    // The bug as the player saw it, in three calls: a clock, then playback
    // stopping it, then the new turn's window. Before the fix the third call
    // never happened and the row stayed hidden for the rest of the match.
    const view = hud();
    view.update(model);

    view.setTimer(timerView(DECISION_SECONDS * 1000, 1));
    expect(timerRow().style.display, 'turn 1 has a clock').not.toBe('none');

    view.setTimer(undefined); // playback: the plan is committed, the deadline is history
    expect(timerRow().style.display).toBe('none');

    view.setTimer(timerView(DECISION_SECONDS * 1000, 1));
    expect(timerRow().style.display, 'turn 2 has one again').not.toBe('none');
    expect(timerText()).toBe(String(DECISION_SECONDS));
  });

  it('and it counts, rather than being redrawn frozen at the full window', () => {
    const view = hud();
    view.update(model);
    view.setTimer(timerView(DECISION_SECONDS * 1000, 1));
    view.setTimer(undefined);
    view.setTimer(timerView(31_000, 1));
    view.setTimer(timerView(30_000, 1));
    expect(timerText()).toBe('30');
  });
});
