/**
 * Glyphs the HUD and the inspect panel both stamp on an ultimate.
 *
 * Its own file because `inspect-panel.ts` needs it and `hud.ts` imports *that*
 * — one shared mark rather than two stars that could quietly stop matching.
 */

/** The star on an ultimate's name, in the hotbar and in the inspect panel. */
export const ULT_MARK = '★';
