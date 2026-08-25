/**
 * VALUE-BUDGET — who is allowed to be bright.
 *
 * Measured off a real composite of Proving Grounds, models and props on:
 *
 * | percentile | luminance |
 * |---|---|
 * | p50 | 151.7 |
 * | p75 | 162.9 |
 * | p95 | 193.8 |
 * | p99 | **193.8** |
 *
 * p95 and p99 are the same number. The top of the histogram is a *plateau*:
 * 0.8% of the frame sits above 200 and 33% of it sits inside the single
 * ten-wide bucket at 160–169. The board looked flat because it measurably was,
 * and no amount of chamfering, normal-mapping or contact shading could fix it —
 * all three had already shipped when that frame was taken.
 *
 * The cause is a hierarchy in the wrong order. Proving Floor authored `wall` at
 * luminance 213 and `open` at 172, so **terrain owned the entire top of the
 * range**, while the things the player is actually looking at sat underneath it:
 * Aegis composited at 112, a team-blue box at 90. Units read as holes in a
 * bright surface rather than as figures on a ground, and there was nowhere left
 * for a highlight or an impact flash to go — the brightest thing a hit could
 * produce was already darker than the floor beside it.
 *
 * So terrain gets a ceiling and everything above it is reserved. This is the
 * same move `docs/GAME_SPEC.md` makes with colour and the theme note makes with
 * chroma — *"the UI owns the saturated hues; terrain is the ground they are read
 * against"* — extended to the axis that decision left unclaimed. Terrain gave up
 * its chroma and kept its value; now it gives up the top of its value too.
 *
 * **Only terrain is constrained here, deliberately.** Unit colour is identity
 * and is about to become viewer-relative friend-or-foe (BACKLOG FOF-UNITS:
 * self blue, ally green, foe red). A rule that pinned unit values would be this
 * module reaching into a decision that is not its own. The budget says what the
 * *ground* may do; what stands on it is someone else's call.
 */

/** A theme's terrain albedo, as authored in `data/themes/*.json`. */
export interface TerrainAlbedo {
  open: string;
  wall: string;
  cover: string;
  brush: string;
}

/** sRGB bytes, exactly as a hex string carries them. */
export interface Rgb888 { r: number; g: number; b: number }

/** `#rrggbb` → bytes. Returns undefined for anything that is not one. */
export function parseHex(hex: string): Rgb888 | undefined {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Rec. 709 relative luminance over sRGB *bytes*, 0–255.
 *
 * Deliberately gamma-naive — the same weighted sum `e2e/pixels.ts` takes over a
 * screenshot. The budget is a statement about authored albedo compared against
 * measured pixels, so both sides have to be measured the same way or the
 * comparison is between two different quantities that happen to share a name.
 */
export function luminance(hex: string): number | undefined {
  const c = parseHex(hex);
  if (c === undefined) return undefined;
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The brightest a terrain albedo may be authored.
 *
 * 185 rather than a rounder number because it has to clear two things at once.
 * Proving Floor's `wall` is the brightest terrain in the game and has to come
 * *down* through it (213 → 176), while Drained Works' terrain — the dark theme,
 * top value 123 — must not have to move at all: a ceiling that forced the dark
 * theme to change would be a ceiling that had stopped describing brightness and
 * started describing taste.
 *
 * The headroom this buys is the point. A floor at 150 leaves ~105 of range above
 * it for units, highlights and impacts. At 172 there were ~83, and the top 40 of
 * those were already spent on the walls.
 */
export const TERRAIN_VALUE_CEILING = 185;

/**
 * Every hex in an arbitrary nested structure, with the path that reached it.
 *
 * Props need this and terrain does not: `data/themes/*.json` has one flat
 * `terrain` block, while `data/props/*.json` nests a palette under each role.
 * Walking generically means a new prop role or a new palette entry is covered by
 * the budget the day it is authored, rather than the day someone remembers.
 */
export function hexesIn(value: unknown, path = ''): { path: string; hex: string }[] {
  if (typeof value === 'string') {
    return parseHex(value) === undefined ? [] : [{ path, hex: value }];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => hexesIn(v, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => hexesIn(v, path === '' ? k : `${path}.${k}`));
  }
  return [];
}

/**
 * The same ceiling, over anything that paints the world.
 *
 * **Props were the whole reason this generalised.** Terrain was lowered to
 * 182/138 and the composite did not move: p95 and p99 stayed at exactly 185.4
 * across two passes, unchanged while `wall` went 176 -> 182. The plateau was not
 * terrain at all — it was 19,508 pixels of one exact RGB from
 * `data/props/proving-floor.json`, whose `shaft` was `#d8d5cd`. That is the
 * *old* wall colour, copied across when the props were authored and never
 * re-derived, so changing the theme left the brightest surface in the game
 * exactly where it was.
 *
 * Which is the argument for a rule instead of a value: a budget that only knew
 * about `terrain` would have been satisfied by a board that had not changed.
 */
export function paletteViolations(
  source: unknown,
): { surface: string; hex: string; luminance: number }[] {
  return hexesIn(source)
    .map(({ path, hex }) => ({ surface: path, hex, luminance: luminance(hex) ?? Number.NaN }))
    .filter((e) => !(e.luminance <= TERRAIN_VALUE_CEILING))
    .sort((a, b) => b.luminance - a.luminance);
}

/**
 * Which of a theme's terrain entries break the budget, worst first.
 *
 * Returns entries rather than a boolean because the useful failure message names
 * the surface and the number: "wall #d8d5cd is 213.1, ceiling is 185" is a fix,
 * "theme invalid" is a bug report.
 */
export function budgetViolations(
  terrain: TerrainAlbedo,
): { surface: string; hex: string; luminance: number }[] {
  return (Object.entries(terrain) as [string, string][])
    .map(([surface, hex]) => ({ surface, hex, luminance: luminance(hex) ?? Number.NaN }))
    .filter((e) => !(e.luminance <= TERRAIN_VALUE_CEILING))
    .sort((a, b) => b.luminance - a.luminance);
}
