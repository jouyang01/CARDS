import {
  type AbilityDef,
  type CharacterDef,
  type MapDef,
  type PowerupPad,
  type Vec2,
  EFFECT_KINDS,
  POWERUP_TYPES,
  TARGET_SHAPES,
} from './types.js';
import { MAX_ABILITY_RANGE, TRAP_MAX_LIFETIME } from './constants.js';

/**
 * Content validation for data-driven characters and maps.
 * Returns a list of human-readable errors; empty list = valid.
 * The Designer's JSON drafts must pass these checks before the Builder wires
 * them into gameplay; CI runs them over everything in /data.
 */

const ABILITY_PHASES = ['prep', 'dash', 'blast'] as const;

/**
 * Every key an `AbilityDef` may carry (VALIDATE-KEYS).
 *
 * Content is JSON, so a mistyped field is not a compile error — it is a silent
 * nothing. `impcat` or `destinaton` parses fine, validates fine, and the ability
 * simply does not do the thing it was written to do. That is exactly how three
 * `impact` blocks sat inert in `data/` for a session with the suite green.
 *
 * Listing the keys is the cheapest thing that turns that into a loud failure.
 * The cost is that adding a field to `AbilityDef` means adding it here too — so
 * a test asserts the two lists agree, rather than trusting anyone to remember.
 */
export const ABILITY_KEYS = [
  'id', 'name', 'phase', 'shape', 'range', 'radius', 'cooldown', 'energyGain',
  'delayTurns', 'chargeHits', 'free', 'melee', 'axisBonus', 'beamWidth', 'innerRadius', 'innerAmount',
  'oncePerMatch', 'impact',
  'effects', 'description',
] as const;

/** Every key an `AbilityEffect` may carry — the same argument, one level down. */
export const EFFECT_KEYS = ['kind', 'amount', 'duration', 'lifetime'] as const;

/** Every key a `PowerupPad` may carry (PADS1) — same argument again. */
export const POWERUP_PAD_KEYS = ['x', 'y', 'type', 'firstTurn', 'everyTurns'] as const;

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

/**
 * `isUltimate` exempts a character's ultimate from the non-ultimate range cap
 * (M2) — Lance of Dawn is range 99 by design. It defaults to false so the cap is
 * the safe default for any caller that does not say otherwise.
 */
export function validateAbility(a: AbilityDef, path: string, isUltimate = false): string[] {
  const errs: string[] = [];
  for (const key of Object.keys(a)) {
    if (!(ABILITY_KEYS as readonly string[]).includes(key)) {
      errs.push(`${path}: unknown key "${key}" (did you mean one of: ${ABILITY_KEYS.join(', ')})`);
    }
  }
  if (!a.id) errs.push(`${path}: missing id`);
  if (!a.name) errs.push(`${path}: missing name`);
  if (!ABILITY_PHASES.includes(a.phase)) {
    errs.push(`${path}: invalid phase "${a.phase}" (prep|dash|blast)`);
  }
  if (!TARGET_SHAPES.includes(a.shape)) {
    errs.push(`${path}: invalid shape "${a.shape}"`);
  }
  if (!isInt(a.range) || a.range < 0) errs.push(`${path}: range must be a non-negative integer`);
  // Map geometry depends on this: spawn separation (M1) is sized so no turn-1
  // move+ability reaches the enemy spawn, and one retuned range would silently
  // break it. Ultimates are exempt (Lance of Dawn is range 99 by design).
  if (!isUltimate && isInt(a.range) && a.range > MAX_ABILITY_RANGE) {
    errs.push(`${path}: non-ultimate range must be <= ${MAX_ABILITY_RANGE} (got ${a.range})`);
  }
  if (a.shape === 'circle' && (!isInt(a.radius) || (a.radius ?? 0) < 1)) {
    errs.push(`${path}: circle shape requires integer radius >= 1`);
  }
  // BASIC-AXIS: a cone-only knob. On any other shape there is no axis to be on,
  // and a silently-ignored field is a balance number nobody can find.
  if (a.axisBonus !== undefined) {
    if (a.shape !== 'cone') errs.push(`${path}: axisBonus is only meaningful on a cone (shape is "${a.shape}")`);
    if (!isInt(a.axisBonus) || a.axisBonus < 1) errs.push(`${path}: axisBonus must be an integer >= 1 when present`);
  }
  // BASIC-BEAM: cone-only, and **odd** — an even lane has no centre axis to
  // rotate around, so `beamWidth: 2` is not a wider beam but an ill-defined one.
  // Refused as data rather than rounded, for the reason every other validator
  // here exists: a number the engine quietly reinterprets is a number the
  // designer cannot reason about (Designer, clashes-and-basics.md §3.4).
  if (a.beamWidth !== undefined) {
    if (a.shape !== 'cone') errs.push(`${path}: beamWidth is only meaningful on a cone (shape is "${a.shape}")`);
    if (!isInt(a.beamWidth) || a.beamWidth < 1) {
      errs.push(`${path}: beamWidth must be an integer >= 1 when present`);
    } else if (a.beamWidth % 2 === 0) {
      errs.push(`${path}: beamWidth must be ODD (got ${a.beamWidth}) — an even lane has no centre axis`);
    }
  }
  // BASIC-INNER: a circle-only pair, and a pair — an inner radius with nothing
  // to deal there, or an inner amount with no disc to deal it in, is a number
  // the engine would silently ignore.
  if (a.innerRadius !== undefined || a.innerAmount !== undefined) {
    if (a.shape !== 'circle') errs.push(`${path}: innerRadius/innerAmount are only meaningful on a circle (shape is "${a.shape}")`);
    if (a.innerRadius === undefined || a.innerAmount === undefined) {
      errs.push(`${path}: innerRadius and innerAmount must be given together`);
    }
    if (a.innerRadius !== undefined && (!isInt(a.innerRadius) || a.innerRadius < 0)) {
      errs.push(`${path}: innerRadius must be a non-negative integer`);
    }
    if (a.innerAmount !== undefined && (!isInt(a.innerAmount) || a.innerAmount < 1)) {
      errs.push(`${path}: innerAmount must be an integer >= 1`);
    }
    // An inner disc as wide as the circle is the circle: the ring vanishes and
    // the ability has two numbers for one footprint, which is a data mistake
    // rather than a design.
    if (isInt(a.innerRadius) && isInt(a.radius) && a.innerRadius >= a.radius) {
      errs.push(`${path}: innerRadius (${a.innerRadius}) must be smaller than radius (${a.radius}) or there is no ring left`);
    }
  }
  if (!isInt(a.cooldown) || a.cooldown < 0) errs.push(`${path}: cooldown must be a non-negative integer`);
  if (!isInt(a.energyGain) || a.energyGain < 0) errs.push(`${path}: energyGain must be a non-negative integer`);
  if (a.delayTurns !== undefined && (!isInt(a.delayTurns) || a.delayTurns < 1)) {
    errs.push(`${path}: delayTurns must be an integer >= 1 when present`);
  }
  if (a.chargeHits !== undefined) {
    if (a.chargeHits !== 'first' && a.chargeHits !== 'all') {
      errs.push(`${path}: chargeHits must be "first" or "all" when present`);
    }
    if (a.shape !== 'path') errs.push(`${path}: chargeHits is only valid on a "path" (charge) ability`);
  }
  // FREE1: `free` is only ever safe under both of these. A free Dash/Blast
  // would be a repeatable extra attack (that job belongs to catalysts, which are
  // once per match); a free ability that also granted energy would be strictly
  // better than a normal one in every dimension and would accelerate the ult
  // clock for nothing. Both are validation errors, not runtime special cases.
  if (a.free === true) {
    // …except a catalyst, which is consumed rather than cooled down. The reason
    // the restriction exists is that a *repeatable* free attack is too strong;
    // `oncePerMatch` is exactly the property that removes that (CAT1).
    if (a.phase !== 'prep' && a.oncePerMatch !== true) {
      errs.push(`${path}: free abilities must be phase "prep" unless oncePerMatch (got "${a.phase}")`);
    }
    if (a.energyGain !== 0) errs.push(`${path}: free abilities must have energyGain 0 (got ${a.energyGain})`);
  }
  if (a.free !== undefined && typeof a.free !== 'boolean') {
    errs.push(`${path}: free must be a boolean when present`);
  }
  // DASH-IMPACT. Worth spelling out because `validateAbility` lets unknown keys
  // through: the three staged `impact` blocks sat in `data/` for a session and
  // the suite accepted them silently. A typo'd radius must not do the same.
  if (a.impact !== undefined) {
    if (typeof a.impact !== 'object' || Array.isArray(a.impact)) {
      errs.push(`${path}: impact must be an object with origin/destination radii`);
    } else {
      if (a.phase !== 'dash') errs.push(`${path}: impact is only valid on a "dash" ability (got "${a.phase}")`);
      const { origin, destination, ...rest } = a.impact;
      for (const key of Object.keys(rest)) errs.push(`${path}: unknown impact member "${key}"`);
      if (origin === undefined && destination === undefined) {
        errs.push(`${path}: impact must declare at least one of origin/destination`);
      }
      for (const [name, r] of [['origin', origin], ['destination', destination]] as const) {
        if (r !== undefined && (!isInt(r) || r < 1)) {
          errs.push(`${path}: impact.${name} must be an integer >= 1 (got ${String(r)})`);
        }
      }
    }
  }
  if (!Array.isArray(a.effects) || a.effects.length === 0) {
    errs.push(`${path}: must declare at least one effect`);
  } else {
    for (const [i, e] of a.effects.entries()) {
      for (const key of Object.keys(e)) {
        if (!(EFFECT_KEYS as readonly string[]).includes(key)) {
          errs.push(`${path}.effects[${i}]: unknown key "${key}"`);
        }
      }
      if (!EFFECT_KINDS.includes(e.kind)) {
        errs.push(`${path}.effects[${i}]: unknown effect kind "${e.kind}"`);
      }
      if (e.amount !== undefined && !isInt(e.amount)) {
        errs.push(`${path}.effects[${i}]: amount must be an integer`);
      }
      if (e.duration !== undefined && (!isInt(e.duration) || e.duration < 1)) {
        errs.push(`${path}.effects[${i}]: duration must be an integer >= 1`);
      }
      // TRAP-LIFETIME: the owner's general cap, enforced where every other
      // content cap is. Rejected on a non-trap effect too — a `lifetime` on a
      // damage effect does nothing, and a field that silently does nothing is
      // exactly what VALIDATE-KEYS exists to catch.
      if (e.lifetime !== undefined) {
        if (e.kind !== 'trap') {
          errs.push(`${path}.effects[${i}]: lifetime is only meaningful on a "trap" effect`);
        } else if (!isInt(e.lifetime) || e.lifetime < 1 || e.lifetime > TRAP_MAX_LIFETIME) {
          errs.push(`${path}.effects[${i}]: trap lifetime must be an integer 1..${TRAP_MAX_LIFETIME}`);
        }
      }
    }
  }
  if (!a.description) errs.push(`${path}: missing description`);
  return errs;
}

export function validateCharacter(c: CharacterDef): string[] {
  const errs: string[] = [];
  const path = `character ${c.id ?? '<no id>'}`;
  if (!c.id) errs.push(`${path}: missing id`);
  if (!c.name) errs.push(`${path}: missing name`);
  if (!['firepower', 'frontline', 'trickster', 'support'].includes(c.archetype)) {
    errs.push(`${path}: invalid archetype "${c.archetype}"`);
  }
  if (!isInt(c.maxHp) || c.maxHp < 1) errs.push(`${path}: maxHp must be a positive integer`);
  if (!Array.isArray(c.abilities) || c.abilities.length !== 4) {
    errs.push(`${path}: must have exactly 4 abilities (v1)`);
  }
  const ids = new Set<string>();
  for (const [i, a] of (c.abilities ?? []).entries()) {
    errs.push(...validateAbility(a, `${path}.abilities[${i}]`));
    if (ids.has(a.id)) errs.push(`${path}: duplicate ability id "${a.id}"`);
    ids.add(a.id);
  }
  if (!c.ultimate) {
    errs.push(`${path}: missing ultimate`);
  } else {
    errs.push(...validateAbility(c.ultimate, `${path}.ultimate`, true)); // ults are range-exempt (M2)
    if (ids.has(c.ultimate.id)) errs.push(`${path}: ultimate id duplicates an ability id`);
  }
  return errs;
}

function inBounds(p: Vec2, m: MapDef): boolean {
  return isInt(p.x) && isInt(p.y) && p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height;
}

const key = (p: Vec2) => `${p.x},${p.y}`;

export function validateMap(m: MapDef): string[] {
  const errs: string[] = [];
  const path = `map ${m.id ?? '<no id>'}`;
  if (!m.id) errs.push(`${path}: missing id`);
  if (!isInt(m.width) || !isInt(m.height) || m.width < 8 || m.height < 8) {
    errs.push(`${path}: width/height must be integers >= 8`);
  }
  const solid = new Set<string>();
  for (const kind of ['walls', 'cover', 'brush'] as const) {
    for (const [i, p] of (m[kind] ?? []).entries()) {
      if (!inBounds(p, m)) errs.push(`${path}.${kind}[${i}]: out of bounds (${p.x},${p.y})`);
      if (kind !== 'brush') {
        if (solid.has(key(p))) errs.push(`${path}.${kind}[${i}]: overlaps another solid square at (${p.x},${p.y})`);
        solid.add(key(p));
      }
    }
  }
  if (!Array.isArray(m.spawns) || m.spawns.length !== 2) {
    errs.push(`${path}: spawns must be [player0[], player1[]]`);
  } else {
    for (const [pi, list] of m.spawns.entries()) {
      if (!Array.isArray(list) || list.length < 1) {
        errs.push(`${path}.spawns[${pi}]: at least one spawn square required`);
        continue;
      }
      for (const [i, p] of list.entries()) {
        if (!inBounds(p, m)) errs.push(`${path}.spawns[${pi}][${i}]: out of bounds`);
        if (solid.has(key(p))) errs.push(`${path}.spawns[${pi}][${i}]: spawn on a solid square`);
      }
    }
    if (m.spawns[0]!.length !== m.spawns[1]!.length) {
      errs.push(`${path}: both players must have the same number of spawns`);
    }
  }
  errs.push(...validatePowerups(m, solid, path));
  return errs;
}

/**
 * Power-up pad schema (PADS1). `solid` is the wall/cover set already built by
 * {@link validateMap} — a pad on a square nobody can stand on is a pad nobody
 * can ever take, which is a data bug and not a balance choice.
 *
 * The pad's square is its identity (the live respawn record keys off it), so two
 * pads sharing one is rejected outright rather than resolved by some rule.
 *
 * **PADS-SPREAD: no two pads may touch, diagonals included.** Two pads side by
 * side are not two pick-ups — they are one prize worth double, taken by one
 * unit standing between them, and (since PADS-PASS) swept up by anybody who
 * merely walks past. That collapses the decision a pad is supposed to create:
 * a contested square you commit to, weighed against the squares you give up to
 * reach it. Atlas Reactor's maps place their power-ups one square each, spread
 * across the board so that taking one is a real detour; this rule is that
 * shape, expressed as the minimum a map must satisfy. Chebyshev ≥ 2, so a pad
 * has an empty ring around it however you approach.
 *
 * A *minimum*, not a placement policy: how far apart beyond touching, and which
 * squares, stays the Designer's.
 */
function validatePowerups(m: MapDef, solid: ReadonlySet<string>, path: string): string[] {
  const errs: string[] = [];
  if (m.powerups === undefined) return errs;
  if (!Array.isArray(m.powerups)) return [`${path}.powerups: must be an array`];

  const seen = new Set<string>();
  for (const [i, pad] of m.powerups.entries()) {
    const at = `${path}.powerups[${i}]`;
    for (const k of Object.keys(pad as unknown as Record<string, unknown>)) {
      if (!(POWERUP_PAD_KEYS as readonly string[]).includes(k)) errs.push(`${at}: unknown key "${k}"`);
    }
    if (!isInt(pad.x) || !isInt(pad.y) || !inBounds(pad as unknown as Vec2, m)) {
      errs.push(`${at}: out of bounds (${pad.x},${pad.y})`);
    } else if (solid.has(key(pad as unknown as Vec2))) {
      errs.push(`${at}: on a solid square (${pad.x},${pad.y}) — nobody could ever take it`);
    }
    const k = key(pad as unknown as Vec2);
    if (seen.has(k)) errs.push(`${at}: a second pad on (${pad.x},${pad.y})`);
    seen.add(k);

    if (!(POWERUP_TYPES as readonly string[]).includes(pad.type)) {
      errs.push(`${at}: unknown powerup type "${pad.type}"`);
    }
    for (const field of ['firstTurn', 'everyTurns'] as const) {
      const v: PowerupPad[typeof field] = pad[field];
      if (!isInt(v) || v < 1) errs.push(`${at}: ${field} must be an integer >= 1`);
    }

    // PADS-SPREAD. Reported against the later pad of a pair and only once per
    // pair, so a map with a cluster of four gets three actionable lines rather
    // than twelve restatements of the same fact.
    for (const other of m.powerups.slice(0, i)) {
      const dx = Math.abs(pad.x - other.x);
      const dy = Math.abs(pad.y - other.y);
      if (dx === 0 && dy === 0) continue; // already reported as a duplicate square
      if (Math.max(dx, dy) <= 1) {
        errs.push(`${at}: touches the pad at (${other.x},${other.y}) — pads may not be adjacent`);
      }
    }
  }
  return errs;
}
