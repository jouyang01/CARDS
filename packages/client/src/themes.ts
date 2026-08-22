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
 * FOG-SHADOW — how far a fogged tile is darkened.
 *
 * **Fog is a shadow, not a blackout, and an earlier draft of this got it wrong.**
 * That draft solved for an alpha driving every theme's floor down to one very
 * dark absolute value, on the theory that VISION1 demanded it. It does not.
 * Hidden units are never drawn at all — `fogView` decides who reaches the
 * renderer — so the wash is a *statement about what you cannot see*, never the
 * mechanism that hides it. Darkening past legibility buys no secrecy; it only
 * erases terrain the player already knows, since walls and cover are public and
 * static. Owner, on seeing it: *"the rest of the map is too fogged up. You
 * should still be able to see the general textures, the tiles should just be
 * slightly shadowed."*
 *
 * That also removes the need for the derivation. Blending toward near-black is
 * **already proportional** — `out ≈ floor · (1 − α)` once the ink is near zero —
 * so one constant is one constant shadow on every theme, pale or dark, with no
 * per-theme solve at all. The machinery was paying for a target that should not
 * have existed.
 */
export const FOG_OPACITY = 0.5;

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

const channels = (hex: number): Rgb => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
});

/**
 * What a fogged tile composites to, as a fraction of the theme's *albedo*.
 *
 * **Measured, not simulated, and the distinction cost a debugging round.** The
 * obvious model — take the albedo, scale it by how much darker the rig renders a
 * surface, then blend the ink over it — needs a lighting factor, and there is no
 * single one: three converts albedo sRGB→linear, lights it, and converts back,
 * so a dark floor loses far more of itself than a pale one. A constant fitted on
 * the dark palette predicted Proving Floor's fogged floor at 55 when it actually
 * composites at 86.
 *
 * What *is* near-constant is the round trip end to end, because the rig's
 * brightening and the fog's darkening pull opposite ways and largely cancel.
 * Fitted against two deliberately unalike themes:
 *
 * | albedo | measured fogged |
 * |---|---|
 * | `#b0aca4` (176,172,164) | (86, 87, 88) |
 * | `#20242f` (32,36,47)    | (11, 13, 18) |
 *
 * Anything relying on this should keep a tolerance — it is a fit over two
 * points, not a law.
 */
export const FOG_RETAIN = 0.49;

/** What a fogged tile composites to — shared with `e2e/pixels.ts` so it cannot drift. */
export function foggedColour(floorHex: number): Rgb {
  const floor = channels(floorHex);
  return {
    r: Math.round(floor.r * FOG_RETAIN),
    g: Math.round(floor.g * FOG_RETAIN),
    b: Math.round(floor.b * FOG_RETAIN),
  };
}

// ── OVERLAY-BY-THEME ────────────────────────────────────────────────────────

/**
 * The floor the overlay opacities in `app.ts` were tuned against.
 *
 * Every one of them — the range wash at 0.16, reach at 0.22, aim at 0.5 — is a
 * number somebody picked while looking at *this* floor. That made them constants
 * only by accident of there being one floor.
 */
const REFERENCE_FLOOR = 0x20242f;

/** How far a boosted overlay may go. Past this it stops being a wash. */
const OVERLAY_BOOST_MAX = 2.2;

/**
 * OVERLAY-BY-THEME — how much harder an overlay must work on this floor.
 *
 * A translucent wash is only as visible as the *distance* it moves the floor,
 * and that distance is `α · |overlay − floor|`. On the dark floor the range
 * envelope's cool blue is a long way from the terrain, so 16% is plenty. On
 * Proving Floor's warm limestone the same blue is much closer in every channel
 * and 16% barely moves it — the composite comes out at `b − r = −10`, which is
 * to say the "blue" envelope is not blue. A player could not see their own
 * range on that map. The e2e caught it; a playtest would have caught it louder.
 *
 * So scale the *strength* while leaving the *colour* alone. Colour is the
 * vocabulary and stays global — a range envelope must be the same blue on every
 * map or it stops being a word the player knows. Opacity is not vocabulary, and
 * deriving it is the same move `FOG_OPACITY` declines to make one section up:
 * there the blend is already proportional, so a constant suffices; here it is not.
 *
 * The boost is a single per-theme factor rather than a per-layer solve because
 * the overlays share one job: sit on the floor and be seen. One number keeps
 * their *relative* weights — which are a real design decision, aim louder than
 * range — exactly as authored.
 */
export function overlayBoost(floorHex: number): number {
  const wash = channels(RANGE_WASH);
  const lit = (hex: number): Rgb => {
    const c = channels(hex);
    return { r: c.r * LIT_FACTOR, g: c.g * LIT_FACTOR, b: c.b * LIT_FACTOR };
  };
  const reach = (floor: Rgb): number => Math.hypot(wash.r - floor.r, wash.g - floor.g, wash.b - floor.b);
  const here = reach(lit(floorHex));
  if (here <= 0) return OVERLAY_BOOST_MAX;
  return Math.min(OVERLAY_BOOST_MAX, Math.max(1, reach(lit(REFERENCE_FLOOR)) / here));
}

/** The range envelope's blue (`app.ts`'s `RANGE`), shared so tests can compose it. */
export const RANGE_WASH = 0x8fb6ff;

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

/**
 * How far fog must pull the floor down before it reads as unseen.
 *
 * Deliberately small, and absolute rather than proportional. The blend is
 * already proportional, so a percentage rule would be checking `FOG_OPACITY`
 * rather than the theme — a rule nothing can fail. What *can* fail is a floor so
 * dark there is nothing left to take: at `#060606` the ink is brighter than the
 * terrain and fog **lightens** the square, which is worse than doing nothing.
 * Six luma clears both shipped dark themes with room and catches that.
 */
export const MIN_FOG_DROP = 6;

/**
 * Saturation ceiling for terrain — brush excepted, since it has to stay green.
 *
 * The UI vocabulary owns the saturated hues; terrain is the ground they are read
 * against. This is the rule that would have caught the warm-sand Proving Floor
 * before it shipped.
 */
export const MAX_TERRAIN_CHROMA = 34;

/** Distance between the strongest and weakest channel — saturation, cheaply. */
export const chroma = (hex: number): number => {
  const { r, g, b } = channels(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
};

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
  // FOG-SHADOW: fog must read as shadow — clearly darker than the lit floor, and
  // still light enough that the terrain under it is legible. Terrain is public
  // knowledge, so a fogged square that has gone black is information destroyed,
  // not information withheld.
  const fog = foggedColour(theme.terrain.open);
  const litOpen = luma(theme.terrain.open);
  const fogged = luma((fog.r << 16) | (fog.g << 8) | fog.b);
  if (litOpen - fogged < MIN_FOG_DROP) {
    errs.push(`${theme.id}: fog only drops the floor ${(litOpen - fogged).toFixed(1)} luma — it will not read as unseen`);
  }

  // AOE-CLASH: the overlay vocabulary owns the saturated hues — amber for aim
  // and AoE, blue for range, yellow for a dash route, green for a catalyst,
  // teal for free actions. Terrain that is itself saturated competes with
  // whichever overlay shares its hue. The owner hit this immediately: Proving
  // Floor's first palette was warm sand, and *"the pale sand color on Duel
  // Arena is conflicting with the yellow aoe previews"*. Chroma is the rule
  // rather than a hue-by-hue distance check, because desaturated terrain is
  // compatible with *every* overlay at once and needs no per-overlay reasoning.
  for (const kind of ['open', 'wall', 'cover'] as const) {
    const c = chroma(theme.terrain[kind]);
    if (c > MAX_TERRAIN_CHROMA) {
      errs.push(`${theme.id}: ${kind} has chroma ${c} (max ${MAX_TERRAIN_CHROMA}) — it will compete with the overlay it shares a hue with`);
    }
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
