/**
 * SKY-DOME — the void the arena floats in, as pure data.
 *
 * The scene background was one flat `Color`, which is why the board read as a
 * slab in a vacuum rather than a place: a flat field behind a diorama gives the
 * eye nothing to place it against. A vertical ramp does, and costs one texture.
 *
 * MAP-THEMES made the ramp **per theme** — Drained Works sits under flat
 * overcast and Proving Floor under the warm end of the afternoon — so this
 * module holds the ramp *maths* and `themes.ts` holds the ramps.
 *
 * **Why this has no `three` import.** The e2e reads composited pixels and has to
 * know what the sky should be at a given height; the alternative is a
 * hand-copied hex in `e2e/pixels.ts` that silently stops matching the renderer
 * the first time anyone retunes a ramp. Keeping the maths dependency-free means
 * the browser test imports the same source the renderer draws from, and a drift
 * between them is impossible rather than merely unlikely.
 */

/** Straight sRGB bytes, as the composite delivers them. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Top of frame to bottom of frame. */
export interface SkyRamp {
  top: number;
  bottom: number;
}

/** Rows in the rasterised gradient. Also the resolution `onAnyRamp` walks. */
export const SKY_PX = 256;

export const rgbOf = (hex: number): Rgb => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
});

/** A ramp at normalised height `t` — 0 at the top of frame, 1 at the bottom. */
export const rampAt = (ramp: SkyRamp, t: number): Rgb => {
  const k = Math.max(0, Math.min(1, t));
  const top = rgbOf(ramp.top);
  const bottom = rgbOf(ramp.bottom);
  return {
    r: Math.round(top.r + (bottom.r - top.r) * k),
    g: Math.round(top.g + (bottom.g - top.g) * k),
    b: Math.round(top.b + (bottom.b - top.b) * k),
  };
};

/** True when a pixel sits anywhere on one ramp, within `tolerance` per channel. */
export const onRamp = (ramp: SkyRamp, px: Rgb, tolerance = 5): boolean => {
  for (let i = 0; i <= SKY_PX; i++) {
    const s = rampAt(ramp, i / SKY_PX);
    if (Math.abs(px.r - s.r) <= tolerance
      && Math.abs(px.g - s.g) <= tolerance
      && Math.abs(px.b - s.b) <= tolerance) return true;
  }
  return false;
};

/**
 * True when a pixel is the void under *any* shipped theme.
 *
 * The e2e samples the corners of a clipped region to prove no rank of the board
 * is cut off, and it cannot know which height of which gradient it is looking
 * at — hence "anywhere on any ramp". That is only an honest check because the
 * theme contract forbids a ramp from colliding with terrain: `themes.ts` proves
 * the separation, and this leans on it.
 */
export const onAnyRamp = (ramps: readonly SkyRamp[], px: Rgb, tolerance = 5): boolean =>
  ramps.some((ramp) => onRamp(ramp, px, tolerance));
