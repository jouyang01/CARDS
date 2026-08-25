/**
 * NORMAL MAPS — making the grain catch the light.
 *
 * The board's surfaces carry a `map`: a 64px achromatic pattern of blotches,
 * brush strokes or block seams, at very low amplitude. It is **albedo only**,
 * which means it changes what colour a pixel is and nothing about how it faces
 * the sun. So a theme that describes itself as "wet iron plate, riveted
 * bulkheads" renders as a smooth cube with faintly mottled paint: the rivets
 * are drawn on, and light passes over them as if they were not there.
 *
 * A normal map fixes exactly that, and the pattern to build it from already
 * exists — the same greyscale image, read as a *height field*. Where it is
 * bright the surface is high, where it is dark it is low, and the slope between
 * them is a direction the light can answer. Nothing new has to be authored;
 * this is the information the grain already carries, in the channel that makes
 * it three-dimensional.
 *
 * The conversion is pure and lives here so it can be checked without a canvas,
 * a GL context or a browser — `textures.ts` does the DOM half.
 */

/** How many texels a Sobel step reaches. One: the grain is only 64px. */
const STEP = 1;

/**
 * Turn a greyscale height field into a tangent-space normal map.
 *
 * `height` is one value per texel in `[0, 255]`, row-major, `size` wide.
 * Returns `RGBA` bytes: `xyz` packed into `rgb` the way every normal map does
 * (`0.5` is flat), and alpha left opaque.
 *
 * **Wrapped at the edges rather than clamped.** The grain tiles across a
 * surface, so texel 0 genuinely neighbours texel `size - 1`; clamping would put
 * a seam of false flatness along every tile boundary, which is visible as a
 * grid precisely where the pattern is trying to hide one.
 */
export function heightToNormal(
  height: readonly number[] | Uint8ClampedArray,
  size: number,
  strength: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number): number => {
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return height[wy * size + wx] ?? 0;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel, so a single noisy texel cannot swing the normal on its own.
      const tl = at(x - STEP, y - STEP), t = at(x, y - STEP), tr = at(x + STEP, y - STEP);
      const l = at(x - STEP, y), r = at(x + STEP, y);
      const bl = at(x - STEP, y + STEP), b = at(x, y + STEP), br = at(x + STEP, y + STEP);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      // The gradient points uphill; the normal leans the opposite way.
      const nx = (-dx / 255) * strength;
      const ny = (-dy / 255) * strength;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      out[i] = (nx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * How hard the grain pushes the surface around, per terrain kind.
 *
 * Deliberately restrained. The grain's own amplitude is 4–12 out of 255 — it
 * was authored as a *whisper* of variation, and a normal map cranked until that
 * whisper becomes rivets would be inventing detail the theme never described.
 * What this is for is letting the sun find the pattern at all, not turning a
 * mottle into a relief carving.
 */
export const NORMAL_STRENGTH = 2.4;
