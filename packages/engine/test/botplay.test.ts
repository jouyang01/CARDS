import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRoster } from '../src/setup.js';
import { getFormat } from '../src/formats.js';
import type { Roster } from '../src/resolve.js';
import {
  formatReport, formatSweep, playMatch, playSeason, playSweep, type SeasonReport,
} from './bot.js';
import type { CharacterDef, MapDef } from '../src/types.js';

/**
 * BOTPLAY — *"Can you run a botted playtest?"*
 *
 * Two jobs in one file, and they are different jobs:
 *
 * 1. **A regression net.** A few hundred complete matches is a very wide net for
 *   the kind of bug a hand-written test never reaches — a turn that does not
 *   terminate, a match that runs past its limit, a unit healed above its bar, two
 *   units on one square. Those are asserted here, every CI run.
 * 2. **A measurement.** The pacing numbers the TTK package was tuned to move —
 *   how many turns a match takes, whether it ends on kills or on the clock, how
 *   much HP one turn can take off somebody — printed by `npm run botplay` and
 *   summarised in `docs/DECISIONS.md`.
 *
 * **What this is not.** It is not a substitute for the human playtest, and the
 * questions it cannot answer are most of the interesting ones: whether the wall
 * *reads*, whether twenty turns *drags*, whether being caught in the open is
 * frightening. The bot is also deliberately greedy and bad — it walks at the
 * nearest enemy and fires the biggest thing that reaches — so a match length
 * here is a **floor**, not an estimate: two players who bait, break line of
 * sight and hold cooldowns will take longer, not less.
 *
 * The assertions below are therefore **structural, not balance**. "Matches end"
 * is an invariant; "matches take 12 turns" is an observation, and pinning an
 * observation would make this file fail every time the owner tunes a number —
 * which is precisely the sort of test that gets deleted instead of read.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;
const loadMap = (name: string): MapDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/maps/${name}.json`), 'utf8'),
) as MapDef;

const ROSTER_IDS = ['aegis', 'bastion', 'cinder', 'kestrel', 'lumen', 'ravok', 'thorn', 'vex', 'wisp'];
const CHARACTERS = ROSTER_IDS.map(load);
const roster: Roster = buildRoster(CHARACTERS);
const ARENA = loadMap('duel-arena');
const byId = (id: string): CharacterDef => CHARACTERS.find((c) => c.id === id)!;

/** The default 2v2: a firepower + a frontline a side, which is the common comp. */
const BRAWL = {
  map: ARENA,
  roster,
  format: '2v2' as const,
  teams: [[byId('vex'), byId('bastion')], [byId('kestrel'), byId('ravok')]] as
    [CharacterDef[], CharacterDef[]],
};

/** The comp the TTK package was most worried about: a healer that outlasts you. */
const HEALER = {
  ...BRAWL,
  teams: [[byId('lumen'), byId('aegis')], [byId('vex'), byId('bastion')]] as
    [CharacterDef[], CharacterDef[]],
};

/**
 * Twenty-four is a compromise, and the reason is worth writing down: enough
 * matches that "every one of them ended" is a real claim, few enough that the
 * file stays inside a normal unit-test budget — this is the season CI pays for
 * on every push.
 *
 * `npm run botplay` sets `BOTPLAY_SEASON` and runs a much larger one for the
 * measurement. Same code, same seeds, same assertions; only the sample grows, so
 * a number that shows up in the big season can always be reproduced in the small
 * one by naming its seed.
 */
const SEASON = Number(process.env['BOTPLAY_SEASON'] ?? 24);

const brawl: SeasonReport = playSeason(SEASON, BRAWL);
const healer: SeasonReport = playSeason(SEASON, HEALER);

describe('BOTPLAY: a few hundred bot turns, as a structural net', () => {
  it('every match that did not finish is an unresolved SUDDEN DEATH', () => {
    // The invariant with the most reach, and it needed re-stating once the bots
    // played enough matches to find the tail: a tie at the turn limit does not
    // end the match (`resolveOutcome` sets `suddenDeath` and play continues), so
    // "did not finish" is a legal state the rules produce. What must never
    // happen is a match still active WITHOUT that flag — that would mean the
    // outcome check stopped firing, which is a hang in production.
    for (const r of [brawl, healer]) {
      expect(r.count).toBe(SEASON);
      for (const m of r.matches) {
        if (m.endedBy !== 'open') continue;
        expect(m.suddenDeath, `seed ${m.seed} never ended and was not in sudden death`).toBe(true);
      }
    }
  });

  it('and none of them runs past its limit except in sudden death', () => {
    // A tie at the turn limit does not end the match — `resolveOutcome` flips
    // sudden death on and play continues. So "past the limit" is legal, but only
    // with that flag set: a match that overran WITHOUT it would mean the outcome
    // check stopped firing, which is the bug this is actually looking for.
    const limit = getFormat('2v2').turnLimit;
    for (const r of [brawl, healer]) {
      for (const m of r.matches) {
        if (m.turns <= limit + 1) continue;
        expect(m.suddenDeath, `seed ${m.seed} ran to ${m.turns} without sudden death`).toBe(true);
      }
    }
  });

  it('a finished match has a coherent scoreline', () => {
    const { killsToWin } = getFormat('2v2');
    for (const m of [...brawl.matches, ...healer.matches]) {
      if (m.endedBy === 'kills') {
        expect(Math.max(...m.kills), `seed ${m.seed} ended on kills without reaching the target`)
          .toBeGreaterThanOrEqual(killsToWin);
        expect(m.winner, `seed ${m.seed} reached the target with nobody winning`).toBeDefined();
      }
      // Deaths and kills are NOT equal, and that is FF1: a friendly kill scores
      // for nobody, so a team cannot farm its own respawning ally. The two must
      // reconcile exactly once the unscored ones are added back.
      expect(m.kills[0] + m.kills[1] + m.friendlyDeaths, `seed ${m.seed}: kills and deaths disagree`)
        .toBe(m.deathTurns.length);
    }
  });

  it('the bots actually fight — otherwise every claim above is vacuous', () => {
    // The guard that makes this file mean something. A policy that proposed only
    // illegal orders would produce twenty-four identical quiet matches and pass
    // every invariant above.
    expect(brawl.totalDeaths, 'somebody died').toBeGreaterThan(0);
    expect(healer.totalDeaths).toBeGreaterThan(0);
    expect(brawl.worstBurst?.lost ?? 0, 'and damage landed').toBeGreaterThan(0);
  });

  it('and the same seed replays exactly', () => {
    // The engine's determinism guarantee, exercised over whole matches rather
    // than one resolve. If this ever fails, the bot found real nondeterminism —
    // and the seed in the message is the reproduction.
    for (const m of brawl.matches.slice(0, 4)) {
      const again = playMatch({ ...BRAWL, seed: m.seed });
      expect(again.fingerprint, `seed ${m.seed} did not replay`).toBe(m.fingerprint);
      expect(again.turns).toBe(m.turns);
    }
  });

  it('the bot is competent enough for its numbers to mean anything', () => {
    // Refused orders are the bot's own failure rate — proposals `planUnit`
    // dropped as illegal. A few are expected (a wall aimed where it will not
    // fit); a flood would mean the pacing numbers describe a policy standing
    // around, not a match.
    const proposals = brawl.matches.length * brawl.medianTurns * 2;
    expect(brawl.refusedOrders, 'most bot orders should be legal')
      .toBeLessThan(proposals);
  });
});

describe('BOTPLAY: what the season measured (observations, not assertions)', () => {
  it('prints the report', () => {
    // Deliberately assertion-free beyond "it produced a report". These numbers
    // are evidence for the Analyzer and the owner, and pinning them here would
    // turn every future balance change into a red build.
    const text = [formatReport('2v2 brawl', brawl), formatReport('2v2 healer comp', healer)]
      .join('\n');
    // eslint-disable-next-line no-console
    console.log(`\n${text}\n`);
    expect(text).toContain('ended on kills');
  });
});

describe('BOTPLAY-SWEEP: every pairing, looking for outliers', () => {
  /**
   * A tool the Analyzer runs for evidence, **not a CI gate** — and the tests
   * here are about the tool, never about the balance it reports. A bot that does
   * not focus-fire, bait or hold a cooldown is not ground truth (session-12
   * OQ #2), so a win rate it produces is a flag to investigate. Asserting a band
   * would be asserting that the bot is a good player.
   */
  const sweep = playSweep({
    map: ARENA, roster, characters: CHARACTERS, format: '2v2', matchesPerPairing: 1,
  });

  it('covers every ordered pairing, and every character appears', () => {
    // Ordered, not unordered: a character that only wins from team 0's spawn is
    // exactly the outlier worth catching, and an unordered sweep hides it.
    expect(sweep.pairings, '9 characters, every ordered pair').toBe(9 * 8);
    expect(sweep.rows).toHaveLength(CHARACTERS.length);
    for (const r of sweep.rows) expect(r.matches, `${r.characterId} played`).toBeGreaterThan(0);
  });

  it('the tally reconciles — wins never exceed matches, and both sides are counted', () => {
    for (const r of sweep.rows) {
      expect(r.wins, `${r.characterId} won more than it played`).toBeLessThanOrEqual(r.matches);
      expect(r.winPct).toBe(Math.round((r.wins * 100) / r.matches));
    }
    // Every match books one appearance for each side, so the totals must agree
    // with the pairing count exactly. A sweep that quietly dropped a match would
    // still look plausible row by row.
    const appearances = sweep.rows.reduce((n, r) => n + r.matches, 0);
    expect(appearances).toBe(sweep.pairings * sweep.matchesPerPairing * 2);
  });

  it('and it replays exactly, so any row can be reproduced', () => {
    const again = playSweep({
      map: ARENA, roster, characters: CHARACTERS, format: '2v2', matchesPerPairing: 1,
    });
    expect(again.rows).toEqual(sweep.rows);
  });

  it('prints the sweep', () => {
    const text = formatSweep(sweep);
    // eslint-disable-next-line no-console
    console.log(`\n${text}\n`);
    expect(text).toContain('pairing sweep');
    expect(text, 'and says what it is not').toContain('never a balance number');
  });
});
