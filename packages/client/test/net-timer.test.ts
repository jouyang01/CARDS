// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DECISION_SECONDS, TIMEBANK_CHARGES, TIMEBANK_SECONDS } from '@cards/engine';
import type { ServerMessage } from '@cards/server/protocol';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import type { CharacterDef, MapDef, Roster } from '@cards/engine';
import { RoomClient, applyServerMessage, frames, initialNet } from '../src/net.js';
import { createHud } from '../src/hud.js';
import { timerView } from '../src/timer.js';
import { waitingLabel } from '../src/waiting.js';
import type { HudCharacter, HudModel } from '../src/hud.js';

/**
 * M3-TIMER, client side — the countdown is **displayed**, never owned.
 *
 * The enforcement is the server's and is tested there. What is left over here is
 * three claims, and they are the ones a networked client can get wrong on its
 * own:
 *
 * 1. The window that reaches the screen is the one the server sent, held as a
 *    duration and never re-derived from `DECISION_SECONDS`.
 * 2. Pressing the Time Bank **asks**; nothing is applied locally, so a refusal
 *    cannot leave the clock showing time the server does not think exists.
 * 3. The countdown sits **beside** the wait banner and does not replace it —
 *    banner = what you are waiting for, timer = how long. Two sentences, two
 *    nodes; a UI that reused one for both would make the pair impossible.
 */

const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }, { x: 1, y: 9 }], [{ x: 13, y: 7 }, { x: 13, y: 9 }]],
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
  readonly frames: string[] = [];
  constructor(readonly client: RoomClient) {}
  send(data: string): void { this.frames.push(data); this.client.receive(data); }
  close(): void { this.client.closed(); }
}

/** A started 1v1 with a real client on seat 0 and a clock the test drives. */
const wired = () => {
  const sent: string[] = [];
  const client = new RoomClient({ send: (d) => sent.push(d), close: () => {} });
  const clock = { t: 5_000 };
  const hub = new RoomHub(createRoom('WXYZ', '1v1'), config, () => clock.t);
  hub.open('s0', new Wire(client));
  hub.open('s1', { send: () => {}, close: () => {} });
  hub.receive('s0', JSON.stringify({ type: 'join', version: 1, name: 'A' }));
  hub.receive('s1', JSON.stringify({ type: 'join', version: 1, name: 'B' }));
  hub.receive('s0', JSON.stringify({ type: 'start' }));
  return { hub, clock, client, sent };
};

describe('M3-TIMER: the client holds the server\'s window, and derives none of it', () => {
  it('a decision carries the window, and the reducer keeps it verbatim', () => {
    const { client } = wired();
    expect(client.net.remainingMs).toBe(DECISION_SECONDS * 1000);
    expect(client.net.bank).toBe(TIMEBANK_CHARGES);
  });

  it('and it is what the server said, not what the constant says', () => {
    // The regression: a client that restarted a full 40 s window of its own on
    // every turn would agree with the server exactly once — at the start — and
    // then be wrong by the round trip forever after.
    const { hub, clock, client } = wired();
    clock.t += 17_000;
    hub.receive('s1', JSON.stringify({ type: 'submit', orders: [] }));
    expect(client.net.remainingMs).toBe(DECISION_SECONDS * 1000 - 17_000);
    expect(client.net.remainingMs, 'not the full window').not.toBe(DECISION_SECONDS * 1000);
  });

  it('a finished match leaves no window to draw', () => {
    const folded = applyServerMessage(initialNet(), {
      type: 'decision', turn: 9, state: { turn: 9, units: [] } as never, visibleSquares: [],
      orders: {}, locked: [], of: 1, enemyLocked: 0, enemyOf: 1, bank: 0, unitIds: [],
    });
    expect(folded.remainingMs, 'no countdown rather than a zero').toBeUndefined();
  });

  it('and no other frame moves the clock — only a decision carries one', () => {
    // `pong`, `submitted` and the rest copy the previous `remainingMs` forward
    // unchanged, which is exactly what lets the controller forward only the
    // frames where it *changed* instead of re-anchoring on every heartbeat.
    const { client } = wired();
    const held = client.net.remainingMs;
    client.receive(JSON.stringify({ type: 'pong' } satisfies ServerMessage));
    expect(client.net.remainingMs).toBe(held);
  });
});

describe('M3-TIMER: the Time Bank asks, it does not apply', () => {
  it('the frame is bare — what a charge buys is the engine\'s number', () => {
    expect(frames.extend()).toEqual({ type: 'extend' });
    expect(TIMEBANK_SECONDS, 'and it lives in the engine').toBeGreaterThan(0);
  });

  it('pressing it changes nothing locally until the server answers', () => {
    const sent: string[] = [];
    const client = new RoomClient({ send: (d) => sent.push(d), close: () => {} });
    const before = client.net;
    client.extend();
    expect(JSON.parse(sent[0]!)).toEqual({ type: 'extend' });
    expect(client.net, 'the state is untouched by the ask').toBe(before);
  });

  it('the extension arrives as more time and one fewer charge', () => {
    const { hub, clock, client } = wired();
    clock.t += 34_000;
    hub.receive('s0', JSON.stringify({ type: 'extend' }));
    expect(client.net.remainingMs).toBe(6_000 + TIMEBANK_SECONDS * 1000);
    expect(client.net.bank).toBe(TIMEBANK_CHARGES - 1);
  });

  it('a refused extension leaves the clock exactly where it was', () => {
    // The lie an optimistic +10 s would tell: time on screen the server does
    // not believe in, and a turn that resolves while the readout still reads 9.
    const { hub, client } = wired();
    hub.receive('s0', JSON.stringify({ type: 'extend' }));
    const after = client.net.remainingMs;
    hub.receive('s0', JSON.stringify({ type: 'extend' }));
    expect(client.net.error?.code).toBe('noBank');
    expect(client.net.remainingMs, 'unmoved').toBe(after);
    expect(client.net.bank).toBe(0);
  });
});

const noop = (): void => {};
const character: HudCharacter = {
  unitId: 'u', name: 'T', archetype: 'firepower', colour: '#4f8cff',
  hp: 100, maxHp: 100, energy: 0, shield: 0, locked: false, hasOrder: false, statuses: [],
};
const model: HudModel = {
  active: character,
  roster: [character],
  abilities: [],
  catalysts: [],
  move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
  chase: { armed: false, disabled: false },
  lock: { label: 'Lock In' },
  view: { projection: 'Ortho', orbit: false },
};

describe('M3-TIMER: the countdown sits beside the banner, not over it', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  const handlers = {
    selectCharacter: noop, selectAbility: noop, selectCatalyst: noop, hoverAbility: noop,
    selectMove: noop, selectChase: noop, hoverMove: noop, hold: noop, lock: noop,
    toggleProjection: noop, toggleOrbit: noop, extendTime: noop,
  };
  const timerText = (): HTMLElement | null => root.querySelector('.hud-timer-text');
  const banner = (): HTMLElement | null => root.querySelector('.hud-banner');
  /** Neither the node nor the row it sits in is hidden. */
  const shown = (el: HTMLElement | null): boolean =>
    el !== null && el.style.display !== 'none' && el.parentElement?.style.display !== 'none';

  it('both are on screen at once, and neither is the other', () => {
    const hud = createHud(root, handlers);
    hud.update(model);
    const wait = waitingLabel({ seatId: 'a', own: ['a'], ownOf: 1, enemyReady: 0, enemyOf: 1 })!;
    hud.setBanner(wait);
    hud.setTimer(timerView(12_400, 1));

    expect(banner()?.textContent, 'what you are waiting for').toBe(wait);
    expect(timerText()?.textContent, 'how long it can last').toBe('13');
    expect(shown(banner()), 'the banner is visible').toBe(true);
    expect(shown(timerText()), 'and so is the countdown').toBe(true);
    expect(banner()?.textContent).not.toContain('13');
  });

  it('the banner arriving does not clear the countdown', () => {
    // The failure this closes is the obvious implementation: one status line
    // that the wait banner writes into, wiping whatever the clock had put there.
    const hud = createHud(root, handlers);
    hud.update(model);
    hud.setTimer(timerView(9_100, 1));
    const before = timerText()?.textContent;
    hud.setBanner('Locked in · waiting for 1 opponent(s)');
    expect(timerText()?.textContent, 'still counting').toBe(before);
  });

  it('and the countdown ticking does not clear the banner', () => {
    const hud = createHud(root, handlers);
    hud.update(model);
    const wait = 'Locked in · resolving…';
    hud.setBanner(wait);
    for (const ms of [8_000, 7_000, 6_000]) hud.setTimer(timerView(ms, 0));
    expect(banner()?.textContent, 'the reason survived three repaints').toBe(wait);
    expect(timerText()?.textContent).toBe('6.0');
  });

  it('an ended window hides the countdown and leaves the banner alone', () => {
    const hud = createHud(root, handlers);
    hud.update(model);
    hud.setBanner('Connection lost — the match is paused. Reload to rejoin.');
    hud.setTimer(undefined);
    expect(root.querySelector<HTMLElement>('.hud-timer')?.style.display).toBe('none');
    expect(banner()?.style.display, 'the reason is still the point').not.toBe('none');
  });
});
