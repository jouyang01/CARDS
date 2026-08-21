/**
 * SKY-DOME — the void the arena floats in, as pure data.
 *
 * The scene background was one flat `Color`, which is why the board read as a
 * slab in a vacuum rather than a place: a flat field behind a diorama gives the
 * eye nothing to place it against. A vertical ramp does, and costs one texture.
 *
 * **Why this is its own module, with no `three` import.** The e2e reads
 * composited pixels and has to know what the sky *should* be at a given height;
 * the alternative is a hand-copied hex in `e2e/pixels.ts` that silently stops
 * matching the renderer the first time anyone retunes the ramp. Keeping the
 * palette and the ramp maths dependency-free means the browser test imports the
 * same source the renderer draws from, and a drift between them is impossible
 * rather than merely unlikely.
 *
 * The ramp is deliberately **darker than the lit floor**. Measured off a real
 * composite, the floor arrives at about `rgb(18, 20, 27)` under BOARD-LIT, and
 * the old flat background was `#12141a` — within one count of it on every
 * channel. That is why `isSceneBackground` could never actually tell the board
 * from the void behind it, and why the "no rank is clipped" check was weaker
 * than it looked. Both ends of this ramp clear the floor by more than the
 * matcher's tolerance, so the same check now means what it says.
 */

/** Straight sRGB bytes, as the composite delivers them. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const SKY = {
  /** Top of frame — nearly black, so the board stays the brightest thing on it. */
  top: 0x04060e,
  /** Bottom of frame — a cold lift, enough to read as depth rather than as dirt. */
  bottom: 0x0e1c34,
} as const;

/** Rows in the rasterised gradient. Also the resolution `onSkyRamp` walks. */
export const SKY_PX = 256;

export const rgbOf = (hex: number): Rgb => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
});

/** The sky at normalised height `t` — 0 at the top of frame, 1 at the bottom. */
export const skyAt = (t: number): Rgb => {
  const k = Math.max(0, Math.min(1, t));
  const top = rgbOf(SKY.top);
  const bottom = rgbOf(SKY.bottom);
  return {
    r: Math.round(top.r + (bottom.r - top.r) * k),
    g: Math.round(top.g + (bottom.g - top.g) * k),
    b: Math.round(top.b + (bottom.b - top.b) * k),
  };
};

/**
 * True when a pixel sits anywhere on the ramp, within `tolerance` per channel.
 *
 * The e2e samples corners of a *clipped* region, so it cannot know which height
 * of the gradient it is looking at — hence "anywhere on the ramp" rather than
 * "the sky at this y". Walking `SKY_PX` steps is exact for a ramp this short and
 * needs no inverse.
 */
export const onSkyRamp = (px: Rgb, tolerance = 5): boolean => {
  for (let i = 0; i <= SKY_PX; i++) {
    const s = skyAt(i / SKY_PX);
    if (Math.abs(px.r - s.r) <= tolerance
      && Math.abs(px.g - s.g) <= tolerance
      && Math.abs(px.b - s.b) <= tolerance) return true;
  }
  return false;
};
