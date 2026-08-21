/**
 * Match formats: characters per team, kill target, and turn limit.
 *
 * The engine models **two teams of N units** and is blind to how many humans
 * are playing (GAME_SPEC §1, ARCHITECTURE "Teams vs. players"). A format fixes
 * the team size and the win thresholds; the room layer maps players to
 * characters. Values are integers and Designer-tunable (GAME_SPEC §1 tables);
 * kill target and turn limit are **per-format**, not global constants.
 */

export type FormatId = '2v2' | '4v4' | '1v1';

export interface Format {
  id: FormatId;
  /** Units per team at match start. */
  charactersPerTeam: number;
  /** Team kills needed to win outright. */
  killsToWin: number;
  /** After this turn, the kill-leading team wins (tie → sudden death). */
  turnLimit: number;
}

/** The supported formats (GAME_SPEC §1). 2v2 is the default; 1v1 is dev/testing. */
export const FORMATS: Readonly<Record<FormatId, Format>> = {
  '2v2': { id: '2v2', charactersPerTeam: 2, killsToWin: 4, turnLimit: 20 },
  '4v4': { id: '4v4', charactersPerTeam: 4, killsToWin: 5, turnLimit: 20 },
  '1v1': { id: '1v1', charactersPerTeam: 1, killsToWin: 3, turnLimit: 12 },
};

/** The default match format (GAME_SPEC §1). */
export const DEFAULT_FORMAT: FormatId = '2v2';

/** Resolve a format by id, falling back to the default for an unknown id. */
export function getFormat(id: FormatId | undefined): Format {
  return FORMATS[id ?? DEFAULT_FORMAT] ?? FORMATS[DEFAULT_FORMAT];
}
