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

import { CanvasTexture } from 'three';
import { ULT_COST } from '@cards/engine';
import {
  GLYPH_BOX, GLYPH_STROKE, statusGlyph, type StatusPip,
} from './status-pips.js';
import { nameplateKey, type Nameplate } from './nameplates.js';

/** The canvas a nameplate is rasterised at. World size is `renderer3d`'s. */
const PLATE_PX_W = 272;
const PLATE_PX_H = 106;

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

  const pad = 8;
  const barW = PLATE_PX_W - pad * 2;

  // Name, above the bar, in the team's colour so friend/foe reads before the
  // name is even parsed.
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(9, 10, 14, 0.92)';
  ctx.strokeText(plate.name, PLATE_PX_W / 2, 2);
  ctx.fillStyle = team === 0 ? '#9dc2ff' : '#ffb3aa';
  ctx.fillText(plate.name, PLATE_PX_W / 2, 2);

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

