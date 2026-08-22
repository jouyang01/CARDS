/**
 * The texture caches — every rasterised mark the renderer floats over the board.
 *
 * Extracted from `renderer3d.ts` (RENDERER-SPLIT) with **no behavioural change**.
 * Three caches had grown up beside each other there — status glyphs, unit
 * nameplates and UI-INTENT's action tiles — and they share one shape: build a
 * canvas, draw, wrap it in a `CanvasTexture`, key it on everything that changes
 * the pixels, and never draw it twice. That is a module's worth of one idea
 * sitting inside a file about scene graphs.
 *
 * They are module-level rather than per-renderer on purpose: the marks are
 * identical in every renderer instance, and the e2e opens several.
 *
 * The plate/glyph geometry constants stay in `renderer3d.ts` with the meshes
 * that use them; only the *rasterising* moved.
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { ULT_COST } from '@cards/engine';
import {
  GLYPH_BOX, GLYPH_STROKE, statusGlyph, type StatusPip,
} from './status-pips.js';
import {
  ICON_GAP_PX, ICON_PX, PLATE_PAD_PX, PLATE_PX, nameplateKey, plateLayout, type Nameplate,
} from './nameplates.js';
import { SKY_PX, rgbOf, type SkyRamp } from './sky.js';
import { GRAIN_BASE, clampGrain, hashUnit, type GrainSpec } from './grain.js';

/**
 * SKY-DOME — a theme's background ramp, rasterised once per distinct ramp.
 *
 * A **screen-space** gradient rather than a sky sphere, and that is a choice the
 * projection makes rather than a shortcut. Under an orthographic camera every
 * ray is parallel, so a dome large enough to enclose the camera is sampled
 * across only a few degrees of its own curve — the gradient painted on it would
 * arrive very nearly flat, which is the thing being fixed. A background texture
 * is drawn as a full-screen quad, so the ramp lands exactly as authored.
 *
 * Eight pixels wide because the ramp is purely vertical; the sampler stretches
 * it across the canvas for free. `SRGBColorSpace` is not optional — without it
 * three treats the canvas bytes as linear and the composite comes back visibly
 * lighter than `skyAt()` predicts, which would quietly break the e2e matcher
 * that shares this ramp.
 */
const skyCache = new Map<string, CanvasTexture | null>();

export function skyTexture(ramp: SkyRamp): CanvasTexture | null {
  const key = `${ramp.top}|${ramp.bottom}`;
  const cached = skyCache.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = SKY_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    skyCache.set(key, null);
    return null;
  }

  const css = (hex: number): string => {
    const { r, g, b } = rgbOf(hex);
    return `rgb(${r}, ${g}, ${b})`;
  };
  const gradient = ctx.createLinearGradient(0, 0, 0, SKY_PX);
  gradient.addColorStop(0, css(ramp.top));
  gradient.addColorStop(1, css(ramp.bottom));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, SKY_PX);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  skyCache.set(key, texture);
  return texture;
}

/**
 * GRAIN — one tile's worth of surface, rasterised once per distinct spec.
 *
 * **Exactly one tile, and that is the whole trick.** A texture spanning several
 * tiles would let each square differ, but the board is `width × height` squares
 * and a multi-tile texture only lands on square boundaries when the board
 * divides by its size — 18 ÷ 4 does not, so the pattern would slide half a
 * square out of register and grain would cut across tiles instead of sitting in
 * them. At one tile, `repeat = (width, height)` is always an integer and always
 * aligned. The per-tile variation that a bigger texture would have bought is
 * done properly in `renderer3d.ts` with vertex colours instead, where it cannot
 * fall out of register at all.
 *
 * Drawn in greyscale near white because a `map` multiplies the material colour:
 * the theme stays the source of the colour and this only perturbs it.
 */
const grainTextures = new Map<string, CanvasTexture | null>();

/** Texels per tile. Coarse on purpose — a tile is ~37 screen px at rest. */
const GRAIN_PX = 64;

export function grainTexture(seed: number, raw: GrainSpec): CanvasTexture | null {
  const spec = clampGrain(raw);
  if (spec.tint === 0 && spec.speckle === 0) return null;
  const key = `${seed}|${spec.style}|${spec.speckle}`;
  const cached = grainTextures.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = GRAIN_PX;
  canvas.height = GRAIN_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    grainTextures.set(key, null);
    return null;
  }

  ctx.fillStyle = `rgb(${GRAIN_BASE}, ${GRAIN_BASE}, ${GRAIN_BASE})`;
  ctx.fillRect(0, 0, GRAIN_PX, GRAIN_PX);

  // Every mark below is achromatic and hashed — see `grain.ts` for why both of
  // those are load-bearing rather than stylistic.
  const ink = (v: number, alpha: number): string => {
    const c = Math.max(0, Math.min(255, Math.round(GRAIN_BASE + v)));
    return `rgba(${c}, ${c}, ${c}, ${alpha})`;
  };

  if (spec.style === 'mottle') {
    // Soft blotches at two sizes: weathered stone, and the only style that
    // survives being seen from directly overhead as well as at the orbit floor.
    for (const [count, radius, weight] of [[14, 13, 1], [26, 6, 0.7]] as const) {
      for (let i = 0; i < count; i++) {
        const x = hashUnit(seed, i, 1) * GRAIN_PX;
        const y = hashUnit(seed, i, 2) * GRAIN_PX;
        const v = (hashUnit(seed, i, 3) - 0.5) * 2 * spec.speckle * weight;
        ctx.fillStyle = ink(v, 0.5);
        ctx.beginPath();
        ctx.arc(x, y, radius * (0.6 + hashUnit(seed, i, 4) * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (spec.style === 'brushed') {
    // Horizontal streaks: rolled or brushed plate. Directional, so it also tells
    // the eye which way a metal surface was worked.
    for (let i = 0; i < 34; i++) {
      const y = hashUnit(seed, i, 5) * GRAIN_PX;
      const v = (hashUnit(seed, i, 6) - 0.5) * 2 * spec.speckle;
      ctx.strokeStyle = ink(v, 0.42);
      ctx.lineWidth = 1 + hashUnit(seed, i, 7) * 2.5;
      ctx.beginPath();
      ctx.moveTo(hashUnit(seed, i, 8) * GRAIN_PX * 0.5, y);
      ctx.lineTo(GRAIN_PX, y + (hashUnit(seed, i, 9) - 0.5) * 3);
      ctx.stroke();
    }
  } else {
    // 'block' — cut stone. A darkened edge so a face reads as a placed slab
    // rather than a painted square, and almost nothing in the middle.
    ctx.strokeStyle = ink(-spec.speckle, 0.55);
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, GRAIN_PX - 3, GRAIN_PX - 3);
    for (let i = 0; i < 10; i++) {
      const v = (hashUnit(seed, i, 10) - 0.5) * spec.speckle;
      ctx.fillStyle = ink(v, 0.3);
      ctx.fillRect(hashUnit(seed, i, 11) * GRAIN_PX, hashUnit(seed, i, 12) * GRAIN_PX, 7, 7);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  grainTextures.set(key, texture);
  return texture;
}

/** The canvas a nameplate is rasterised at. World size is `renderer3d`'s. */
const PLATE_PX_W = PLATE_PX.w;
const PLATE_PX_H = PLATE_PX.h;

/**
 * STATUS-ICONS — a status glyph, rasterised once and reused.
 *
 * The vocabulary is path data in `status-pips.ts` so the HUD can draw the same
 * marks as `<svg>`; here it has to become a texture, which means a canvas. The
 * cache is keyed by everything that changes the pixels — kind, ink colour and
 * the stamped numeral — because a status row is rebuilt on every `show()` and
 * re-rasterising eleven glyphs per unit per frame would be a real cost for an
 * image that almost never changes.
 *
 * Module-level rather than per-renderer: the marks are identical in every
 * renderer instance, and the e2e opens several.
 */
const glyphTextures = new Map<string, CanvasTexture>();

/**
 * Texture resolution for one glyph.
 *
 * Raised with the on-screen size (STATUS-ICONS-SIZE): a bigger quad drawn from
 * the same 64px texture is a bigger *blurry* icon, which is the complaint with
 * extra steps.
 */
const GLYPH_PX = 128;

export function glyphTexture(pip: StatusPip): CanvasTexture | null {
  const ink = `#${pip.color.toString(16).padStart(6, '0')}`;
  const key = `${pip.kind}|${ink}|${pip.numeral ?? ''}`;
  const cached = glyphTextures.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = GLYPH_PX;
  canvas.height = GLYPH_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  // A dark plate behind the ink: these float over a lit board, and a bare
  // stroke on grass is unreadable at this size whatever colour it is.
  ctx.fillStyle = 'rgba(9, 10, 14, 0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, GLYPH_PX, GLYPH_PX, GLYPH_PX * 0.18);
  ctx.fill();

  // The glyph box is drawn inset, leaving room for the numeral to sit in the
  // corner without landing on top of the mark.
  const inset = GLYPH_PX * 0.11;
  const scale = (GLYPH_PX - inset * 2) / GLYPH_BOX;
  ctx.save();
  ctx.translate(inset, inset);
  ctx.scale(scale, scale);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = GLYPH_STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const part of statusGlyph(pip.kind)) {
    const path = new Path2D(part.d);
    if (part.fill === true) ctx.fill(path);
    else ctx.stroke(path);
  }
  ctx.restore();

  if (pip.numeral !== undefined) {
    // Bottom-right, white on the plate rather than in the status colour: the
    // number is a magnitude, not a second copy of the identity, and colouring
    // it too makes the whole tile read as one blob.
    const text = String(pip.numeral);
    ctx.font = `700 ${GLYPH_PX * 0.34}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = GLYPH_PX * 0.06;
    ctx.strokeStyle = 'rgba(9, 10, 14, 0.9)';
    ctx.strokeText(text, GLYPH_PX - 3, GLYPH_PX - 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, GLYPH_PX - 3, GLYPH_PX - 2);
  }

  const texture = new CanvasTexture(canvas);
  glyphTextures.set(key, texture);
  return texture;
}

/**
 * UI-NAMEPLATES — the plate, rasterised once per distinct content.
 *
 * Keyed on the content rather than the unit, so two units at full health share
 * one texture and a plate is redrawn only when a number in it actually changes.
 * That matters because `show()` runs on every pointer move during mouse-follow
 * aiming, and rasterising text at that rate would be the most expensive thing
 * the client does.
 *
 * The cache is cleared wholesale past a ceiling rather than evicted one entry at
 * a time. HP changes on every hit, so the key space is large but the *live* set
 * is tiny — a handful of units. A periodic wipe costs one redraw per visible
 * plate and needs no bookkeeping; an LRU would cost bookkeeping on every frame
 * to avoid a cost nobody can perceive.
 */
const plateTextures = new Map<string, CanvasTexture>();
const PLATE_CACHE_MAX = 240;

/** Bar colours, kept as the pre-UI-NAMEPLATES quads had them. */
const PLATE_INK = {
  track: '#12141a',
  hp: '#5ad17f',
  shield: '#62d0e0',
  energy: '#e0c04f',
  ult: '#ffd76a',
} as const;

/**
 * UI-INTENT — the small action tile above an allied unit.
 *
 * Its own cache, because the label space is tiny (a slot number and a couple of
 * marks) and shared across every unit that queued the same thing.
 */
const intentTextures = new Map<string, CanvasTexture>();

export function intentTexture(label: string, locked: boolean): CanvasTexture | null {
  const key = `${label}|${locked ? 'L' : ''}`;
  const cached = intentTextures.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 52;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  // Locked reads green, unlocked amber: "still deciding" and "committed" is the
  // distinction a teammate is actually watching for, and it should survive
  // being glanced at rather than read.
  ctx.fillStyle = locked ? 'rgba(24, 58, 38, 0.95)' : 'rgba(48, 40, 14, 0.95)';
  ctx.beginPath();
  ctx.roundRect(6, 4, 148, 44, 10);
  ctx.fill();
  ctx.strokeStyle = locked ? '#6fbf73' : '#e0c04f';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = locked ? '#b6f0c0' : '#f4e3a6';
  ctx.fillText(label, 80, 27);

  const texture = new CanvasTexture(canvas);
  intentTextures.set(key, texture);
  return texture;
}

/**
 * NAMEPLATE-LAYOUT — the status row, drawn onto the plate beside the name.
 *
 * Painted straight from the path vocabulary rather than through
 * `glyphTexture`: that cache exists so a *floating quad* can point at an image,
 * and there is no quad here — the icons are part of the plate's own raster,
 * which is already keyed and cached by content.
 *
 * **The ink is polarity, not identity** (ar-parity §4.8). Red says something is
 * being done to you and blue says something is protecting you, and that is the
 * bit worth carrying at this size; the glyph is still the sword, the eye, the
 * hourglass. `PIP_ORDER` puts debuffs first, so with the row growing rightward
 * the red icons land nearest the name — urgent first, which is why the order
 * survives the move unchanged.
 */
function drawStatusRow(
  ctx: CanvasRenderingContext2D,
  pips: readonly StatusPip[],
  layout: ReturnType<typeof plateLayout>,
): void {
  const scale = ICON_PX / GLYPH_BOX;
  layout.iconXs.forEach((x, i) => {
    const pip = pips[i];
    if (pip === undefined) return;
    const ink = `#${pip.tint.toString(16).padStart(6, '0')}`;

    // A dark backing, as the floating pips had: these sit over a lit board and
    // a bare stroke on grass is unreadable whatever colour it is.
    ctx.fillStyle = 'rgba(9, 10, 14, 0.62)';
    ctx.beginPath();
    ctx.roundRect(x, layout.iconY, ICON_PX, ICON_PX, ICON_PX * 0.22);
    ctx.fill();

    ctx.save();
    ctx.translate(x, layout.iconY);
    ctx.scale(scale, scale);
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = GLYPH_STROKE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const part of statusGlyph(pip.kind)) {
      const path = new Path2D(part.d);
      if (part.fill === true) ctx.fill(path);
      else ctx.stroke(path);
    }
    ctx.restore();

    if (pip.numeral === undefined) return;
    // Bottom-right, white rather than in the status colour: the number is a
    // magnitude, not a second copy of the polarity.
    ctx.font = `700 ${Math.round(ICON_PX * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(9, 10, 14, 0.9)';
    ctx.strokeText(String(pip.numeral), x + ICON_PX - 1, layout.iconY + ICON_PX);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(pip.numeral), x + ICON_PX - 1, layout.iconY + ICON_PX);
  });

  if (layout.overflow <= 0) return;
  // What did not fit is counted, not dropped: a row that quietly stopped would
  // be a plate claiming the unit is carrying less than it is.
  const last = layout.iconXs[layout.iconXs.length - 1];
  const x = last === undefined ? PLATE_PAD_PX : last + ICON_PX + ICON_GAP_PX;
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(9, 10, 14, 0.9)';
  ctx.strokeText(`+${layout.overflow}`, x, layout.iconY + ICON_PX / 2);
  ctx.fillStyle = '#d6dbe6';
  ctx.fillText(`+${layout.overflow}`, x, layout.iconY + ICON_PX / 2);
}

export function plateTexture(plate: Nameplate, team: 0 | 1): CanvasTexture | null {
  const key = nameplateKey(plate, team);
  const cached = plateTextures.get(key);
  if (cached !== undefined) return cached;
  if (plateTextures.size > PLATE_CACHE_MAX) {
    for (const t of plateTextures.values()) t.dispose();
    plateTextures.clear();
  }

  const canvas = document.createElement('canvas');
  canvas.width = PLATE_PX_W;
  canvas.height = PLATE_PX_H;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  const pad = PLATE_PAD_PX;
  const barW = PLATE_PX_W - pad * 2;

  // NAMEPLATE-LAYOUT: name hard left above the bar (it was centred), in the
  // team's colour so friend/foe reads before the name is even parsed — and the
  // status row on the same line, immediately to its right.
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const layout = plateLayout(ctx.measureText(plate.name).width, plate.pips.length);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(9, 10, 14, 0.92)';
  ctx.strokeText(plate.name, layout.nameX, 2);
  ctx.fillStyle = team === 0 ? '#9dc2ff' : '#ffb3aa';
  ctx.fillText(plate.name, layout.nameX, 2);
  drawStatusRow(ctx, plate.pips, layout);

  // HP bar, with the number inside it (the screenshot's defining detail).
  const barY = 38;
  const barH = 26;
  ctx.fillStyle = PLATE_INK.track;
  ctx.fillRect(pad, barY, barW, barH);
  const hpFrac = Math.max(0, Math.min(1, plate.hp / Math.max(1, plate.maxHp)));
  ctx.fillStyle = PLATE_INK.hp;
  ctx.fillRect(pad, barY, barW * hpFrac, barH);
  // Shields are spent first, so the segment is appended to the fill rather than
  // overlaid on it: the bar reads left-to-right as the order damage eats it.
  if (plate.shield > 0) {
    const shieldFrac = Math.min(1 - hpFrac, plate.shield / Math.max(1, plate.maxHp));
    ctx.fillStyle = PLATE_INK.shield;
    ctx.fillRect(pad + barW * hpFrac, barY, barW * shieldFrac, barH);
  }
  ctx.font = '700 19px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(9, 10, 14, 0.85)';
  const hpText = plate.shield > 0 ? `${plate.hp} +${plate.shield}` : String(plate.hp);
  ctx.strokeText(hpText, PLATE_PX_W / 2, barY + barH / 2 + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(hpText, PLATE_PX_W / 2, barY + barH / 2 + 1);

  // Energy: a thin bar under HP, and the ULT tag once it is charged. The tag is
  // the reason this bar is on screen at all — it turns an ultimate from a
  // surprise into a threat you can play around.
  const energyY = barY + barH + 4;
  const energyH = 9;
  const tagW = plate.ult ? 40 : 0;
  ctx.fillStyle = PLATE_INK.track;
  ctx.fillRect(pad, energyY, barW - tagW, energyH);
  ctx.fillStyle = PLATE_INK.energy;
  ctx.fillRect(pad, energyY, (barW - tagW) * Math.max(0, Math.min(1, plate.energy / ULT_COST)), energyH);
  if (plate.ult) {
    ctx.fillStyle = PLATE_INK.ult;
    ctx.fillRect(PLATE_PX_W - pad - tagW + 3, energyY - 4, tagW - 3, energyH + 8);
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1a1408';
    ctx.fillText('ULT', PLATE_PX_W - pad - tagW / 2 + 2, energyY + energyH / 2);
  }

  const texture = new CanvasTexture(canvas);
  plateTextures.set(key, texture);
  return texture;
}

