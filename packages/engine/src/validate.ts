import {
  type AbilityDef,
  type CharacterDef,
  type MapDef,
  type Vec2,
  EFFECT_KINDS,
  TARGET_SHAPES,
} from './types.js';

/**
 * Content validation for data-driven characters and maps.
 * Returns a list of human-readable errors; empty list = valid.
 * The Designer's JSON drafts must pass these checks before the Builder wires
 * them into gameplay; CI runs them over everything in /data.
 */

const ABILITY_PHASES = ['prep', 'dash', 'blast'] as const;

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

export function validateAbility(a: AbilityDef, path: string): string[] {
  const errs: string[] = [];
  if (!a.id) errs.push(`${path}: missing id`);
  if (!a.name) errs.push(`${path}: missing name`);
  if (!ABILITY_PHASES.includes(a.phase)) {
    errs.push(`${path}: invalid phase "${a.phase}" (prep|dash|blast)`);
  }
  if (!TARGET_SHAPES.includes(a.shape)) {
    errs.push(`${path}: invalid shape "${a.shape}"`);
  }
  if (!isInt(a.range) || a.range < 0) errs.push(`${path}: range must be a non-negative integer`);
  if (a.shape === 'circle' && (!isInt(a.radius) || (a.radius ?? 0) < 1)) {
    errs.push(`${path}: circle shape requires integer radius >= 1`);
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
  if (!Array.isArray(a.effects) || a.effects.length === 0) {
    errs.push(`${path}: must declare at least one effect`);
  } else {
    for (const [i, e] of a.effects.entries()) {
      if (!EFFECT_KINDS.includes(e.kind)) {
        errs.push(`${path}.effects[${i}]: unknown effect kind "${e.kind}"`);
      }
      if (e.amount !== undefined && !isInt(e.amount)) {
        errs.push(`${path}.effects[${i}]: amount must be an integer`);
      }
      if (e.duration !== undefined && (!isInt(e.duration) || e.duration < 1)) {
        errs.push(`${path}.effects[${i}]: duration must be an integer >= 1`);
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
    errs.push(...validateAbility(c.ultimate, `${path}.ultimate`));
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
  return errs;
}
