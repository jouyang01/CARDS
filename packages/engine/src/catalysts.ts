/**
 * Catalysts (CAT1) — three slots per character, one per phase, each spent once
 * per match.
 *
 * A catalyst is an ordinary `AbilityDef` with two extra flags: `free: true` (it
 * does not consume the turn — see FREE1) and `oncePerMatch: true` (it is
 * consumed rather than put on cooldown). Every one of the nine is built from
 * effect kinds the engine already implements, so this file adds an index and a
 * default selection and nothing else — the behaviour comes from the resolver.
 *
 * Content stays data (golden rule #2): the defs live in `data/catalysts.json`
 * and are loaded by whoever owns I/O. The engine only ever sees the parsed pool.
 */

import { validateAbility } from './validate.js';
import type { AbilityDef, AbilityPhase } from './types.js';

/** Catalyst defs by id — the lookup the resolver does. */
export type CatalystPool = Readonly<Record<string, AbilityDef>>;

/** `data/catalysts.json`'s shape: three per phase, the pool a player picks from. */
export interface CatalystData {
  prep: AbilityDef[];
  dash: AbilityDef[];
  blast: AbilityDef[];
}

/** How many catalysts a unit carries — one per phase (GAME_SPEC phase order). */
export const CATALYST_PHASES: readonly AbilityPhase[] = ['prep', 'dash', 'blast'];

/**
 * The triad every character starts with until the M3 lobby lets players pick
 * (edge-cases, "Catalysts are chosen, not fixed to a character"): the three most
 * neutral options, one per colour.
 */
export const DEFAULT_CATALYSTS: readonly string[] = ['second_wind', 'shift', 'adrenaline'];

/** Flatten the per-phase pool into the id→def index the resolver looks up. */
export function buildCatalystPool(data: CatalystData): CatalystPool {
  const pool: Record<string, AbilityDef> = {};
  for (const phase of CATALYST_PHASES) {
    for (const def of data[phase]) pool[def.id] = def;
  }
  return pool;
}

/**
 * Everything structurally required of the catalyst pool, as a list of errors —
 * the same shape `validateMap` uses, so content problems surface as readable
 * text rather than as a turn that quietly does nothing.
 *
 * Beyond `validateAbility`: a catalyst must sit in the phase block it was filed
 * under, be `free` and `oncePerMatch`, cost no cooldown, and be unique by id
 * across the whole pool.
 */
export function validateCatalysts(data: CatalystData): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const phase of CATALYST_PHASES) {
    const block = data[phase];
    if (!Array.isArray(block) || block.length === 0) {
      errs.push(`catalysts.${phase}: must list at least one catalyst`);
      continue;
    }
    for (const def of block) {
      const path = `catalysts.${phase}/${def.id}`;
      errs.push(...validateAbility(def, path));
      if (def.phase !== phase) errs.push(`${path}: filed under ${phase} but declares phase "${def.phase}"`);
      if (def.free !== true) errs.push(`${path}: catalysts must be free actions (free: true)`);
      if (def.oncePerMatch !== true) errs.push(`${path}: catalysts must be oncePerMatch: true`);
      if (def.cooldown !== 0) errs.push(`${path}: catalysts are consumed, not cooled down (cooldown must be 0)`);
      if (seen.has(def.id)) errs.push(`${path}: duplicate catalyst id "${def.id}"`);
      seen.add(def.id);
    }
  }
  for (const id of DEFAULT_CATALYSTS) {
    if (!seen.has(id)) errs.push(`catalysts: the default triad names "${id}", which is not in the pool`);
  }
  return errs;
}
