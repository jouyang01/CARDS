/**
 * MAPTOGGLE — pick the map, format and seating from the URL.
 *
 * `iron-basin` and 4v4 have been in `data/` and validated by tests since M1,
 * but the entry point hard-coded `duel-arena` + 2v2, so nobody could actually
 * play them. This is the smallest thing that fixes that: `?map=iron-basin&
 * format=4v4` and you are in a 4v4. It is scaffolding for playtest, **not** the
 * M3 lobby — no character picking, no duplicate-pick validation, no persistence.
 *
 * Pure, so it is testable without a browser: it takes a query string and the
 * catalogues, and returns either a setup or the reasons it could not build one.
 * A typo is an **error, not a fallback** — silently loading `duel-arena`
 * because you mistyped the map you wanted to test is the one outcome a dev
 * toggle must not have.
 */

import {
  DEFAULT_FORMAT,
  FORMATS,
  getFormat,
  validateMap,
  validateMapForFormat,
  type CharacterDef,
  type FormatId,
  type MapDef,
} from '@cards/engine';
import { SCENARIOS, isScenarioId, type ScenarioId } from './scenarios.js';

export interface MatchSetup {
  map: MapDef;
  format: FormatId;
  teams: [CharacterDef[], CharacterDef[]];
  /** Humans per team — how the format's characters are grouped into seats. */
  playersPerTeam: [number, number];
  /**
   * A dev-only starting arrangement (CAMO-SEED), or absent for a normal match.
   * Never defaulted: a seed that applied unless you opted out would be a
   * different game than the one the player thinks they loaded.
   */
  scenario?: ScenarioId;
}

export type SetupResult = { setup: MatchSetup } | { errors: string[] };

/**
 * Hot-seat seating per format, when the URL does not say.
 *
 * 2v2 keeps the asymmetric 3-player split the demo has always shipped (team 0
 * split across two players, team 1 one player running both) because it is the
 * arrangement most worth exercising — the seat handover only has a bug to have
 * when the two teams are seated differently. Everything else takes the fewest
 * seats the format allows, so a solo playtester does the fewest handovers.
 */
const DEFAULT_PLAYERS: Readonly<Record<FormatId, [number, number]>> = {
  '1v1': [1, 1],
  '2v2': [2, 1],
  '4v4': [2, 2],
};

const isFormatId = (s: string): s is FormatId => Object.hasOwn(FORMATS, s);

/**
 * Deal the catalogue alternately: team 0 takes the even indices, team 1 the
 * odd. Alternating rather than splitting in half keeps the two teams' archetype
 * mixes similar however long the catalogue grows, and it reproduces the shipped
 * 2v2 demo (Vex + Wisp vs Bastion + Aegis) exactly from the same list.
 */
export function dealTeams(
  catalog: readonly CharacterDef[],
  perTeam: number,
): [CharacterDef[], CharacterDef[]] {
  const teams: [CharacterDef[], CharacterDef[]] = [[], []];
  for (let i = 0; i < perTeam * 2; i++) teams[i % 2 === 0 ? 0 : 1].push(catalog[i]!);
  return teams;
}

/** Parse `players=2,1`. Anything else is an error rather than a guess. */
function parsePlayers(raw: string | null, format: FormatId): [number, number] | string {
  if (raw === null) return DEFAULT_PLAYERS[format];
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n) || n < 1)) {
    return `players must be two positive integers, e.g. players=2,1 (got "${raw}")`;
  }
  return [parts[0]!, parts[1]!];
}

/**
 * Build the match the URL asks for, or explain why not.
 *
 * `search` is a `location.search` string (with or without the leading `?`).
 * Recognised: `map`, `format`, `players`. The map is validated both on its own
 * terms and against the chosen format, so "4v4 on a map with two spawn squares"
 * is caught here with a readable message rather than thrown from `createMatch`.
 */
export function parseSetup(
  search: string,
  maps: readonly MapDef[],
  catalog: readonly CharacterDef[],
): SetupResult {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const errors: string[] = [];

  const mapId = params.get('map');
  const map = mapId === null ? maps[0] : maps.find((m) => m.id === mapId);
  if (map === undefined) {
    errors.push(`unknown map "${mapId}" — try one of: ${maps.map((m) => m.id).join(', ')}`);
  }

  const formatId = params.get('format');
  if (formatId !== null && !isFormatId(formatId)) {
    errors.push(`unknown format "${formatId}" — try one of: ${Object.keys(FORMATS).join(', ')}`);
  }
  const format: FormatId = formatId !== null && isFormatId(formatId) ? formatId : DEFAULT_FORMAT;

  const players = parsePlayers(params.get('players'), format);
  if (typeof players === 'string') errors.push(players);

  // CAMO-SEED. Named seeds only — an unknown one is an error rather than a
  // silent normal match, because "my scenario did nothing" is indistinguishable
  // from "my scenario is not doing what I think" if it is ignored.
  const scenarioId = params.get('scenario');
  if (scenarioId !== null && !isScenarioId(scenarioId)) {
    errors.push(`unknown scenario "${scenarioId}" — try one of: ${SCENARIOS.join(', ')}`);
  }
  const scenario = scenarioId !== null && isScenarioId(scenarioId) ? scenarioId : undefined;

  const perTeam = getFormat(format).charactersPerTeam;
  if (catalog.length < perTeam * 2) {
    errors.push(`${format} needs ${perTeam * 2} characters, the roster has ${catalog.length}`);
  }

  if (map !== undefined) {
    errors.push(...validateMap(map), ...validateMapForFormat(map, format));
  }

  if (errors.length > 0 || map === undefined || typeof players === 'string') return { errors };
  const setup: MatchSetup = { map, format, teams: dealTeams(catalog, perTeam), playersPerTeam: players };
  return { setup: scenario === undefined ? setup : { ...setup, scenario } };
}

/** One line naming what is loaded — a dev toggle you cannot see is a trap. */
export function describeSetup(setup: MatchSetup): string {
  const base = `${setup.map.name} · ${setup.format} · ${setup.playersPerTeam.join(' v ')} players`;
  // A seeded match must announce itself loudest of all: it is the one setup
  // where the board is not where the rules would have put it.
  return setup.scenario === undefined ? base : `${base} · scenario: ${setup.scenario}`;
}
