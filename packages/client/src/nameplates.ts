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

/** What the client remembers about a decoy from the moment it was cast. */
export interface DecoySnapshot {
  name: string;
  hp: number;
  maxHp: number;
  energy: number;
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
    hp: caster.hp,
    maxHp: caster.maxHp,
    energy: caster.energy,
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
