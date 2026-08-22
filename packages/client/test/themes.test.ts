import { describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_THEME, FOG_TARGET, MIN_TERRAIN_SEPARATION, THEMES,
  fogOpacity, foggedColour, hexOf, inUiFamily, isGreenDominant, luma,
  themeContractErrors, themeFor,
} from '../src/themes.js';
import type { MapDef } from '@cards/engine';
import duelArena from '../../../data/maps/duel-arena.json';
import ironBasin from '../../../data/maps/iron-basin.json';

/**
 * MAP-THEMES — the schema, the contract, and the fog that follows from it.
 *
 * A theme is `data/`, which by the `CLAUDE.md` role table means a Designer can
 * add one without touching `packages/`. That is the point, and it is also the
 * risk: phase 1 lost real time to an arena rim that satisfied `isTeamBlue` and a
 * spawn marker that would have broken the fog test's `isTeamRed === 0`
 * assertion. A theme is a much easier way to hit the same wall, so the contract
 * ships as a test rather than as advice in a comment.
 */

/**
 * Authored themes. The fallback is deliberately **not** here.
 *
 * It is the pre-MAP-THEMES palette preserved verbatim so a themeless map still
 * draws, and it does not meet the contract: its wall (`#4a5065`) and cover
 * (`#6b5b3e`) sit **11.9 luma apart**, against a minimum of 18. That is not an
 * oversight to paper over — it is a measurement of why the old board was hard to
 * read, and the reason a contract exists at all. Exempting it keeps the number
 * honest; raising the threshold to fit it would have thrown the finding away.
 */
const ALL = Object.values(THEMES);

describe('every shipped theme honours the legibility contract', () => {
  it.each(ALL)('$name has no contract violations', (theme) => {
    expect(themeContractErrors(theme)).toEqual([]);
  });

  it.each(ALL)('$name keeps its four terrain kinds apart by luma', (theme) => {
    // Separation rather than a fixed ranking. An earlier draft pinned the order
    // the built-in palette happens to use — floor darkest — but Proving Floor's
    // whole idea is a floor brighter than what stands on it, and a rule that
    // forbids that is a rule protecting an accident.
    const kinds = ['open', 'wall', 'cover', 'brush'] as const;
    for (let i = 0; i < kinds.length; i++) {
      for (let j = i + 1; j < kinds.length; j++) {
        const a = kinds[i]!;
        const b = kinds[j]!;
        const gap = Math.abs(luma(theme.terrain[a]) - luma(theme.terrain[b]));
        expect(gap, `${theme.id}: ${a} vs ${b}`).toBeGreaterThanOrEqual(MIN_TERRAIN_SEPARATION);
      }
    }
  });

  it.each(ALL)('$name keeps brush green-dominant — it is concealment', (theme) => {
    expect(isGreenDominant(theme.terrain.brush)).toBe(true);
  });

  it.each(ALL)('$name keeps terrain out of the UI colour families', (theme) => {
    for (const kind of ['open', 'wall', 'cover', 'brush'] as const) {
      const hex = theme.terrain[kind];
      const px = { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
      expect(inUiFamily(px), `${theme.id}.${kind}`).toBe(false);
    }
  });
});

describe('the built-in fallback is legacy, and known not to meet the contract', () => {
  it('fails on exactly the wall/cover pair, by a measured margin', () => {
    const errs = themeContractErrors(FALLBACK_THEME);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/wall and cover are only 11\.9 luma apart/);
  });

  it('is still fine on everything else — it is weak, not broken', () => {
    expect(isGreenDominant(FALLBACK_THEME.terrain.brush)).toBe(true);
    const fogged = foggedColour(FALLBACK_THEME.terrain.open);
    expect(fogged.r).toBeLessThan(18);
  });

  it('is beaten by both authored themes on its worst pair', () => {
    // The point of the phase: the shipped maps should be more readable than the
    // palette they replace, not merely different from it.
    const gap = (t: typeof FALLBACK_THEME): number =>
      Math.abs(luma(t.terrain.wall) - luma(t.terrain.cover));
    for (const theme of ALL) expect(gap(theme), theme.id).toBeGreaterThan(gap(FALLBACK_THEME));
  });
});

describe('the contract actually rejects things', () => {
  // A validator nothing can fail is decoration.
  const bend = (patch: Partial<(typeof FALLBACK_THEME)['terrain']>): typeof FALLBACK_THEME =>
    ({ ...FALLBACK_THEME, id: 'bent', terrain: { ...FALLBACK_THEME.terrain, ...patch } });

  it('rejects two terrain kinds that sit on top of each other', () => {
    const errs = themeContractErrors(bend({ wall: FALLBACK_THEME.terrain.cover }));
    expect(errs.join(' ')).toMatch(/luma apart/);
  });

  it('rejects brush that has stopped being vegetation', () => {
    const errs = themeContractErrors(bend({ brush: 0x8a3b2f }));
    expect(errs.join(' ')).toMatch(/green-dominant/);
  });

  it('rejects terrain wearing a team colour', () => {
    const errs = themeContractErrors(bend({ wall: 0x4f8cff }));
    expect(errs.join(' ')).toMatch(/UI colour family/);
  });

  it('rejects a floor so bright the fog cannot hide it', () => {
    // Fog caps at 90% — above that it stops hiding units and starts erasing the
    // board's shape, which is public knowledge. So a near-white floor genuinely
    // cannot be fogged to target, and an author should be told that at authoring
    // time rather than by a pixel test that reads like a renderer bug.
    const errs = themeContractErrors(bend({ open: 0xf4f4f4 }));
    expect(errs.join(' ')).toMatch(/not dark enough for VISION1/);
  });
});

describe('FOG-BY-THEME lands every floor on the same value', () => {
  it.each(ALL)('$name fogs to within the VISION1 bound', (theme) => {
    const fogged = foggedColour(theme.terrain.open);
    // The bound `e2e/pixels.ts` encodes as `isFogged`.
    expect(fogged.r).toBeLessThan(18);
    expect(fogged.g).toBeLessThan(20);
    expect(fogged.b).toBeLessThan(26);
  });

  it('asks a pale floor for more fog than a dark one', () => {
    // The whole reason the alpha is derived: a fixed 62% darkens *by* a constant
    // rather than *to* a value, so it only reads as "no information" over the
    // one floor it was tuned against.
    expect(fogOpacity(0xb8a781)).toBeGreaterThan(fogOpacity(0x20242f));
  });

  it('leaves the dark built-in floor at the tuned opacity', () => {
    // A dark theme should look exactly as it did before this became derived.
    expect(fogOpacity(FALLBACK_THEME.terrain.open)).toBeCloseTo(0.62, 6);
  });

  it('never returns an alpha outside 0..1', () => {
    for (const floor of [0x000000, 0x20242f, 0xb8a781, 0xffffff]) {
      expect(fogOpacity(floor)).toBeGreaterThan(0);
      expect(fogOpacity(floor)).toBeLessThanOrEqual(1);
    }
  });

  it('needs no fog at all for a floor already darker than the target', () => {
    expect(fogOpacity(0x010101)).toBeCloseTo(0.62, 6);
  });

  it('keeps the target inside the predicate it exists to satisfy', () => {
    expect(FOG_TARGET.r).toBeLessThan(18);
    expect(FOG_TARGET.g).toBeLessThan(20);
    expect(FOG_TARGET.b).toBeLessThan(26);
  });
});

describe('a map resolves to the theme it names', () => {
  it('gives the two shipped maps different themes', () => {
    const a = themeFor(duelArena as unknown as MapDef);
    const b = themeFor(ironBasin as unknown as MapDef);
    expect(a.id).not.toBe(b.id);
    // The complaint this phase answers: the two maps were the same six colours
    // in a different shape.
    expect(a.terrain).not.toEqual(b.terrain);
    expect(a.sky).not.toEqual(b.sky);
  });

  it('falls back for a map that names no theme', () => {
    expect(themeFor({}).id).toBe(FALLBACK_THEME.id);
  });

  it('falls back and warns for a theme nobody wrote', () => {
    // Ordinary during authoring, so it must not throw — but it must not be
    // silent either, or a typo and a deliberate omission look identical.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(themeFor({ theme: 'nope' }).id).toBe(FALLBACK_THEME.id);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('reads #rrggbb the way the JSON authors it', () => {
    expect(hexOf('#b8a781')).toBe(0xb8a781);
    expect(hexOf('b8a781')).toBe(0xb8a781);
  });
});

describe('the material of a place, not just its colour', () => {
  it('inverts which surface is the metal one between the two maps', () => {
    // Proving Floor is stone with brass barricades; Drained Works is iron plate
    // with poured concrete. Two maps that differ only in hue are a recolour.
    const proving = THEMES['proving-floor']!;
    const drained = THEMES['drained-works']!;
    expect(proving.surface.cover.metalness).toBeGreaterThan(proving.surface.open.metalness);
    expect(drained.surface.cover.metalness).toBeLessThan(drained.surface.open.metalness);
  });

  it.each(ALL)('$name keeps every surface physically valid', (theme) => {
    for (const kind of ['open', 'wall', 'cover', 'brush'] as const) {
      const s = theme.surface[kind];
      expect(s.roughness, `${theme.id}.${kind}.roughness`).toBeGreaterThanOrEqual(0);
      expect(s.roughness, `${theme.id}.${kind}.roughness`).toBeLessThanOrEqual(1);
      expect(s.metalness, `${theme.id}.${kind}.metalness`).toBeGreaterThanOrEqual(0);
      expect(s.metalness, `${theme.id}.${kind}.metalness`).toBeLessThanOrEqual(1);
    }
  });

  it.each(ALL)('$name keeps brush matte — foliage that glints reads as glass', (theme) => {
    expect(theme.surface.brush.metalness).toBe(0);
  });
});
