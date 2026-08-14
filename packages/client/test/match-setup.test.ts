import { describe, expect, it } from 'vitest';
import { createMatch, type CharacterDef, type MapDef } from '@cards/engine';
import { dealTeams, describeSetup, parseSetup } from '../src/match-setup.js';
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

/**
 * MAPTOGGLE — the URL picks the match, and the reason it exists is that
 * `iron-basin` + 4v4 was validated by tests but unreachable in the browser.
 * The last test here is the one that matters: the 4v4 setup this parser
 * produces actually starts.
 */

const MAPS = [duelArena, ironBasin] as unknown as MapDef[];
const CATALOG = [vex, bastion, wisp, aegis, cinder, lumen, ravok, thorn] as unknown as CharacterDef[];

const setupFor = (search: string) => {
  const result = parseSetup(search, MAPS, CATALOG);
  if ('errors' in result) throw new Error(`expected a setup, got: ${result.errors.join('; ')}`);
  return result.setup;
};
const errorsFor = (search: string): string[] => {
  const result = parseSetup(search, MAPS, CATALOG);
  return 'errors' in result ? result.errors : [];
};

describe('MAPTOGGLE: the URL picks the match', () => {
  it('defaults to the 2v2 demo this file used to hard-code', () => {
    const setup = setupFor('');
    expect(setup.map.id).toBe('duel-arena');
    expect(setup.format).toBe('2v2');
    expect(setup.playersPerTeam).toEqual([2, 1]);
    expect(setup.teams[0].map((c) => c.id)).toEqual(['vex', 'wisp']);
    expect(setup.teams[1].map((c) => c.id)).toEqual(['bastion', 'aegis']);
  });

  it('?map=iron-basin&format=4v4 reaches the 4v4 map — the whole point', () => {
    const setup = setupFor('?map=iron-basin&format=4v4');
    expect(setup.map.id).toBe('iron-basin');
    expect(setup.format).toBe('4v4');
    expect(setup.teams[0]).toHaveLength(4);
    expect(setup.teams[1]).toHaveLength(4);
    // Eight distinct characters — duplicate picking is an M3 lobby concern
    // precisely because the dev deal cannot produce one.
    expect(new Set(setup.teams.flat().map((c) => c.id)).size).toBe(8);
  });

  it('tolerates a leading ? or none', () => {
    expect(setupFor('map=iron-basin').map.id).toBe('iron-basin');
    expect(setupFor('?map=iron-basin').map.id).toBe('iron-basin');
  });

  it('seats however many players the URL asks for', () => {
    expect(setupFor('?players=1,1').playersPerTeam).toEqual([1, 1]);
    expect(setupFor('?format=4v4&map=iron-basin').playersPerTeam).toEqual([2, 2]);
  });

  it('a typo is an error, never a silent fallback', () => {
    // Quietly loading duel-arena because you mistyped the map you wanted to
    // test is the one behaviour a dev toggle must not have.
    expect(errorsFor('?map=iron-bason').join(' ')).toMatch(/unknown map/);
    expect(errorsFor('?format=3v3').join(' ')).toMatch(/unknown format/);
    expect(errorsFor('?players=lots').join(' ')).toMatch(/two positive integers/);
    expect(errorsFor('?players=0,2').join(' ')).toMatch(/two positive integers/);
  });

  it('rejects a format the chosen map cannot seat', () => {
    // Both shipped maps happen to carry four spawn squares per team, so this
    // needs a map that does not — the check is worth having precisely because
    // the next map added might forget.
    const cramped: MapDef = {
      id: 'cramped', name: 'Cramped', width: 9, height: 9, walls: [], cover: [], brush: [],
      spawns: [[{ x: 1, y: 4 }], [{ x: 7, y: 4 }]],
    };
    const result = parseSetup('?map=cramped&format=4v4', [cramped], CATALOG);
    expect('errors' in result && result.errors.length).toBeTruthy();
    // …and the same map is fine at the format it *can* seat.
    expect('setup' in parseSetup('?map=cramped&format=1v1', [cramped], CATALOG)).toBe(true);
  });

  it('4v4 works on duel-arena too — both shipped maps seat four a side', () => {
    expect(setupFor('?format=4v4').map.id).toBe('duel-arena');
  });

  it('reports every problem at once rather than the first', () => {
    expect(errorsFor('?map=nope&format=nope').length).toBe(2);
  });

  it('names what is loaded', () => {
    expect(describeSetup(setupFor('?map=iron-basin&format=4v4'))).toContain('4v4');
    expect(describeSetup(setupFor(''))).toContain(duelArena.name);
  });
});

describe('MAPTOGGLE: dealTeams', () => {
  it('alternates, so both sides get a comparable mix however long the list grows', () => {
    const [a, b] = dealTeams(CATALOG, 3);
    expect(a.map((c) => c.id)).toEqual(['vex', 'wisp', 'cinder']);
    expect(b.map((c) => c.id)).toEqual(['bastion', 'aegis', 'lumen']);
  });
});

describe('MAPTOGGLE: the setups it produces actually start', () => {
  it.each([
    ['', '2v2'],
    ['?format=1v1', '1v1'],
    ['?map=iron-basin&format=4v4', '4v4'],
  ])('%s starts a %s match', (search, format) => {
    const setup = setupFor(search);
    const state = createMatch(setup.map, setup.format, setup.teams);
    expect(state.format).toBe(format);
    expect(state.units.filter((u) => u.owner === 0)).toHaveLength(setup.teams[0].length);
    expect(state.units.filter((u) => u.owner === 1)).toHaveLength(setup.teams[1].length);
    // Every unit landed on a spawn square of its own team's block.
    for (const u of state.units) {
      expect(setup.map.spawns[u.owner].some((p) => p.x === u.pos.x && p.y === u.pos.y)).toBe(true);
    }
  });
});
