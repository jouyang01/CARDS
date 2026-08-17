import { inflateSync } from 'node:zlib';

/**
 * A minimal PNG reader for RENDER-VERIFY.
 *
 * Playwright hands back PNG bytes and nothing else can see the render —
 * `gl.readPixels` and `toDataURL()` both return all-black off this canvas. PNG
 * *size* turned out to be a poor proxy for "did it draw anything" (a flat frame
 * and a full board are within 20% of each other), so the smoke test reads actual
 * pixels instead. That needs about forty lines, no dependency, and only the one
 * formats Chromium emits: 8-bit non-interlaced truecolour, with or without an
 * alpha channel — it drops alpha when the frame is fully opaque, which a board
 * screenshot always is.
 */

export interface Image {
  width: number;
  height: number;
  /** Row-major samples, `channels` bytes per pixel. */
  data: Uint8Array;
  /** 3 for RGB, 4 for RGBA — Chromium picks per frame. */
  channels: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Paeth predictor — PNG filter type 4. */
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function decodePng(png: Buffer): Image {
  for (const [i, byte] of PNG_MAGIC.entries()) {
    if (png[i] !== byte) throw new Error('not a PNG');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat: Buffer[] = [];

  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8]!;
      colourType = body[9]!;
      if (body[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length; // length + type + body + CRC
  }
  // 2 = truecolour, 6 = truecolour + alpha. Chromium emits whichever is smaller
  // for the frame, so both have to work or the suite fails on an opaque board.
  if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(`expected 8-bit truecolour PNG, got depth ${bitDepth} type ${colourType}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const row = y * stride;
    const prior = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp]! : 0; // left
      const b = y > 0 ? out[prior + x]! : 0; // up
      const c = x >= bpp && y > 0 ? out[prior + x - bpp]! : 0; // up-left
      const value = line[x]!;
      out[row + x] =
        filter === 0 ? value
        : filter === 1 ? (value + a) & 0xff
        : filter === 2 ? (value + b) & 0xff
        : filter === 3 ? (value + ((a + b) >> 1)) & 0xff
        : (value + paeth(a, b, c)) & 0xff;
    }
  }
  return { width, height, data: out, channels: bpp };
}

/** Walk every `step`-th pixel — plenty for presence checks, and much faster. */
export function* samples(image: Image, step = 3): Generator<Rgb> {
  const stride = image.width * image.channels;
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const at = y * stride + x * image.channels;
      yield { r: image.data[at]!, g: image.data[at + 1]!, b: image.data[at + 2]! };
    }
  }
}

/** How many distinct colours a frame contains — 1–2 means nothing was drawn. */
export function distinctColours(image: Image, step = 3): number {
  const seen = new Set<number>();
  for (const { r, g, b } of samples(image, step)) seen.add((r << 16) | (g << 8) | b);
  return seen.size;
}

/** Sampled pixels matching a predicate — used for "is this colour on screen". */
export function countPixels(image: Image, matches: (px: Rgb) => boolean, step = 3): number {
  let n = 0;
  for (const px of samples(image, step)) if (matches(px)) n += 1;
  return n;
}

/**
 * Colour families, written as *relationships* rather than exact values: the
 * renderer shades everything with a Lambert term, so a unit's blue is never
 * literally `#4f8cff` on screen. Asserting the family is the honest test — it
 * catches "nothing drew" without breaking on a lighting tweak.
 */
export const isTeamBlue = (px: Rgb): boolean =>
  px.b > 130 && px.b - px.r > 50 && px.g < px.b
  // …and blue-dominant, not cyan. Team blue is `#4f8cff`, whose green sits 61
  // above its red; PADS-INDICATOR's Energy pad is `#3fe8ff`, where green runs
  // 169 above red and the pixel reads as cyan to any eye. Without this clamp a
  // pad would be counted as a unit, and "team 0's units are on screen" would
  // pass on a board with no units at all.
  && px.g - px.r < 110;
/**
 * Team red is `#ff6b5e` — red-dominant with green and blue close together. The
 * `|g − b|` clamp is what separates it from the *orange* aim overlay and the
 * brown of cover, both of which are also red-dominant; without it, arming an
 * ability quadrupled the "red unit" count.
 */
export const isTeamRed = (px: Rgb): boolean =>
  px.r > 130 && px.r - px.g > 80 && Math.abs(px.g - px.b) < 40;
/**
 * Fogged board (VISION1). The fog quad is near-black at 62% over terrain whose
 * lit floor is already dark, so this is "darker than any lit tile" rather than
 * a hue — the whole point of the colour is that it carries no information.
 */
export const isFogged = (px: Rgb): boolean => px.r < 18 && px.g < 20 && px.b < 26;
/** The aim overlay's orange: warm, bright, and clearly not the brown of cover. */
export const isAimOrange = (px: Rgb): boolean =>
  px.r > 150 && px.g > 90 && px.g < px.r - 30 && px.b < px.g - 20;

/**
 * Brush (`#2e4632`), **lit** — around `40,62,44` once shaded.
 *
 * The lower bound is load-bearing, not slop: fogged brush composites to about
 * `18,27,22`, which is still green-dominant, so without it FOG-ZORDER would
 * happily "find brush" in squares the seat cannot see and then assert that an
 * overlay painted on darkness. The upper bound keeps the HP bar's `90,209,127`
 * out.
 */
export const isBrushGreen = (px: Rgb): boolean =>
  px.g > px.r + 10 && px.g > px.b + 8 && px.g > 44 && px.g < 160 && px.r < 110;

/** Where a predicate matches, in pixel coordinates — for "is it drawn HERE". */
export function findPixels(image: Image, matches: (px: Rgb) => boolean, step = 3): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const stride = image.width * image.channels;
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const at = y * stride + x * image.channels;
      if (matches({ r: image.data[at]!, g: image.data[at + 1]!, b: image.data[at + 2]! })) out.push({ x, y });
    }
  }
  return out;
}

/** The colour at one pixel — for re-sampling a spot found in an earlier frame. */
export function pixelAt(image: Image, x: number, y: number): Rgb {
  const at = y * image.width * image.channels + x * image.channels;
  return { r: image.data[at]!, g: image.data[at + 1]!, b: image.data[at + 2]! };
}

/**
 * The yellow dash route (`#ffd23f`), drawn as an unlit `LineBasicMaterial` so it
 * arrives at close to its literal value. Bright, red≈green, very little blue —
 * which is what separates it from the aim overlay's orange (blue is low there
 * too, but green sits well under red) and from the pale blue move line.
 */
export const isDashYellow = (px: Rgb): boolean =>
  px.r > 180 && px.g > 150 && Math.abs(px.r - px.g) < 70 && px.b < 110 && px.g - px.b > 60;

/**
 * The range envelope: `#8fb6ff` at 0.16 over the open floor, which composites to
 * about `44,52,71`. Bounded on both sides deliberately — the bare floor is
 * `32,36,47` and only 15 apart in blue, so a loose "blue-shifted" test matches
 * most of the board and an envelope covering 200 tiles reads as a rounding
 * error. The upper bound keeps the team-blue unit and the move line out.
 */
export const isRangeWash = (px: Rgb): boolean =>
  px.b - px.r >= 20 && px.b - px.g >= 12 && px.b >= 55 && px.b <= 110;

/**
 * A decoy seen by its OWNER (`#a06bd6` at 0.55 over the dark floor). Purple is
 * the one hue nothing else on the board uses — team colours are blue and red,
 * terrain is grey-green, and every overlay is blue, orange, yellow or green — so
 * "red and blue both high, green well below both" identifies it on its own.
 */
export const isDecoyPurple = (px: Rgb): boolean =>
  px.b > 60 && px.r > 40 && px.r - px.g > 20 && px.b - px.g > 30 && Math.abs(px.r - px.b) < 70;

/**
 * The scene background (`#12141a`) — what shows *around* the board when the whole
 * board is in frame. Matched tightly: it is a flat unlit clear colour, not a
 * Lambert-shaded surface, so it arrives at very close to its literal value.
 */
export const isSceneBackground = (px: Rgb): boolean =>
  Math.abs(px.r - 0x12) <= 4 && Math.abs(px.g - 0x14) <= 4 && Math.abs(px.b - 0x1a) <= 4;


/**
 * PADS-INDICATOR's Health pad (`#2fe0a0`) — the plate at 0.5 over the dark floor
 * and the plus glyph at 0.95, both inside one family.
 *
 * Teal is the point: green-dominant *and* blue-shifted. `b − r` is what
 * separates it from the HP bar's `#5ad17f` (37 apart) and from lit brush, both
 * of which are green with barely any blue; `g − b` keeps the Energy pad's cyan
 * and every blue overlay out. Health is the flavour the coverage drive asserts
 * on, so this is the one pad hue that needs a predicate.
 */
export const isPadTeal = (px: Rgb): boolean =>
  px.g > 110 && px.g - px.r > 70 && px.b - px.r > 55 && px.g - px.b > 15;

/**
 * CAMO-REVEAL's red thicket (`#ff2020` at 0.55 over lit brush ≈ `158,44,32`).
 *
 * **Not usable on its own, and measured to be so.** The composite is the same
 * *hue* as a Lambert-shaded team-red unit — a lit thicket lands near
 * `158,45,37` and a shaded red body near `179,78,70`, with the same green-above-
 * blue ordering — so no channel test separates them. A frame with no thicket at
 * all scores 22 against this predicate, entirely from unit edges.
 *
 * Kept because the colour is right and a *positional* assertion can use it:
 * seed a unit onto a known brush square (`?scenario=in-brush`), then sample
 * that square with `pixelAt` instead of counting the whole frame. Counting is
 * what fails here, not the colour.
 */
export const isCamoRed = (px: Rgb): boolean =>
  px.r > 110 && px.r < 210 && px.r - px.g > 70 && px.r - px.b > 80 && px.g >= px.b;

/**
 * CHASE1's route + quarry ring (`#ff8a3d`).
 *
 * The same warm orange family as the aim overlay — deliberately, since both are
 * "a thing you are pointing at" — so this predicate cannot tell them apart on
 * its own. The coverage drive uses it as a **delta** with no ability armed,
 * where the only orange that can appear is the chase.
 */
export const isChaseOrange = isAimOrange;

/**
 * The largest connected blob among matched pixels, by proximity.
 *
 * `findPixels` returns every matching pixel on the frame, and taking the median
 * of that is only meaningful when there is **one** thing on screen. Once a
 * second enemy came into view, the median of "all red pixels" landed in the gap
 * *between* the two bodies — empty ground — and a click there armed nothing.
 *
 * So: group by proximity and answer with the biggest group. `gap` is how far
 * apart two samples can be and still count as the same blob; it should be a
 * small multiple of the sampling step, since neighbouring samples of one body
 * are exactly `step` apart.
 */
export function largestCluster(
  points: readonly { x: number; y: number }[],
  gap: number,
): { x: number; y: number }[] {
  const unvisited = new Set(points.map((_, i) => i));
  let best: { x: number; y: number }[] = [];
  while (unvisited.size > 0) {
    const seed = unvisited.values().next().value as number;
    unvisited.delete(seed);
    const blob = [points[seed]!];
    // Breadth-first over the remaining points; small frames, so the quadratic
    // scan is cheaper than building an index.
    for (let head = 0; head < blob.length; head++) {
      const p = blob[head]!;
      for (const i of [...unvisited]) {
        const q = points[i]!;
        if (Math.abs(q.x - p.x) <= gap && Math.abs(q.y - p.y) <= gap) {
          unvisited.delete(i);
          blob.push(q);
        }
      }
    }
    if (blob.length > best.length) best = blob;
  }
  return best;
}
