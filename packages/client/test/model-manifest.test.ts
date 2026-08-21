import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditClips, type CharacterManifest } from '../src/character-model.js';
import aegis from '../../../data/characters/aegis.json';
import type { CharacterDef } from '@cards/engine';

/**
 * MODEL-MANIFEST — the shipped manifests are checked in CI, not in the browser.
 *
 * `public/models/` is the one place in this repo where a **build artifact is a
 * committed source file**: `build_glb.py` writes it on somebody's laptop and it
 * is pushed by hand. Nothing regenerates it on CI, so it drifts — the first one
 * committed had been written by an older version of the script and carried no
 * clip map at all, which the client can only discover at runtime, on the live
 * site, as a unit that silently stays a box.
 *
 * These specs read the actual files a browser will fetch. They are the only
 * check that a hand-shipped asset is well formed before a player finds out.
 */

const MODELS = new URL('../public/models/', import.meta.url).pathname;
const manifests = existsSync(MODELS)
  ? readdirSync(MODELS).filter((f) => f.endsWith('.clips.json'))
  : [];

const load = (file: string): CharacterManifest =>
  JSON.parse(readFileSync(join(MODELS, file), 'utf8')) as CharacterManifest;

describe('MODEL-MANIFEST: every committed model is loadable', () => {
  // Not `it.each` over an empty list — that reports zero tests and reads as a
  // pass. Until a model is committed this is the honest statement of the state.
  if (manifests.length === 0) {
    it('no models are committed yet, which is a valid state', () => {
      expect(manifests).toEqual([]);
    });
    return;
  }

  it.each(manifests)('%s names itself after its file', (file) => {
    expect(load(file).id).toBe(file.replace('.clips.json', ''));
  });

  it.each(manifests)('%s ships the .glb it describes', (file) => {
    expect(existsSync(join(MODELS, `${load(file).id}.glb`)), 'mesh beside the manifest').toBe(true);
  });

  it.each(manifests)('%s carries a clip map, so the client has something to play', (file) => {
    // The failure that shipped: {id, clips} and nothing else. The client reads
    // `map` for every cue, so without it the model loads and then is discarded.
    const map = load(file).map;
    expect(map, 'rebuild with tools/art/build_glb.py').toBeDefined();
    for (const cue of ['idle', 'run', 'hit', 'death', 'knockback'] as const) {
      expect(typeof map![cue], `${cue} clip`).toBe('string');
    }
  });

  it.each(manifests)('%s only names clips that are in the .glb', (file) => {
    // The same audit the client runs at load time, run in CI instead — where it
    // costs a red build rather than a T-pose on the board.
    const m = load(file);
    const audit = auditClips(m.map, m.clips);
    expect(audit.missing, 'named by the map, absent from the .glb').toEqual([]);
    expect(audit.usable, 'an idle clip, or the unit stands in bind pose').toBe(true);
  });

  it.each(manifests)('%s is versioned, so a re-rig cannot serve from cache', (file) => {
    expect(load(file).version ?? '').not.toBe('');
  });
});

describe('MODEL-MANIFEST: the ability map has not drifted from the roster', () => {
  const AEGIS = aegis as unknown as CharacterDef;
  const m = manifests.includes('aegis.clips.json') ? load('aegis.clips.json') : undefined;
  const mapped = Object.keys(m?.map?.abilities ?? {});

  it('names no ability that no longer exists', () => {
    if (m === undefined) return; // no model committed yet — covered above
    // Pure drift, and the direction that is unambiguously a bug: a rename in
    // data/characters/ that nobody propagated leaves a clip bound to nothing.
    const real = new Set([...AEGIS.abilities.map((a) => a.id), AEGIS.ultimate.id]);
    expect(mapped.filter((id) => !real.has(id)), 'mapped, but not in the roster').toEqual([]);
  });

  it('animates every ability on the bar', () => {
    if (m === undefined) return;
    const missing = AEGIS.abilities.map((a) => a.id).filter((id) => !mapped.includes(id));
    expect(missing, 'ability with no clip — it would play idle instead').toEqual([]);
  });

  it('does not yet animate the ultimate, and that is a known gap', () => {
    if (m === undefined) return;
    // Deliberately asserting the CURRENT state rather than the desired one.
    // `warding_halo` has no clip, so Aegis's ultimate plays his idle — while the
    // clip literally downloaded as `aegis_ultimate` is bound to `barrier_pulse`.
    // Which clip answers which ability is Designer-owned (data/art/<id>.json), so
    // this records the gap loudly instead of a Builder quietly reassigning it.
    // When the Designer fixes the mapping, this spec flips to the line below it.
    expect(mapped).not.toContain(AEGIS.ultimate.id);
    expect(AEGIS.ultimate.id).toBe('warding_halo');
  });
});
