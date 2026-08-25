/**
 * FOF-COLORS — friend or foe, decided from the **viewer's** seat.
 *
 * The bug this exists to kill: the client coloured units by *absolute team*
 * (`unit.owner === 0 ? blue : red`), so a player seated on team 1 saw
 * **themselves in red and the enemy in blue**. On a mirror matchup — both teams
 * running the same character — that is not a cosmetic complaint, it is the
 * player losing track of which identical model is theirs.
 *
 * The ruling (edge-cases, FOF-COLORS) is that the answer to "friend or foe"
 * must never depend on which team *number* you happened to draw. So there is
 * exactly one resolver, it takes the viewer, and every colour decision about a
 * unit routes through it.
 *
 * **Three colours, not two**, and the third is the reason this is a module
 * rather than a ternary:
 *
 * | | who | colour |
 * |---|---|---|
 * | `self` | a unit the viewer's **seat** controls | blue |
 * | `ally` | another unit on the viewer's **team** | green |
 * | `foe` | the enemy team | red |
 *
 * `self` is *seat*-relative while `ally` is *team*-relative, and the two come
 * apart in every format this game supports: 2v2 with one player per character
 * means your teammate's unit is an ally, and 2v2 with one player driving both
 * means both are self. Collapsing them into "my team" would be right today in
 * hot-seat and wrong the moment two humans share a side.
 *
 * **Pure view, and it must stay that way.** Nothing here reads or writes game
 * state, so two clients on opposite teams resolve the *same* board to mirrored
 * colours without either being wrong — the same property that lets fog be
 * viewer-relative without either client being out of sync. No `three` import,
 * for the same reason `camera-pan.ts` has none: this is the part that has to be
 * right, and checking it should not need a WebGL context.
 */

import type { TeamId } from '@cards/engine';

/** Which of the three identities a unit wears, from one viewer's seat. */
export type Fof = 'self' | 'ally' | 'foe';

/**
 * Who is looking.
 *
 * Both fields, not just the team: `self` is the viewer's **seat**, and a seat is
 * a subset of a team. See the note above on why collapsing them breaks 2v2.
 */
export interface Viewer {
  /** The team whose eyes the board is being drawn for. */
  team: TeamId;
  /** The unit ids this viewer's own seat controls. */
  seatUnitIds: ReadonlySet<string>;
}

/** The minimum a thing needs for its allegiance to be decidable. */
export interface FofSubject {
  unitId: string;
  owner: TeamId;
}

/** The three identity hues, so the resolver never hard-codes one. */
export interface FofPalette {
  self: number;
  ally: number;
  foe: number;
}

/**
 * The one resolver. Every unit colour in the client comes from here.
 *
 * Order matters: seat before team. A unit the viewer drives is `self` even
 * though it is also on their team, and checking team first would paint the
 * player's own character in the ally colour.
 */
export function fofFor(subject: FofSubject, viewer: Viewer): Fof {
  if (subject.owner !== viewer.team) return 'foe';
  return viewer.seatUnitIds.has(subject.unitId) ? 'self' : 'ally';
}

/** `true` for anything on the viewer's own side — `self` or `ally`. */
export const friendly = (fof: Fof): boolean => fof !== 'foe';

/**
 * The allegiance of a whole **side** rather than of a unit.
 *
 * The map's end bars, a spawn edge, a score column: things that belong to a
 * team as a team. There is no `self`/`ally` split to make — half the arena is
 * not "the unit you are driving" — so a side is friendly or it is not, and the
 * owner's note asks for exactly two colours here: *"blue for ally and red for
 * enemy side."*
 */
export const sideFriendly = (team: TeamId, viewer: Viewer): boolean => team === viewer.team;

/**
 * A `Fof` to a colour.
 *
 * Split from `fofFor` so the *decision* can be tested without a palette and the
 * palette can change without touching the decision.
 */
export function fofColour(fof: Fof, palette: FofPalette): number {
  return fof === 'self' ? palette.self : fof === 'ally' ? palette.ally : palette.foe;
}

/** A unit straight to its colour — the common case, in one call. */
export function unitColour(subject: FofSubject, viewer: Viewer, palette: FofPalette): number {
  return fofColour(fofFor(subject, viewer), palette);
}

/**
 * A **side's** colour: the viewer's own end blue, the enemy's red.
 *
 * `self` rather than `ally` for the friendly side on purpose — see
 * `sideFriendly`. Green is the "not you, but with you" colour and an entire half
 * of the arena is neither.
 */
export function sideColour(team: TeamId, viewer: Viewer, palette: FofPalette): number {
  return sideFriendly(team, viewer) ? palette.self : palette.foe;
}
