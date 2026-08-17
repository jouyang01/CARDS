/**
 * UI-NAMEPLATES (ar-parity §4.1) — what floats above a unit's head.
 *
 * The owner's AR screenshot is the spec: a name, an HP bar with **the number
 * inside it**, a shield segment appended to the fill, a thin energy bar under
 * that, and an "ULT" tag once the ultimate is charged. The last one is the
 * load-bearing part — in the screenshot both enemy nameplates carry it, and
 * that is precisely what turns an ultimate from a surprise into a threat you
 * can play around.
 *
 * This module is the **model**, not the drawing: it decides what a nameplate
 * says, and `renderer3d` decides how to paint it. That split is the same one
 * `status-pips.ts` makes and for the same reason — the questions worth testing
 * ("does a fogged enemy get a nameplate?", "does a decoy's lie hold?") have
 * nothing to do with WebGL, and a WebGL context is not available to the unit
 * suite.
 *
 * **Vision is not re-derived here.** The caller hands in the units it is already
 * drawing, which came from `fogView` — so a nameplate exists exactly when the
 * board decided the unit does. Deriving visibility a second time would be a
 * second chance to be a better scout than the vision rules allow, which is the
 * one thing the UI batch must never become.
 */

import { ULT_COST, type EffectKind, type Roster, type TeamId, type UnitState } from '@cards/engine';
import { statusPips, viewableStatuses, type StatusPip } from './status-pips.js';

/** Everything drawn above one unit. */
export interface Nameplate {
  /** Character name until M3 gives us player names (ar-parity §4.1). */
  name: string;
  hp: number;
  maxHp: number;
  /** Absorption remaining, drawn as its own segment after the HP fill. */
  shield: number;
  energy: number;
  /** `energy >= ULT_COST` — the engine's threshold, never a literal here. */
  ult: boolean;
  /** The STATUS-ICONS row, already gated and ordered. */
  pips: readonly StatusPip[];
}

/** True once the ultimate is affordable. The engine owns the number. */
export const ultReady = (energy: number): boolean => energy >= ULT_COST;

/**
 * The nameplate for a real unit, as `viewer` may see it.
 *
 * The status row runs through the same `viewableStatuses` gate the floating
 * icons use, so Stealth's mask does not arrive here by a side door.
 */
export function unitNameplate(unit: UnitState, roster: Roster, viewer: TeamId): Nameplate {
  const live = unit.statuses.filter((s) => s.remaining > 0);
  return {
    name: roster[unit.characterId]?.name ?? unit.characterId,
    hp: unit.hp,
    maxHp: unit.maxHp,
    shield: live.filter((s) => s.kind === 'shield').reduce((sum, s) => sum + (s.amount ?? 0), 0),
    energy: unit.energy,
    ult: ultReady(unit.energy),
    pips: statusPips(viewableStatuses(live, unit.owner === viewer)),
  };
}

/**
 * A decoy's **fake** nameplate, frozen at the cast (edge-cases: the decoy
 * snapshot carries the nameplate fields).
 *
 * A Wisp-shaped model with no nameplate, on a board where every other unit has
 * one, is un-disguised the instant a player looks at it — the absence is the
 * tell, exactly as the missing preview number was for PREVIEW-DECOY. So the
 * decoy gets the full plate.
 *
 * The status row is **empty rather than copied**: showing Wisp's real buffs
 * would leak them, and showing plausible fake ones would be the client
 * inventing game state. Empty is both honest and unremarkable — most units are
 * carrying nothing most of the time.
 *
 * Energy is likewise frozen and never ULT-tagged: a decoy that lit up "ULT" on
 * the turn the real Wisp charged would be reporting live data.
 */
export function decoyNameplate(snapshot: DecoySnapshot): Nameplate {
  return {
    name: snapshot.name,
    hp: snapshot.hp,
    maxHp: snapshot.maxHp,
    shield: 0,
    energy: snapshot.energy,
    ult: ultReady(snapshot.energy),
    pips: [],
  };
}

/**
 * What the client remembers about a decoy from the moment it was cast.
 *
 * Enough for the nameplate **and** the inspect panel (UI-INSPECT), because the
 * two lies have to agree: a plate saying 60 HP over a panel saying 80 outs the
 * decoy more thoroughly than having neither would. So the snapshot is the whole
 * cast-time reading, taken once.
 */
export interface DecoySnapshot {
  name: string;
  /** The impersonated character, so the panel can show its kit. */
  characterId: string;
  hp: number;
  maxHp: number;
  energy: number;
  /** Cooldowns frozen at the cast — never the real caster's live numbers. */
  cooldowns: Record<string, number>;
  catalysts: string[];
  catalystsUsed: string[];
}

/**
 * The unit a decoy on `team` is impersonating: the one whose kit can cast one.
 *
 * Found from **data**, not from a hardcoded "Wisp" — a second decoy character
 * would otherwise silently wear the first one's name. Ties break on the unit
 * list's own order, which is the engine's stable order, so two decoy-casters on
 * one team still give the same answer on every machine.
 *
 * Returns undefined when the caster is already dead and gone from the state; the
 * caller falls back to whatever it recorded at cast time, which is the whole
 * reason a snapshot exists.
 */
export function decoyCaster(units: readonly UnitState[], roster: Roster, team: TeamId): UnitState | undefined {
  return units.find((u) => {
    if (u.owner !== team) return false;
    const character = roster[u.characterId];
    if (character === undefined) return false;
    return [...character.abilities, character.ultimate]
      .some((a) => a.effects.some((e) => (e.kind as EffectKind) === 'decoy'));
  });
}

/**
 * Snapshot the impersonated unit as it stands **now** — called when a
 * `decoySpawned` event plays, which is the cast.
 *
 * Undefined when nobody on that team can cast a decoy, which should not happen
 * and is not worth throwing over: a decoy with no plate is a rendering gap, not
 * a reason to take the page down.
 */
export function snapshotDecoy(
  units: readonly UnitState[],
  roster: Roster,
  team: TeamId,
): DecoySnapshot | undefined {
  const caster = decoyCaster(units, roster, team);
  if (caster === undefined) return undefined;
  return {
    name: roster[caster.characterId]?.name ?? caster.characterId,
    characterId: caster.characterId,
    hp: caster.hp,
    maxHp: caster.maxHp,
    energy: caster.energy,
    cooldowns: { ...caster.cooldowns },
    catalysts: [...caster.catalysts],
    catalystsUsed: [...caster.catalystsUsed],
  };
}

/**
 * A cache key covering everything that changes a nameplate's pixels.
 *
 * The renderer rasterises a plate to a texture, and a plate is rebuilt on every
 * `show()` — which mouse-follow aiming calls on every pointer move. Keying on
 * the *content* means the texture is drawn once per distinct plate rather than
 * once per frame, and the numbers in it are exactly the things that change
 * rarely.
 */
export function nameplateKey(plate: Nameplate, team: TeamId): string {
  const pips = plate.pips.map((p) => `${p.kind}${p.numeral ?? ''}`).join(',');
  return [
    team, plate.name, plate.hp, plate.maxHp, plate.shield,
    plate.energy, plate.ult ? 'U' : '', pips,
  ].join('|');
}

// ── NAMEPLATE-LAYOUT: where things sit on the plate ─────────────────────────

/**
 * The plate's raster, in pixels. World size is `renderer3d`'s `PLATE_W/H`, and
 * the two are in a fixed ratio — 160 px per world unit — which is what lets the
 * icon sizing below be checked against STATUS-ICONS-SIZE's world-space floor
 * without a WebGL context in the room.
 */
export const PLATE_PX = { w: 272, h: 106 } as const;
/** Pixels per world unit, i.e. `PLATE_PX.w / renderer3d's PLATE_W`. */
export const PLATE_PX_PER_UNIT = 160;

/**
 * Icon geometry on the plate.
 *
 * `30` is not a taste call: STATUS-ICONS-SIZE raised the floating pips to 0.18
 * world units because a *drawing* you cannot resolve is worse than a colour you
 * can, and moving the row onto the plate must not quietly give that back. At
 * 160 px per world unit, 30 px is 0.1875 — the same read or slightly better,
 * which is the whole reason that item folds into this repaint instead of
 * shipping twice.
 */
export const ICON_PX = 30;
export const ICON_GAP_PX = 4;
/** The gap between the end of the name and the first icon. */
export const NAME_GAP_PX = 10;
/** The plate's left/right margin, shared with the bars below. */
export const PLATE_PAD_PX = 8;

/** Where one plate's name and status row sit, in canvas pixels. */
export interface PlateLayout {
  /** Left edge of the name — NAMEPLATE-LAYOUT justifies it, so this is the pad. */
  nameX: number;
  /** Left edge of each icon that fits, in `PIP_ORDER` (debuffs first). */
  iconXs: number[];
  /** Top edge of the icon row, so icons and name share a line. */
  iconY: number;
  /** How many icons did not fit. Drawn as a `+N` rather than dropped silently. */
  overflow: number;
}

/**
 * Lay out the name line: name hard left, status icons immediately to its right.
 *
 * Pure arithmetic over a measured name width, so the arrangement the owner
 * asked for is testable without a canvas — the same reason `status-pips.ts`
 * holds the vocabulary rather than the renderer.
 *
 * **Truncation is reported, not hidden.** Eleven icons cannot fit beside a name
 * on a plate this wide, and a row that silently stopped at four would be a plate
 * claiming a unit is carrying less than it is. `PIP_ORDER` puts debuffs first,
 * so what survives the cut is what is being done *to* you — the urgent read —
 * and the count of what did not follows it.
 */
export function plateLayout(nameWidthPx: number, pipCount: number): PlateLayout {
  const iconY = 1;
  const start = PLATE_PAD_PX + nameWidthPx + NAME_GAP_PX;
  const pitch = ICON_PX + ICON_GAP_PX;
  // The `+N` marker only earns its width when something is actually cut, so the
  // room for it is reserved on the second pass rather than always.
  const roomFor = (reserve: number): number => Math.max(
    0,
    Math.floor((PLATE_PX.w - PLATE_PAD_PX - reserve - start + ICON_GAP_PX) / pitch),
  );
  const OVERFLOW_PX = 26;
  let shown = Math.min(pipCount, roomFor(0));
  if (shown < pipCount) shown = Math.min(pipCount, roomFor(OVERFLOW_PX));
  return {
    nameX: PLATE_PAD_PX,
    iconXs: Array.from({ length: shown }, (_, i) => start + i * pitch),
    iconY,
    overflow: pipCount - shown,
  };
}
