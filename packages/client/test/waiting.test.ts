// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { CatalystData, CharacterDef, MapDef, Roster } from '@cards/engine';
import { buildCatalystPool, buildRoster } from '@cards/engine';
import { RoomHub, type MatchConfig, type Sink } from '@cards/server/hub';
import { createRoom } from '@cards/server/room';
import { RoomClient } from '../src/net.js';
import { connectionLabel, isWaiting, waitingLabel, type WaitView } from '../src/waiting.js';
import catalystData from '../../../data/catalysts.json';
import duelArena from '../../../data/maps/duel-arena.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';

/**
 * M3-WAIT-STATE and M3-CONN-STATE — the two sentences a networked client owes
 * the player when the board stops taking orders.
 *
 * Both items exist for the same reason: an unexplained stall is
 * indistinguishable from a freeze. A submitted turn left the HUD armed with
 * nothing saying the turn was gone, and a dropped socket left the board simply
 * not responding.
 *
 * The interesting constraint is **M3-HIDDEN**. This is the one string in the
 * client that mentions the other team, so it is the one place the count-only
 * rule can be broken — which is why the shape carries the enemy as a *number*
 * and own-team as a *list*. There is no enemy id in scope to leak by accident.
 */

const view = (over: Partial<WaitView> = {}): WaitView =>
  ({ seatId: 'a', own: [], ownOf: 1, enemyReady: 0, enemyOf: 1, ...over });

describe('M3-WAIT-STATE: the waiting line', () => {
  it('says nothing while this client is still deciding', () => {
    // `undefined` is the signal the controller acts on — the HUD stays armed.
    expect(waitingLabel(view({ own: [] }))).toBeUndefined();
    expect(isWaiting(view({ own: [] }))).toBe(false);
    expect(waitingLabel(undefined), 'and before any decision payload').toBeUndefined();
  });

  it('says the turn is locked once this seat is in the list', () => {
    const label = waitingLabel(view({ own: ['a'] }))!;
    expect(label).toMatch(/^Locked in/);
    expect(isWaiting(view({ own: ['a'] }))).toBe(true);
  });

  it('counts the opponents still to come, and never names one', () => {
    // The M3-HIDDEN half. "1 opponent(s)" is what a waiting UI needs; *which*
    // opponent is the one identity that must not appear before the reveal.
    const label = waitingLabel(view({ own: ['a'], enemyReady: 1, enemyOf: 2 }))!;
    expect(label).toContain('1 opponent');
    expect(label, 'no seat id of theirs').not.toMatch(/\bb\b|seat/);
  });

  it('and switches to "resolving" once they are all in', () => {
    expect(waitingLabel(view({ own: ['a'], enemyReady: 2, enemyOf: 2 }))!).toMatch(/resolving/);
  });

  it('a teammate still deciding is named by COUNT on your own side too', () => {
    // Own-team lock state is per-seat in the payload (UI-INTENT draws it on the
    // board); the banner is a summary, so it reads as a fraction either way.
    const label = waitingLabel(view({ seatId: 'a', own: ['a'], ownOf: 2, enemyOf: 1 }))!;
    expect(label).toContain('your team 1/2');
  });

  it('a solo seat says nothing about a team it does not have', () => {
    expect(waitingLabel(view({ own: ['a'], ownOf: 1 }))!).not.toContain('your team');
  });
});

describe('M3-CONN-STATE: the connection banner', () => {
  it('a closed socket says so', () => {
    expect(connectionLabel('closed')).toMatch(/connection lost/i);
  });

  it('and every live phase says nothing', () => {
    for (const phase of ['connecting', 'lobby', 'match'] as const) {
      expect(connectionLabel(phase), phase).toBeUndefined();
    }
  });
});

/**
 * The two rules composed against a **real** hub, because the ordering between
 * them is a decision: a dead socket outranks whose turn it is, and the reason it
 * outranks it is that nothing else is ever going to arrive.
 */
const CATALOG = [vex, bastion, wisp, aegis] as unknown as CharacterDef[];
const roster: Roster = buildRoster(CATALOG);
const config: MatchConfig = {
  map: duelArena as unknown as MapDef,
  roster,
  catalysts: buildCatalystPool(catalystData as unknown as CatalystData),
};

class Wire implements Sink {
  readonly client: RoomClient;
  constructor(private readonly hub: RoomHub, private readonly seatId: string) {
    this.client = new RoomClient({
      send: (data: string) => { this.hub.receive(this.seatId, data); },
      close: () => { this.hub.close(this.seatId); },
    });
    this.hub.open(seatId, this);
  }
  send(data: string): void { this.client.receive(data); }
  close(): void { this.client.closed(); }
}

/** The banner a client would show, composed the way `main.ts` composes it. */
const bannerFor = (client: RoomClient): string | undefined =>
  connectionLabel(client.net.phase) ?? waitingLabel(
    client.net.seat === undefined ? undefined : {
      seatId: client.net.seat.seatId,
      own: client.net.locked,
      ownOf: client.net.of,
      enemyReady: client.net.enemyLocked,
      enemyOf: client.net.enemyOf,
    },
  );

const started = () => {
  const hub = new RoomHub(createRoom('WXYZ', '2v2', 'duel-arena'), config);
  const a = new Wire(hub, 'a');
  const b = new Wire(hub, 'b');
  a.client.join('Ada');
  b.client.join('Bo');
  a.client.pick([{ characterId: 'vex' }, { characterId: 'wisp' }]);
  b.client.pick([{ characterId: 'bastion' }, { characterId: 'aegis' }]);
  a.client.start();
  return { hub, a, b };
};

describe('the banner over a real match', () => {
  const hold = (client: RoomClient) => client.net.unitIds.map((unitId) => ({ unitId }));

  it('nothing at the start of a turn — the board is taking orders', () => {
    const { a } = started();
    expect(bannerFor(a.client)).toBeUndefined();
  });

  it('locked and waiting the moment this seat submits', () => {
    const { a } = started();
    a.client.submit(hold(a.client));
    const banner = bannerFor(a.client)!;
    expect(banner).toMatch(/^Locked in/);
    expect(banner).toContain('1 opponent');
  });

  it('and gone again once the turn resolves — the next turn is orderable', () => {
    // The lock clears on `turnResolved`, which is what re-arms the HUD. A board
    // that stayed locked would be a match you could only play one turn of.
    const { a, b } = started();
    a.client.submit(hold(a.client));
    expect(bannerFor(a.client)).toBeDefined();
    b.client.submit(hold(b.client));
    expect(bannerFor(a.client), 'a fresh turn, nothing to wait for').toBeUndefined();
  });

  it('the opponent submitting first does not lock THIS board', () => {
    // The asymmetry that matters: their readiness is information, not a state
    // change here. This client is still deciding and must still be able to.
    const { a, b } = started();
    b.client.submit(hold(b.client));
    expect(bannerFor(a.client), 'still my turn to plan').toBeUndefined();
  });

  it('never names an enemy seat, at any point in the turn', () => {
    const { a, b } = started();
    const seen: string[] = [];
    for (const step of [() => a.client.submit(hold(a.client)), () => b.client.submit(hold(b.client))]) {
      step();
      const banner = bannerFor(a.client);
      if (banner !== undefined) seen.push(banner);
    }
    const enemySeatId = b.client.net.seat!.seatId;
    for (const banner of seen) {
      expect(banner, `"${banner}" named the enemy seat`).not.toContain(enemySeatId);
    }
  });

  it('a closed socket wins over the waiting line', () => {
    // Ordering as a decision, not an accident: once the socket is gone the
    // resolution this client is "waiting for" is never coming, so saying it is
    // waiting would be the more misleading of the two true statements.
    const { a } = started();
    a.client.submit(hold(a.client));
    expect(bannerFor(a.client)).toMatch(/^Locked in/);
    a.client.closed();
    expect(bannerFor(a.client)).toMatch(/connection lost/i);
  });
});
