/**
 * MAP-THEMES — a map's *look*, as data.
 *
 * Golden rule 2 says content is data. A map's look is content, and until now it
 * was one hardcoded `PALETTE` in `app.ts` shared by every map — which is why
 * Duel Arena and Iron Basin were the same six colours in a different shape.
 *
 * **The themed/global boundary is the same line phase 1 drew between lit and
 * unlit.** The *world* is themed: floor, walls, cover, brush, the material each
 * is made of, the sky, the platform. The *UI vocabulary* is global: team
 * colours, the aim orange, the range wash, pad teals, status-pip inks. Two
 * reasons, and both are about the player rather than the code. Team colour is
 * identity, not decoration — a map that re-tints the teams changes friend-from-
 * foe reading per map. And the overlay palette is a vocabulary learned once;
 * re-teaching it per map is a cost with no upside.
 *
 * **No `three` import, on purpose.** Same reason `sky.ts` has none: `e2e/pixels.ts`
 * has to reason about what the board should look like, and a hand-copied hex in
 * the test drifts from the renderer silently. The browser test imports the same
 * source the renderer draws from.
 */

import { rampAt, type Rgb, type SkyRamp } from './sky.js';
import provingFloor from '../../../data/themes/proving-floor.json' with { type: 'json' };
import drainedWorks from '../../../data/themes/drained-works.json' with { type: 'json' };

export interface SurfaceParams {
  roughness: number;
  metalness: number;
}

export type TerrainKind = 'open' | 'wall' | 'cover' | 'brush';

export interface Theme {
  id: string;
  name: string;
  terrain: Record<TerrainKind, number>;
  surface: Record<TerrainKind, SurfaceParams>;
  sky: SkyRamp;
  arena: { shade: number; rim: number };
}

/** JSON authors colours as `#rrggbb`; the renderer wants the number. */
export const hexOf = (css: string): number => Number.parseInt(css.replace('#', ''), 16);

interface ThemeJson {
  id: string;
  name: string;
  terrain: Record<TerrainKind, string>;
  surface: Record<TerrainKind, SurfaceParams>;
  sky: { top: string; bottom: string };
  arena: { shade: number; rim: string };
}

const KINDS: readonly TerrainKind[] = ['open', 'wall', 'cover', 'brush'];

const parse = (json: ThemeJson): Theme => ({
  id: json.id,
  name: json.name,
  terrain: Object.fromEntries(KINDS.map((k) => [k, hexOf(json.terrain[k])])) as Record<TerrainKind, number>,
  surface: json.surface,
  sky: { top: hexOf(json.sky.top), bottom: hexOf(json.sky.bottom) },
  arena: { shade: json.arena.shade, rim: hexOf(json.arena.rim) },
});

/**
 * Every shipped theme, keyed by id.
 *
 * Bundled rather than fetched: a theme is a few hundred bytes of colour, and the
 * board cannot draw its first frame without one. That is the opposite trade from
 * `character-model.ts`, where the asset is large, optional, and worth an async
 * path — the shape of the data decides, not a rule about assets.
 */
export const THEMES: Readonly<Record<string, Theme>> = Object.freeze(
  Object.fromEntries([provingFloor, drainedWorks].map((j) => {
    const theme = parse(j as ThemeJson);
    return [theme.id, theme];
  })),
);

/** The look a map with no theme — or an unknown one — is drawn with. */
export const FALLBACK_THEME: Theme = {
  id: 'fallback',
  name: 'Fallback',
  terrain: { open: 0x20242f, wall: 0x4a5065, cover: 0x6b5b3e, brush: 0x2e4632 },
  surface: {
    open: { roughness: 0.94, metalness: 0.02 },
    wall: { roughness: 0.78, metalness: 0.14 },
    cover: { roughness: 0.52, metalness: 0.42 },
    brush: { roughness: 1.0, metalness: 0.0 },
  },
  sky: { top: 0x04060e, bottom: 0x0e1c34 },
  arena: { shade: 0.55, rim: 0x1e4552 },
};

/**
 * The theme a map is drawn with.
 *
 * An unknown id **falls back and warns** rather than throwing — the same posture
 * `character-model.ts` takes toward a missing `.glb`. A map that names a theme
 * nobody wrote yet is an ordinary state during authoring; a board that refuses
 * to draw because of it is not. Warning rather than staying silent matters for
 * the same reason it does there: a map with no theme and a map with a typo in
 * its theme id would otherwise be indistinguishable, and only one is fine.
 */
export function themeFor(map: { theme?: string }): Theme {
  if (map.theme === undefined) return FALLBACK_THEME;
  const theme = THEMES[map.theme];
  if (theme !== undefined) return theme;
  console.warn(`[cards] unknown theme "${map.theme}" — falling back to the built-in palette`);
  return FALLBACK_THEME;
}

// ── FOG-BY-THEME ────────────────────────────────────────────────────────────

/**
 * The fog wash's ink. Near-black, and the same in every theme: fog's entire job
 * is to carry no information, and a *themed* fog would be information.
 */
export const FOG_INK = 0x05060a;

/**
 * What a fogged tile must not be brighter than.
 *
 * Sits inside `e2e/pixels.ts`'s `isFogged` (`r < 18 && g < 20 && b < 26`) with
 * room to spare, because that predicate is the machine-readable statement of the
 * thing VISION1 actually promises: an unseen square tells you nothing.
 */
export const FOG_TARGET: Rgb = { r: 12, g: 14, b: 19 };

/**
 * How much darker the rig renders a surface than its authored albedo.
 *
 * Measured off a real composite: `#20242f` floor arrives at about rgb(18,20,27),
 * a factor of ~0.57. An estimate rather than a simulation — but the error is
 * one-directional and harmless. Over-estimating the floor's brightness asks for
 * *more* fog, and fog that is slightly too dark is still fog. Under-estimating
 * is the failure that would matter, so the constant is deliberately generous.
 */
const LIT_FACTOR = 0.6;

/**
 * Fog opacity is clamped at both ends.
 *
 * `min` keeps a dark theme looking exactly as it did when this was a constant.
 * `max` is the interesting one: fog hides *units*, and terrain under it is
 * public knowledge, so a wash approaching opaque erases the board's shape along
 * with the information. An earlier draft capped at 0.96, which had a second
 * problem — no floor at all could then fail the VISION1 contract check, making
 * that check decoration. At 0.9 a near-white floor genuinely fails it and an
 * author is told so at authoring time.
 */
const FOG_ALPHA_LIMITS = { min: 0.62, max: 0.9 } as const;

const channels = (hex: number): Rgb => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
});

/**
 * FOG-BY-THEME — the wash's opacity, derived from the floor it has to hide.
 *
 * Fog was a fixed 62% of near-black, which is a number tuned against one dark
 * floor. Over Proving Floor's limestone it would have left fogged squares
 * plainly readable: the wash would darken the floor *by* a fixed amount instead
 * of *to* a fixed value, and a pale theme would quietly stop honouring VISION1.
 * The test would have caught it, but as a colour-matcher failure that reads like
 * a renderer bug rather than as the rules problem it actually is.
 *
 * So solve for the alpha instead. The overlay is unlit and composites linearly:
 *
 *     out = ink·α + floor·(1 − α)   ⟹   α ≥ (floor − target) / (floor − ink)
 *
 * per channel, and the binding channel wins. A theme can now be as bright as it
 * likes and its fog still lands on the same value.
 */
export function fogOpacity(floorHex: number): number {
  const ink = channels(FOG_INK);
  const floor = channels(floorHex);
  let alpha: number = FOG_ALPHA_LIMITS.min;
  for (const c of ['r', 'g', 'b'] as const) {
    const lit = floor[c] * LIT_FACTOR;
    const span = lit - ink[c];
    // A floor channel already at or under the ink cannot be darkened by mixing
    // toward it, and needs no help — the target is met before any fog is drawn.
    if (span <= 0 || lit <= FOG_TARGET[c]) continue;
    alpha = Math.max(alpha, (lit - FOG_TARGET[c]) / span);
  }
  return Math.min(FOG_ALPHA_LIMITS.max, alpha);
}

/** What a fogged tile composites to under `fogOpacity` — for tests to check. */
export function foggedColour(floorHex: number): Rgb {
  const alpha = fogOpacity(floorHex);
  const ink = channels(FOG_INK);
  const floor = channels(floorHex);
  const mix = (c: 'r' | 'g' | 'b'): number =>
    Math.round(ink[c] * alpha + floor[c] * LIT_FACTOR * (1 - alpha));
  return { r: mix('r'), g: mix('g'), b: mix('b') };
}

// ── The legibility contract ─────────────────────────────────────────────────

/** Rec. 601 luma. The ordering it induces is what survives a bad monitor. */
export const luma = (hex: number): number => {
  const { r, g, b } = channels(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/**
 * How far apart two terrain kinds must sit in luma.
 *
 * The contract is **separation, not ordering**. An earlier draft pinned the
 * ranking (floor darkest, then brush, then wall, then cover) because that is
 * what the built-in palette happens to do — but Proving Floor's whole idea is a
 * floor brighter than anything standing on it, and a rule that forbids it is a
 * rule protecting an accident.
 */
export const MIN_TERRAIN_SEPARATION = 18;

/** Brush is concealment, so it stays recognisably vegetation in every theme. */
export const isGreenDominant = (hex: number): boolean => {
  const { r, g, b } = channels(hex);
  return g > r && g > b;
};

export const themeContractErrors = (theme: Theme): string[] => {
  const errs: string[] = [];
  for (let i = 0; i < KINDS.length; i++) {
    for (let j = i + 1; j < KINDS.length; j++) {
      const a = KINDS[i] as TerrainKind;
      const b = KINDS[j] as TerrainKind;
      const gap = Math.abs(luma(theme.terrain[a]) - luma(theme.terrain[b]));
      if (gap < MIN_TERRAIN_SEPARATION) {
        errs.push(`${theme.id}: ${a} and ${b} are only ${gap.toFixed(1)} luma apart (min ${MIN_TERRAIN_SEPARATION})`);
      }
    }
  }
  if (!isGreenDominant(theme.terrain.brush)) {
    errs.push(`${theme.id}: brush must stay green-dominant — it is concealment, not decoration`);
  }
  for (const kind of KINDS) {
    const px = channels(theme.terrain[kind]);
    if (inUiFamily(px)) errs.push(`${theme.id}: ${kind} lands in a UI colour family the e2e counts`);
  }
  const fogged = foggedColour(theme.terrain.open);
  if (fogged.r >= 18 || fogged.g >= 20 || fogged.b >= 26) {
    errs.push(`${theme.id}: fogged floor composites to rgb(${fogged.r},${fogged.g},${fogged.b}), which is not dark enough for VISION1`);
  }
  for (const t of [0, 1] as const) {
    const ramp = rampAt(theme.sky, t);
    if (inUiFamily(ramp)) errs.push(`${theme.id}: the sky ramp enters a UI colour family`);
  }
  return errs;
};

/**
 * The colour families `e2e/pixels.ts` counts — team blue, team red, aim orange.
 *
 * Terrain that lands in one of them makes an assertion mean something else:
 * "team 0's units are on screen" gets satisfied by the floor, and `isTeamRed`
 * is asserted *equal to zero* to prove the unseen enemy is not drawn, so a
 * red-family wall would break a hidden-information guard outright. Phase 1 hit
 * exactly this with an arena rim; a theme is a much easier way to hit it, which
 * is why the check ships with the schema rather than living in a comment.
 */
export const inUiFamily = (px: Rgb): boolean => {
  const teamBlue = px.b > 130 && px.b - px.r > 50 && px.g < px.b && px.g - px.r < 110;
  const teamRed = px.r > 130 && px.r - px.g > 80 && Math.abs(px.g - px.b) < 40;
  const aimOrange = px.r > 150 && px.g > 90 && px.g < px.r - 30 && px.b < px.g - 20;
  return teamBlue || teamRed || aimOrange;
};

/** Every shipped theme's sky, for the e2e's "is this pixel the void?" check. */
export const SKY_RAMPS: readonly SkyRamp[] = [
  ...Object.values(THEMES).map((t) => t.sky),
  FALLBACK_THEME.sky,
];
