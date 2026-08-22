import { describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_THEME, FOG_OPACITY, MAX_TERRAIN_CHROMA, MIN_FOG_DROP, MIN_TERRAIN_SEPARATION, THEMES,
  chroma, foggedColour, hexOf, inUiFamily, isGreenDominant, luma,
  SKY_TERRAIN_MARGIN, overlayBoost, themeContractErrors, themeFor,
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
  it('fails on two counts, both of them measured', () => {
    // And the second one is the very complaint that arrived mid-session: the old
    // cover is a saturated brown (chroma 45), which is the same family of
    // problem as the warm sand that fought the amber AoE previews.
    const errs = themeContractErrors(FALLBACK_THEME);
    expect(errs).toHaveLength(2);
    expect(errs.join(' ')).toMatch(/wall and cover are only 11\.9 luma apart/);
    expect(errs.join(' ')).toMatch(/cover has chroma 45/);
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

describe('SKY-vs-TERRAIN: the void cannot wear the board\'s colours', () => {
  it.each(ALL)('$name keeps its sky clear of its own terrain', (theme) => {
    expect(themeContractErrors(theme).filter((e) => e.includes('sky ramp passes through'))).toEqual([]);
  });

  it('catches the sky that started this — Proving Floor\'s first, warm grey one', () => {
    // Its fogged floor composites at (86,84,80) and that ramp passed through
    // (81,82,83), so `isSceneBackground` answered "yes, that is the void" for a
    // fogged board tile. A clipped board then looks exactly like an unclipped
    // one, which is the single thing that check exists to tell apart.
    const warmGrey = {
      ...THEMES['proving-floor']!, id: 'warm-grey-sky', sky: { top: 0x1a2033, bottom: 0x6b6a63 },
    };
    expect(themeContractErrors(warmGrey).join(' ')).toMatch(/sky ramp passes through/);
  });

  it('does not cry wolf at a separation the predicate could never confuse', () => {
    // The margin is deliberately close to the tolerance `onAnyRamp` matches at.
    // A first draft used 9 and failed both dark themes, whose fogged floors are
    // clear at 5 and at 7 — and a validator that fails a theme for a collision
    // that cannot happen is a validator authors learn to ignore.
    expect(SKY_TERRAIN_MARGIN).toBeGreaterThan(5);
    expect(SKY_TERRAIN_MARGIN).toBeLessThan(9);
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

  it('rejects terrain saturated enough to fight an overlay', () => {
    const errs = themeContractErrors(bend({ cover: 0xc98a1e }));
    expect(errs.join(' ')).toMatch(/chroma/);
  });
});

describe('FOG-SHADOW darkens without erasing', () => {
  const lumaOf = (c: { r: number; g: number; b: number }): number =>
    luma((c.r << 16) | (c.g << 8) | c.b);

  it.each(ALL)('$name drops its floor far enough to read as unseen', (theme) => {
    // Against the albedo, not a lit estimate: `foggedColour` is fitted end to
    // end from albedo to composite precisely so no lighting model is needed.
    expect(luma(theme.terrain.open) - lumaOf(foggedColour(theme.terrain.open)))
      .toBeGreaterThanOrEqual(MIN_FOG_DROP);
  });

  it.each(ALL)('$name keeps a fogged tile off the floor of black', (theme) => {
    // The owner's correction: "you should still be able to see the general
    // textures, the tiles should just be slightly shadowed." Terrain is public
    // knowledge, so a fogged square gone black is information destroyed rather
    // than withheld — and hidden *units* were never drawn in the first place.
    const fogged = foggedColour(theme.terrain.open);
    expect(Math.max(fogged.r, fogged.g, fogged.b)).toBeGreaterThan(4);
  });

  it('is one constant, because blending toward black is already proportional', () => {
    // An earlier draft solved per theme for an absolute target. Once fog became
    // a shadow the solve had nothing left to do: `out ≈ floor · (1 − α)`, so one
    // alpha is one shadow of roughly the same depth on every floor. Roughly, not
    // exactly — the ink is near-black rather than black, so it lifts a very dark
    // floor slightly more than it lifts a pale one. A band, not an equality.
    const ratio = (floor: number): number => lumaOf(foggedColour(floor)) / luma(floor);
    for (const floor of [0xb0aca4, 0x232a33, 0x20242f]) {
      expect(ratio(floor), floor.toString(16)).toBeGreaterThan(0.45);
      expect(ratio(floor), floor.toString(16)).toBeLessThan(0.7);
    }
  });

  it('rejects a floor so dark that fog lightens it', () => {
    const pitch = { ...FALLBACK_THEME, id: 'pitch', terrain: { ...FALLBACK_THEME.terrain, open: 0x060606 } };
    expect(themeContractErrors(pitch).join(' ')).toMatch(/will not read as unseen/);
  });

  it('leaves the floor recognisably itself, not tinted toward the ink', () => {
    // A shadow keeps hue. If fog shifted colour it would be saying something
    // about the square, and its whole job is to say nothing.
    const floor = 0xb0aca4;
    const fogged = foggedColour(floor);
    expect(fogged.r).toBeGreaterThan(fogged.b);
  });

  it('stays a shadow rather than approaching opaque', () => {
    expect(FOG_OPACITY).toBeGreaterThan(0.2);
    expect(FOG_OPACITY).toBeLessThan(0.7);
  });
});

describe('AOE-CLASH: terrain leaves the saturated hues to the UI', () => {
  it.each(ALL)('$name keeps floor, wall and cover desaturated', (theme) => {
    // Proving Floor's first palette was warm sand, and the owner hit it at once:
    // "the pale sand color on Duel Arena is conflicting with the yellow aoe
    // previews." Chroma is the rule rather than a hue-by-hue distance, because
    // desaturated terrain is compatible with every overlay at once.
    for (const kind of ['open', 'wall', 'cover'] as const) {
      expect(chroma(theme.terrain[kind]), `${theme.id}.${kind}`).toBeLessThanOrEqual(MAX_TERRAIN_CHROMA);
    }
  });

  it('rejects the warm sand that started this', () => {
    const sandy = { ...FALLBACK_THEME, id: 'sandy', terrain: { ...FALLBACK_THEME.terrain, open: 0xb8a781 } };
    expect(themeContractErrors(sandy).join(' ')).toMatch(/chroma/);
  });

  it.each(ALL)('$name gets an overlay boost that is at least neutral', (theme) => {
    // OVERLAY-BY-THEME never weakens an overlay; a floor closer to the wash
    // colour asks for more of it, never less.
    expect(overlayBoost(theme.terrain.open)).toBeGreaterThanOrEqual(1);
  });

  it('asks a pale floor for more overlay than the dark palette it replaced', () => {
    // Measured outcome of this: the range envelope's blue shift came out at
    // b − r = 30 over *both* the dark palette and Proving Floor's stone, which
    // is the constant-strength goal landing.
    expect(overlayBoost(0xb0aca4)).toBeGreaterThan(overlayBoost(0x20242f));
    expect(overlayBoost(0x20242f)).toBe(1);
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
