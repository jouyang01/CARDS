/**
 * Combat primitives: damage (shield-first), heal, energy, and cover reduction.
 *
 * Pure and deterministic (CLAUDE.md golden rule #1): integer math only, every
 * percentage applied as `floor(x * pct / 100)`, no randomness, no clock, no I/O.
 * These functions mutate a unit that already belongs to a cloned turn draft; the
 * turn pipeline (BACKLOG item 4) orchestrates them and emits the event log.
 *
 * Rules (GAME_SPEC §3 cover, §5 energy, §6 statuses; docs/design/edge-cases.md):
 * - **damage order**: shields absorb first, then real HP (GAME_SPEC §6);
 * - **Might/Weaken** scale *outgoing* damage ±25%, summed before one round-down
 *   so holding both nets to base (mirrors the movement Haste/Slow rule);
 * - **cover** reduces incoming damage 50% (round down) when the defender is
 *   orthogonally adjacent to a cover square and the attack line crosses that
 *   side; melee attacks (range ≤ 1) ignore cover (GAME_SPEC §3);
 * - **Energized** adds +50% to energy gained (round down), passive included.
 */

import { type Board, terrainAt } from './board.js';
import {
  COVER_REDUCTION_PCT,
  ENERGIZED_PCT,
  MIGHT_PCT,
  WEAKEN_PCT,
} from './constants.js';
import { hasStatus } from './status.js';
import type { UnitState, Vec2 } from './types.js';

// ── Damage scaling ──────────────────────────────────────────────────────────

/** Outgoing-damage percentage from the attacker's Might/Weaken (base 100). */
export function outgoingDamagePct(attacker: UnitState): number {
  return 100 + (hasStatus(attacker, 'might') ? MIGHT_PCT : 0) - (hasStatus(attacker, 'weaken') ? WEAKEN_PCT : 0);
}

/** `floor(raw * pct / 100)`, never negative. The single round-down for damage. */
export function scaleDamage(raw: number, pct: number): number {
  if (raw <= 0 || pct <= 0) return 0;
  return Math.floor((raw * pct) / 100);
}

/**
 * Final damage a hit deals before shields: the raw amount scaled by the
 * attacker's Might/Weaken, then halved (round down) if the defender is behind
 * cover from this attack. Each reduction is its own round-down, applied
 * attacker-side then defender-side.
 */
export function computeDamage(raw: number, attacker: UnitState, behindCover: boolean): number {
  const scaled = scaleDamage(raw, outgoingDamagePct(attacker));
  if (!behindCover) return scaled;
  return scaleDamage(scaled, 100 - COVER_REDUCTION_PCT);
}

// ── Applying damage / heals ─────────────────────────────────────────────────

export interface DamageResult {
  /** HP actually lost (post-shield). */
  hpLost: number;
  /** Damage soaked by shields. */
  absorbed: number;
  /** True when this hit dropped the unit to 0 HP. */
  died: boolean;
}

/**
 * Apply already-computed damage to a unit: shields first (in list order, so the
 * model generalises to multiple shields), then HP. Depleted shields are dropped.
 * Clamps HP at 0 and reports death; it does not set `alive` or attribute the
 * kill — the pipeline does that so death handling stays in one place.
 */
export function applyDamage(unit: UnitState, amount: number): DamageResult {
  let remaining = Math.max(0, amount);
  let absorbed = 0;
  for (const s of unit.statuses) {
    if (remaining <= 0) break;
    if (s.kind !== 'shield' || s.remaining <= 0) continue;
    const pool = s.amount ?? 0;
    if (pool <= 0) continue;
    const take = Math.min(pool, remaining);
    s.amount = pool - take;
    absorbed += take;
    remaining -= take;
  }
  unit.statuses = unit.statuses.filter((s) => !(s.kind === 'shield' && (s.amount ?? 0) <= 0));

  const hpBefore = unit.hp;
  unit.hp = hpBefore - remaining;
  let died = false;
  if (unit.hp <= 0) {
    unit.hp = 0;
    died = true;
  }
  return { hpLost: hpBefore - unit.hp, absorbed, died };
}

/** Heal up to `maxHp`; returns HP actually restored. Dead units are not healed. */
export function applyHeal(unit: UnitState, amount: number): number {
  if (!unit.alive || amount <= 0) return 0;
  const healed = Math.min(amount, unit.maxHp - unit.hp);
  unit.hp += Math.max(0, healed);
  return Math.max(0, healed);
}

// ── Energy ──────────────────────────────────────────────────────────────────

/** Energy percentage the unit gains at, incl. Energized (base 100). */
export function energyGainPct(unit: UnitState): number {
  return 100 + (hasStatus(unit, 'energized') ? ENERGIZED_PCT : 0);
}

/**
 * Grant `base` energy and return the amount added. Energy is uncapped in v1
 * (banking above the ult cost is fine).
 *
 * `scale` controls Energized: on by default for *earned* energy (ability use /
 * on-hit), but the flat end-of-turn passive drip passes `scale: false` — GAME_SPEC
 * §5 / edge-cases: "Energized scales earned energy, not the passive drip."
 */
export function grantEnergy(unit: UnitState, base: number, scale = true): number {
  if (base <= 0) return 0;
  const gained = scale ? Math.floor((base * energyGainPct(unit)) / 100) : base;
  unit.energy += gained;
  return gained;
}

// ── Cover ───────────────────────────────────────────────────────────────────

/**
 * Integer test: does the segment [p1,p2] share any point with segment [p3,p4]?
 * Standard orientation method; collinear-overlap and endpoint touches count as
 * intersecting, which makes a shot through a square's corner graze both flanking
 * edges (a corner-tucked defender gets cover from either side). All inputs are
 * integers, so the result is identical on every machine.
 */
function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const onSeg = (o: Vec2, a: Vec2, b: Vec2) =>
    Math.min(a.x, b.x) <= o.x && o.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= o.y && o.y <= Math.max(a.y, b.y);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSeg(p1, p3, p4)) return true;
  if (d2 === 0 && onSeg(p2, p3, p4)) return true;
  if (d3 === 0 && onSeg(p3, p1, p2)) return true;
  if (d4 === 0 && onSeg(p4, p1, p2)) return true;
  return false;
}

/** The two corners of `defender`'s square on the `dir` side, in doubled coords. */
function edgeCorners(defender: Vec2, dir: Vec2): [Vec2, Vec2] {
  const x0 = 2 * defender.x;
  const y0 = 2 * defender.y;
  const x1 = x0 + 2;
  const y1 = y0 + 2;
  if (dir.x === 1) return [{ x: x1, y: y0 }, { x: x1, y: y1 }]; // east edge
  if (dir.x === -1) return [{ x: x0, y: y0 }, { x: x0, y: y1 }]; // west edge
  if (dir.y === 1) return [{ x: x0, y: y1 }, { x: x1, y: y1 }]; // south edge
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }]; // north edge
}

const CARDINALS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Is `defenderPos` behind cover from an attack fired at it from `attackerPos`?
 *
 * True when some orthogonally-adjacent cover square sits on a side of the
 * defender that the attack line (attacker centre → defender centre) crosses.
 * Melee attacks (`range` ≤ 1) ignore cover (GAME_SPEC §3). Centres live at odd
 * doubled coordinates so the segment/edge intersection is exact integer math.
 */
export function isBehindCover(
  board: Board,
  attackerPos: Vec2,
  defenderPos: Vec2,
  range: number,
): boolean {
  if (range <= 1) return false;
  const a: Vec2 = { x: 2 * attackerPos.x + 1, y: 2 * attackerPos.y + 1 };
  const d: Vec2 = { x: 2 * defenderPos.x + 1, y: 2 * defenderPos.y + 1 };
  for (const dir of CARDINALS) {
    const c: Vec2 = { x: defenderPos.x + dir.x, y: defenderPos.y + dir.y };
    if (terrainAt(board, c) !== 'cover') continue;
    const [e1, e2] = edgeCorners(defenderPos, dir);
    if (segmentsIntersect(a, d, e1, e2)) return true;
  }
  return false;
}
