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
export const isTeamBlue = (px: Rgb): boolean => px.b > 130 && px.b - px.r > 50 && px.g < px.b;
/**
 * Team red is `#ff6b5e` — red-dominant with green and blue close together. The
 * `|g − b|` clamp is what separates it from the *orange* aim overlay and the
 * brown of cover, both of which are also red-dominant; without it, arming an
 * ability quadrupled the "red unit" count.
 */
export const isTeamRed = (px: Rgb): boolean =>
  px.r > 130 && px.r - px.g > 80 && Math.abs(px.g - px.b) < 40;
/** The aim overlay's orange: warm, bright, and clearly not the brown of cover. */
export const isAimOrange = (px: Rgb): boolean =>
  px.r > 150 && px.g > 90 && px.g < px.r - 30 && px.b < px.g - 20;
