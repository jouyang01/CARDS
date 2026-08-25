// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildRoster, createMatch, type CharacterDef, type MapDef, type Roster,
} from '@cards/engine';
import { describeSetup, parseSetup } from '../src/match-setup.js';
import { startHotSeat } from '../src/app.js';
import { OPEN_MAP, armAbility, mountUI, modeButtons, recordingNet } from './app-harness.js';
import duelArena from '../../../data/maps/duel-arena.json';
import ironBasin from '../../../data/maps/iron-basin.json';
import vex from '../../../data/characters/vex.json';
import bastion from '../../../data/characters/bastion.json';
import wisp from '../../../data/characters/wisp.json';
import aegis from '../../../data/characters/aegis.json';
import cinder from '../../../data/characters/cinder.json';
import lumen from '../../../data/characters/lumen.json';
import ravok from '../../../data/characters/ravok.json';
import thorn from '../../../data/characters/thorn.json';
import kestrel from '../../../data/characters/kestrel.json';

/**
 * DEV-CHARSELECT — `?chars=` seats a chosen roster in the hot-seat (Builder OQ
 * 2026-09-19 #2).
 *
 * The hot-seat deals the first `perTeam * 2` of the catalogue and always has:
 * Vex + Wisp against Bastion + Aegis. **Kestrel is the only character with a
 * two-mode ability**, and she is last in the catalogue *on purpose*, so that
 * adding her did not move anybody in that deal — which left the one piece of
 * client wiring that most wants hand-testing (the Focus/Spread toggle, whose
 * bug was KESTREL-CONE) reachable only by opening a lobby and finding a second
 * player. `?chars=kestrel,vex` is that, in a URL.
 *
 * The interesting half is the failure, and it has been **reversed once**
 * (DEV-CHARSELECT-ERROR). It shipped falling back to the ordinary deal with a
 * notice on screen, which was the original AC; the Analyzer took the Builder's
 * own flag and settled it the other way. Every other parameter in
 * `match-setup.ts` treats a typo as an error that refuses to load — silently
 * loading `duel-arena` because you mistyped the map is the one outcome a dev
 * toggle must not have (DECISIONS 2026-09-18) — and a notice beside a board
 * that is already running is a notice you play past. `?chars=kestrell` now
 * stops the page and names the ids that would have worked.
 */

const MAPS = [duelArena, ironBasin] as unknown as MapDef[];
const CATALOG = [vex, bastion, wisp, aegis, cinder, lumen, ravok, thorn, kestrel] as unknown as CharacterDef[];
const KESTREL = kestrel as unknown as CharacterDef;
const TWIN = KESTREL.abilities.find((a) => a.id === 'twin_bolts')!;

const setupFor = (search: string) => {
  const result = parseSetup(search, MAPS, CATALOG);
  if ('errors' in result) throw new Error(`expected a setup, got: ${result.errors.join('; ')}`);
  return result.setup;
};
const errorsFor = (search: string): string[] => {
  const result = parseSetup(search, MAPS, CATALOG);
  return 'errors' in result ? result.errors : [];
};
const ids = (team: CharacterDef[]): string[] => team.map((c) => c.id);

beforeEach(() => { document.body.replaceChildren(); });

describe('DEV-CHARSELECT: the roster comes from the URL', () => {
  it('with no `chars`, the deal is exactly what it always was', () => {
    // The whole feature is additive: a URL that does not ask for it must load
    // the same match it loaded yesterday.
    const setup = setupFor('');
    expect(ids(setup.teams[0])).toEqual(['vex', 'wisp']);
    expect(ids(setup.teams[1])).toEqual(['bastion', 'aegis']);
    expect(setup.chars, 'and nothing claims to have been chosen').toBeUndefined();
  });

  it('`chars` deals alternately, so it reads left to right as the matchup', () => {
    const setup = setupFor('?chars=kestrel,ravok,thorn,lumen');
    expect(ids(setup.teams[0])).toEqual(['kestrel', 'thorn']);
    expect(ids(setup.teams[1])).toEqual(['ravok', 'lumen']);
  });

  it('a 1v1 takes two, and Kestrel can be one of them', () => {
    // The AC's named case, and the reason the item exists.
    const setup = setupFor('?format=1v1&chars=kestrel,vex');
    expect(ids(setup.teams[0])).toEqual(['kestrel']);
    expect(ids(setup.teams[1])).toEqual(['vex']);
  });

  it('extra ids past what the format needs are left out, not squeezed in', () => {
    const setup = setupFor('?format=1v1&chars=kestrel,vex,thorn,lumen');
    expect(setup.chars).toEqual(['kestrel', 'vex']);
    expect(setup.teams.flat()).toHaveLength(2);
  });

  it('ids are trimmed and case-insensitive, because a URL is typed by hand', () => {
    const setup = setupFor('?format=1v1&chars= Kestrel , VEX ');
    expect(setup.chars).toEqual(['kestrel', 'vex']);
  });

  it('and it composes with the map and format it is typed beside', () => {
    const setup = setupFor('?map=iron-basin&format=4v4&chars=kestrel,vex,thorn,lumen,ravok,cinder,wisp,aegis');
    expect(setup.map.id).toBe('iron-basin');
    expect(ids(setup.teams[0])).toEqual(['kestrel', 'thorn', 'ravok', 'wisp']);
    expect(ids(setup.teams[1])).toEqual(['vex', 'lumen', 'cinder', 'aegis']);
  });

  it('the setup it produces actually starts', () => {
    // The assertion that matters for a dev route: not that the parse looked
    // right, but that `createMatch` accepts what came out of it.
    const setup = setupFor('?format=1v1&chars=kestrel,vex');
    const state = createMatch(setup.map, setup.format, setup.teams);
    expect(state.units.map((u) => u.characterId)).toEqual(['kestrel', 'vex']);
  });
});

describe('DEV-CHARSELECT-ERROR: a bad id refuses to load', () => {
  it('an unknown id is an error, and NO roster is dealt', () => {
    // The reversal, in its own assertion: the previous behaviour returned a
    // playable setup on the default deal. A dev who typed a name and got a
    // board would reasonably assume they got the board they asked for.
    const result = parseSetup('?chars=kestrell,vex,thorn,lumen', MAPS, CATALOG);
    expect('errors' in result, 'it refuses to load').toBe(true);
    expect('setup' in result, 'and seats nobody').toBe(false);
  });

  it('and says which one, with the ids that would have worked', () => {
    // "No such character" on its own sends you to the source to find out what
    // is spelled how. The list is the whole usefulness of the message.
    const errors = errorsFor('?chars=kestrell,vex,thorn,lumen');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"kestrell"');
    expect(errors[0], 'the roster, so the next attempt lands').toContain('kestrel');
    expect(errors[0]).toContain('ravok');
  });

  it('it is all-or-nothing: one bad id does not seat the three good ones', () => {
    // A partial substitution would be the worst outcome of the three, with most
    // of the roster right to make it look deliberate.
    expect(errorsFor('?chars=vex,bastion,thorn,nobody')).toHaveLength(1);
  });

  it('too few for the format is the same kind of complaint', () => {
    // 4v4 lives on iron-basin now (Proving Grounds is a dedicated 2v2 map), so
    // name it — otherwise the spawn-count check trips first and hides the point.
    expect(errorsFor('?map=iron-basin&format=4v4&chars=kestrel,vex')[0]).toContain('needs 8 characters');
  });

  it('a good `chars` produces no error at all', () => {
    // The control: an error on a healthy load would make the toggle unusable.
    expect(errorsFor('?format=1v1&chars=kestrel,vex')).toEqual([]);
  });

  it('and it reads like its neighbours, because it now behaves like them', () => {
    // The consistency this item bought: a mistyped character and a mistyped map
    // fail the same way, so nobody has to remember which one is different.
    const chars = errorsFor('?chars=nobody,vex,thorn,lumen')[0] ?? '';
    const map = errorsFor('?map=nope')[0] ?? '';
    expect(chars).toContain('unknown character');
    expect(map).toContain('unknown map');
    for (const message of [chars, map]) expect(message).toContain('try one of');
  });

  it('a bad `map` beside a good `chars` is still an error too', () => {
    expect(errorsFor('?map=nope&chars=kestrel,vex')).not.toEqual([]);
  });
});

describe('DEV-CHARSELECT: what is loaded is written down', () => {
  it('the description names the chosen roster', () => {
    // "Am I actually playing Kestrel" is the first question after typing it.
    expect(describeSetup(setupFor('?format=1v1&chars=kestrel,vex')))
      .toContain('chars: kestrel, vex');
  });

  it('and says nothing extra when the deal is the ordinary one', () => {
    expect(describeSetup(setupFor(''))).not.toContain('chars:');
  });

  it('a scenario still announces itself beside it', () => {
    const line = describeSetup(setupFor('?format=1v1&chars=kestrel,vex&scenario=in-brush'));
    expect(line).toContain('chars: kestrel, vex');
    expect(line).toContain('scenario: in-brush');
  });
});

describe('DEV-CHARSELECT: and the toggle it exists for is reachable', () => {
  it('a 1v1 seated from `chars` puts Kestrel\'s Focus/Spread in the HUD', () => {
    // The end of the sentence the AC asks for: not "the parser returned
    // Kestrel", but "the mode toggle is on screen and switchable by hand".
    // Driven through the real controller, like KESTREL-CONE's own tests.
    const setup = setupFor('?format=1v1&chars=kestrel,vex');
    const ui = mountUI();
    const opening = createMatch(OPEN_MAP, setup.format, setup.teams);
    const roster: Roster = buildRoster(setup.teams.flat());
    const wire = recordingNet('s0', 0, [opening.units[0]!.unitId]);
    startHotSeat(ui.ui, OPEN_MAP, roster, setup.teams, setup.format, [1, 1], {}, undefined,
      wire.net, opening);

    armAbility(ui.controls, TWIN.name);
    expect(modeButtons(ui.controls).map((n) => n.textContent)).toEqual(['Focus', 'Spread']);
  });
});
