/**
 * BOTPLAY — a scripted opponent, so a whole match can be played without a human.
 *
 * Not a Vitest file (no `.test.` in the name) — fixtures and a runner.
 *
 * *"Can you run a botted playtest?"* Yes, and this is it. A human playtest
 * answers questions a bot cannot — does the wall *read*, does a 20-turn match
 * *drag*, is being caught in the open *frightening* — and those are the ones the
 * PLAYTEST milestone exists for. What a bot can do is the other half: play a few
 * hundred complete matches overnight and answer the questions that are counting
 * problems. **Does a match end on kills or on the clock? How many turns does it
 * take? Can two ultimates still delete somebody from full?** Those are exactly
 * the numbers the TTK package was tuned to move, and until now the only evidence
 * for them was arithmetic in a review document.
 *
 * **It is not a good player and does not try to be.** It walks at the nearest
 * enemy and fires the biggest thing that reaches — no baiting, no cover, no
 * focus fire, no saving a dash to dodge. A pair of greedy bots is a *lower*
 * bound on how long a fight lasts between people who are trying, so a match
 * length measured here is the floor, not the estimate. Read the numbers that
 * way; the report says so too.
 *
 * **Determinism is the whole point.** `packages/engine` may never call
 * `Math.random()`; neither does this. The only randomness is a seeded counter
 * (`mulberry32`) living in test code, so a seed replays exactly — a bot that
 * found a crash hands you a one-line reproduction rather than a story.
 */

import {
  ULT_COST,
  aimInRange,
  blocksMovement,
  buildBoard,
  buildVision,
  canSee,
  createMatch,
  direction8,
  distance,
  getFormat,
  movementBudget,
  occupiedByOthers,
  reachableSquares,
  reconstructPath,
  resolveTurn,
  WALL_ROTATIONS,
  type AbilityDef,
  type Board,
  type CharacterDef,
  type FormatId,
  type GameState,
  type MapDef,
  type Roster,
  type TeamId,
  type TurnEvent,
  type UnitOrders,
  type UnitState,
  vecKey,
  type Vec2,
} from '../src/index.js';

// ── Seeded randomness, in test code only ────────────────────────────────────

/** mulberry32 — small, fast, and reproducible from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The policy ──────────────────────────────────────────────────────────────

/**
 * How an ability is aimed at a square, per shape.
 *
 * Deliberately thin: the engine validates every order and silently drops an
 * illegal one, so the bot's job is to propose something plausible rather than to
 * re-implement `aimIsLegal`. A proposal the engine refuses costs the bot its
 * action for that turn, which is a bot problem and not an engine one — and the
 * report counts those, so a policy that mostly proposes nonsense is visible
 * rather than silently producing a quiet match.
 */
function aimFor(
  board: Board, unit: UnitState, def: AbilityDef, target: Vec2,
): { aim: Vec2[]; aimStep?: number } | undefined {
  switch (def.shape) {
    case 'self':
      return { aim: [] };
    case 'square':
    case 'circle':
    case 'line':
    case 'cone':
      return { aim: [{ ...target }] };
    case 'wall':
      // WALL-ROTATE: a wall needs both halves of an aim. The bot lays it across
      // the lane the enemy is coming down — the cardinal perpendicular to the
      // line of approach, which is the placement a person makes.
      return { aim: [{ ...target }], aimStep: perpendicularTo(unit.pos, target) };
    case 'path':
      return { aim: chargePath(board, unit.pos, target, def.range) };
  }
}

/** The wall rotation most nearly across the caster→target line. */
function perpendicularTo(from: Vec2, to: Vec2): number {
  const dir = direction8(from, to);
  // A wall running east/west blocks a north/south approach and vice versa.
  return Math.abs(dir.x) >= Math.abs(dir.y) ? WALL_ROTATIONS[1]! : WALL_ROTATIONS[0]!;
}

/** A straight-ish charge toward `to`, one step at a time, inside the budget. */
function chargePath(board: Board, from: Vec2, to: Vec2, range: number): Vec2[] {
  const path: Vec2[] = [];
  let at = from;
  let cost = 0;
  for (let i = 0; i < range; i++) {
    const step = direction8(at, to);
    if (step.x === 0 && step.y === 0) break;
    const next = { x: at.x + step.x, y: at.y + step.y };
    if (blocksMovement(board, next)) break;
    cost += step.x !== 0 && step.y !== 0 ? 2 : 1;
    if (cost > range) break;
    path.push(next);
    at = next;
  }
  return path;
}

/** Everything this unit could fire this turn, best first. */
function options(unit: UnitState, character: CharacterDef): AbilityDef[] {
  const ready = character.abilities.filter((a) => (unit.cooldowns[a.id] ?? 0) <= 0);
  const all = unit.energy >= ULT_COST ? [character.ultimate, ...ready] : ready;
  // Biggest headline damage first; a heal or a buff sorts to the back and is
  // only reached when nothing else is available, which is roughly how a greedy
  // player behaves and keeps the report about damage pacing.
  return all.sort((x, y) => headline(y) - headline(x));
}

const headline = (def: AbilityDef): number =>
  def.effects.find((e) => e.kind === 'damage')?.amount ?? 0;

/** One unit's orders: shoot if anything reaches, otherwise close the distance. */
function orderFor(
  state: GameState, board: Board, roster: Roster, unit: UnitState, rng: () => number,
): UnitOrders | undefined {
  if (!unit.alive) return undefined;
  const character = roster[unit.characterId];
  if (character === undefined) return undefined;

  const vision = buildVision(board);
  const enemies = state.units.filter((u) => u.alive && u.owner !== unit.owner);
  const seen = enemies.filter((e) => canSee(vision, unit, e));
  // A bot that only ever acts on what it can see would stand still in fog all
  // match; it walks toward the last enemy it knows about instead, which is what
  // a player with a minimap does.
  const known = seen.length > 0 ? seen : enemies;
  if (known.length === 0) return undefined;
  const target = [...known].sort((a, b) =>
    distance(unit.pos, a.pos) - distance(unit.pos, b.pos)
    || a.unitId.localeCompare(b.unitId))[0]!;

  for (const def of options(unit, character)) {
    if (def.shape !== 'self' && !aimInRange(unit.pos, target.pos, def.range)) continue;
    const aimed = aimFor(board, unit, def, target.pos);
    if (aimed === undefined || (def.shape === 'path' && aimed.aim.length === 0)) continue;
    return {
      unitId: unit.unitId,
      ability: {
        abilityId: def.id,
        target: aimed.aim,
        ...(aimed.aimStep === undefined ? {} : { aimStep: aimed.aimStep }),
      },
    };
  }

  // Nothing reaches: walk. `reachableSquares` is the engine's own budget-aware
  // flood fill — the same one the client's move preview uses — so the bot can
  // never propose a path the mover would refuse.
  const sprint = rng() < 0.5;
  const reach = reachableSquares(board, state, unit, movementBudget(unit, sprint));
  const best = reach
    .filter((s) => s.cost > 0)
    .sort((a, b) => distance(a.pos, target.pos) - distance(b.pos, target.pos)
      || a.cost - b.cost
      || vecKey(a.pos).localeCompare(vecKey(b.pos)))[0];
  if (best === undefined) return undefined;
  const path = reconstructPath(reach, unit.pos, best.pos);
  if (path === null || path.length === 0) return undefined;
  return { unitId: unit.unitId, movePath: path, ...(sprint ? { sprint: true } : {}) };
}

// ── The runner ──────────────────────────────────────────────────────────────

export interface MatchResult {
  seed: number;
  turns: number;
  /**
   * How it ended. `'kills'` — somebody reached the kill target. `'clock'` — the
   * leader took it at the turn limit. `'draw'` — both teams reached the target in
   * the same turn. `'open'` — still active when the runner stopped, which is what
   * an unresolved **sudden death** looks like: a tie at the limit does not end
   * the match, so the tail is genuinely unbounded and the runner is the only
   * thing that stops it.
   */
  endedBy: 'kills' | 'clock' | 'draw' | 'open';
  winner: TeamId | undefined;
  kills: [number, number];
  /**
   * A tie at the turn limit does **not** end the match (`resolveOutcome`): it
   * flips sudden death on and play continues until somebody scores. So a match
   * running past its limit is the ruleset, not an overrun — worth recording,
   * because it is also the thing that makes "does it end on the clock?" a more
   * interesting question than it looks.
   */
  suddenDeath: boolean;
  /** Deaths, in the turn they happened — the pacing curve. */
  deathTurns: number[];
  /**
   * Deaths that scored for nobody, because the killer was on the victim's own
   * team (FF1). The gap between this and `kills` is the bot shooting its own
   * teammates, which a greedy policy does and a person mostly does not.
   */
  friendlyDeaths: number;
  /** The largest HP one unit lost in a single turn, and who to. */
  worstTurn: { unitId: string; lost: number; turn: number } | undefined;
  /** Turns where a unit ordered an ability the engine refused. */
  refusedOrders: number;
  /** A stable fingerprint of the final state, for the determinism check. */
  fingerprint: string;
}

export interface BotMatchOptions {
  seed: number;
  map: MapDef;
  roster: Roster;
  teams: [CharacterDef[], CharacterDef[]];
  format: FormatId;
  /**
   * Where the runner gives up, in turns. Defaults to 3x the format's limit.
   *
   * Needed because **sudden death has no cap in the rules**: tied at the limit,
   * play continues until somebody scores, and two teams that cannot finish each
   * other never do. That is the ruleset, not a hang — but a runner still has to
   * stop somewhere, and where it stopped has to be visible in the result rather
   * than dressed up as an outcome.
   */
  maxTurns?: number;
}

/** Play one match to its end (or to the format's turn limit) and describe it. */
export function playMatch(opts: BotMatchOptions): MatchResult {
  const rng = mulberry32(opts.seed);
  const board = buildBoard(opts.map);
  const { turnLimit } = getFormat(opts.format);
  const maxTurns = opts.maxTurns ?? turnLimit * 3;
  let state: GameState = createMatch(opts.map, opts.format, opts.teams);

  const deathTurns: number[] = [];
  let friendlyDeaths = 0;
  let worstTurn: MatchResult['worstTurn'];
  let refusedOrders = 0;

  for (let guard = 0; state.status === 'active' && guard < maxTurns; guard++) {
    const turn = state.turn;
    const orders = ([0, 1] as TeamId[]).map((team) => ({
      team,
      units: state.units
        .filter((u) => u.owner === team)
        .flatMap((u) => {
          const order = orderFor(state, board, opts.roster, u, rng);
          return order === undefined ? [] : [order];
        }),
    })) as [{ team: TeamId; units: UnitOrders[] }, { team: TeamId; units: UnitOrders[] }];

    const asked = orders.flatMap((o) => o.units).filter((o) => o.ability !== undefined).length;
    const out = resolveTurn(state, opts.map, orders, opts.roster);
    const fired = new Set(out.events.flatMap((e) => (e.type === 'abilityFired' ? [e.unitId] : [])));
    refusedOrders += Math.max(0, asked - fired.size);

    for (const e of out.events) {
      if (e.type !== 'death') continue;
      deathTurns.push(turn);
      const victim = out.state.units.find((u) => u.unitId === e.unitId);
      if (victim !== undefined && e.killer === victim.owner) friendlyDeaths += 1;
    }
    const worst = biggestHit(out.events);
    if (worst !== undefined && (worstTurn === undefined || worst.lost > worstTurn.lost)) {
      worstTurn = { ...worst, turn };
    }
    state = out.state;
  }

  const { killsToWin } = getFormat(opts.format);
  const endedBy: MatchResult['endedBy'] = state.status === 'draw'
    ? 'draw'
    : state.status !== 'finished'
      ? 'open'
      : state.kills[0] >= killsToWin || state.kills[1] >= killsToWin ? 'kills' : 'clock';

  return {
    seed: opts.seed,
    turns: state.turn,
    endedBy,
    winner: state.winner,
    kills: [state.kills[0], state.kills[1]],
    suddenDeath: state.suddenDeath === true,
    deathTurns,
    friendlyDeaths,
    worstTurn,
    refusedOrders,
    fingerprint: fingerprintOf(state),
  };
}

/** The most HP a single unit lost across one turn's events. */
function biggestHit(events: readonly TurnEvent[]): { unitId: string; lost: number } | undefined {
  const perUnit = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'damage') continue;
    perUnit.set(e.unitId, (perUnit.get(e.unitId) ?? 0) + e.amount);
  }
  let worst: { unitId: string; lost: number } | undefined;
  // Sorted so the winner of a tie is the same on every machine.
  for (const unitId of [...perUnit.keys()].sort()) {
    const lost = perUnit.get(unitId)!;
    if (worst === undefined || lost > worst.lost) worst = { unitId, lost };
  }
  return worst;
}

/**
 * A stable string for a finished match.
 *
 * Only what a replay must reproduce: no object iteration order, no floats, unit
 * ids sorted — the same rules the engine's own determinism harness follows.
 */
export function fingerprintOf(state: GameState): string {
  const units = [...state.units]
    .sort((a, b) => a.unitId.localeCompare(b.unitId))
    .map((u) => `${u.unitId}:${u.hp}:${u.pos.x},${u.pos.y}:${u.alive ? 1 : 0}:${u.energy}`);
  return [state.turn, state.status, state.winner ?? '-', state.kills.join('/'), ...units].join('|');
}

// ── The report ──────────────────────────────────────────────────────────────

export interface SeasonReport {
  matches: MatchResult[];
  count: number;
  endedByKills: number;
  endedByClock: number;
  draws: number;
  suddenDeaths: number;
  /** Still active when the runner stopped — an unresolved sudden death. */
  open: number;
  medianTurns: number;
  meanTurns: number;
  shortest: number;
  longest: number;
  totalDeaths: number;
  friendlyDeaths: number;
  /** The biggest single-turn HP loss seen anywhere, the burst-lethality number. */
  worstBurst: { unitId: string; lost: number; turn: number; seed: number } | undefined;
  refusedOrders: number;
}

/** Play `count` matches from consecutive seeds and aggregate them. */
export function playSeason(
  count: number, base: Omit<BotMatchOptions, 'seed'>, firstSeed = 1,
): SeasonReport {
  const matches = Array.from({ length: count }, (_, i) =>
    playMatch({ ...base, seed: firstSeed + i }));
  const turns = matches.map((m) => m.turns).sort((a, b) => a - b);
  let worstBurst: SeasonReport['worstBurst'];
  for (const m of matches) {
    if (m.worstTurn === undefined) continue;
    if (worstBurst === undefined || m.worstTurn.lost > worstBurst.lost) {
      worstBurst = { ...m.worstTurn, seed: m.seed };
    }
  }
  return {
    matches,
    count,
    endedByKills: matches.filter((m) => m.endedBy === 'kills').length,
    endedByClock: matches.filter((m) => m.endedBy === 'clock').length,
    draws: matches.filter((m) => m.endedBy === 'draw').length,
    suddenDeaths: matches.filter((m) => m.suddenDeath).length,
    open: matches.filter((m) => m.endedBy === 'open').length,
    medianTurns: turns[Math.floor(turns.length / 2)] ?? 0,
    meanTurns: Math.round((turns.reduce((a, b) => a + b, 0) / (turns.length || 1)) * 10) / 10,
    shortest: turns[0] ?? 0,
    longest: turns[turns.length - 1] ?? 0,
    totalDeaths: matches.reduce((n, m) => n + m.deathTurns.length, 0),
    friendlyDeaths: matches.reduce((n, m) => n + m.friendlyDeaths, 0),
    worstBurst,
    refusedOrders: matches.reduce((n, m) => n + m.refusedOrders, 0),
  };
}

// ── BOTPLAY-SWEEP — every pairing, looking for outliers ─────────────────────

/** One character's record across every pairing it appeared in. */
export interface SweepRow {
  characterId: string;
  matches: number;
  wins: number;
  /** Percentage points, integer — no float ever reaches a comparison. */
  winPct: number;
  /** Total damage this character's team took per match, as a crude TTK proxy. */
  deathsFor: number;
  deathsAgainst: number;
}

export interface SweepReport {
  rows: SweepRow[];
  pairings: number;
  matchesPerPairing: number;
  /** Rows whose win rate sits outside the band — the whole point of the sweep. */
  outliers: SweepRow[];
}

/**
 * Play every unordered pair of characters against every other, and rank them.
 *
 * **This is a tool the Analyzer runs for evidence, not a CI gate**, and the
 * distinction is load-bearing: a bot that does not focus-fire, bait, or hold a
 * cooldown is not ground truth (session-12 OQ #2), so a win rate here is a
 * flag to investigate rather than a number to balance against. The human
 * playtest is the primary validation and this does not replace it.
 *
 * Deterministic like everything else in this file — the seed for each pairing is
 * derived from its index, so the whole sweep replays exactly and any row can be
 * reproduced by naming the seed the runner prints.
 */
export function playSweep(opts: {
  map: MapDef;
  roster: Roster;
  characters: readonly CharacterDef[];
  format: FormatId;
  /** Matches per ordered pairing. Small by default — the sweep is wide, not deep. */
  matchesPerPairing?: number;
  /** Win rate outside ±this many points of 50 is called an outlier. */
  band?: number;
}): SweepReport {
  const perPairing = opts.matchesPerPairing ?? 2;
  const band = opts.band ?? 20;
  const tally = new Map<string, SweepRow>();
  const row = (id: string): SweepRow => {
    const found = tally.get(id);
    if (found !== undefined) return found;
    const fresh: SweepRow = {
      characterId: id, matches: 0, wins: 0, winPct: 0, deathsFor: 0, deathsAgainst: 0,
    };
    tally.set(id, fresh);
    return fresh;
  };

  let pairings = 0;
  let seed = 1;
  // Every ORDERED pair, so spawn side is not silently baked into a result: a
  // character that only wins from team 0 is exactly the outlier worth catching.
  for (const a of opts.characters) {
    for (const b of opts.characters) {
      if (a.id === b.id) continue;
      pairings += 1;
      for (let i = 0; i < perPairing; i++) {
        const result = playMatch({
          seed: seed++, map: opts.map, roster: opts.roster, format: opts.format,
          teams: [[a, a], [b, b]] as [CharacterDef[], CharacterDef[]],
        });
        const left = row(a.id);
        const right = row(b.id);
        left.matches += 1;
        right.matches += 1;
        if (result.winner === 0) left.wins += 1;
        if (result.winner === 1) right.wins += 1;
        left.deathsFor += result.kills[1];
        left.deathsAgainst += result.kills[0];
        right.deathsFor += result.kills[0];
        right.deathsAgainst += result.kills[1];
      }
    }
  }

  const rows = [...tally.values()]
    .map((r) => ({ ...r, winPct: r.matches === 0 ? 0 : Math.round((r.wins * 100) / r.matches) }))
    // Sorted by id after the rate so two characters on the same number always
    // come out in the same order — a report that reshuffles is a report nobody
    // can diff against last week's.
    .sort((x, y) => y.winPct - x.winPct || x.characterId.localeCompare(y.characterId));

  return {
    rows,
    pairings,
    matchesPerPairing: perPairing,
    outliers: rows.filter((r) => Math.abs(r.winPct - 50) > band),
  };
}

/** The sweep as a human reads it. */
export function formatSweep(r: SweepReport): string {
  const pad = (s: string, n: number): string => s.padEnd(n);
  return [
    `── pairing sweep — ${r.pairings} pairings x ${r.matchesPerPairing} matches ────────────`,
    ...r.rows.map((x) => `  ${pad(x.characterId, 9)} ${String(x.winPct).padStart(3)}%  `
      + `${x.wins}/${x.matches}   kills ${x.deathsAgainst} · deaths ${x.deathsFor}`),
    r.outliers.length === 0
      ? '  no outlier outside the band'
      : `  OUTLIERS: ${r.outliers.map((x) => `${x.characterId} ${x.winPct}%`).join(', ')}`,
    '  NB: greedy bots, no focus fire — a flag to investigate, never a balance number.',
  ].join('\n');
}

/** The report as a human reads it — printed by `npm run botplay`. */
export function formatReport(title: string, r: SeasonReport): string {
  const pct = (n: number): string => `${Math.round((n / (r.count || 1)) * 100)}%`;
  return [
    `── ${title} — ${r.count} bot matches ─────────────────────────`,
    `  ended on kills   ${r.endedByKills} (${pct(r.endedByKills)})`,
    `  ended on clock   ${r.endedByClock} (${pct(r.endedByClock)})`,
    ...(r.draws > 0 ? [`  draws            ${r.draws}`] : []),
    `  sudden death     ${r.suddenDeaths} (tied at the limit, play continued)`,
    ...(r.open > 0
      ? [`  still open       ${r.open} (${pct(r.open)}) — sudden death unresolved at the cap`]
      : []),
    `  turns            median ${r.medianTurns}, mean ${r.meanTurns}, range ${r.shortest}–${r.longest}`,
    `  deaths           ${r.totalDeaths} (${(r.totalDeaths / (r.count || 1)).toFixed(1)} per match)`,
    `  friendly kills   ${r.friendlyDeaths} (scored for nobody, FF1)`,
    `  worst burst      ${r.worstBurst === undefined ? 'none'
      : `${r.worstBurst.lost} HP on ${r.worstBurst.unitId} in one turn (seed ${r.worstBurst.seed}, turn ${r.worstBurst.turn})`}`,
    `  refused orders   ${r.refusedOrders} (bot proposals the engine dropped)`,
  ].join('\n');
}
