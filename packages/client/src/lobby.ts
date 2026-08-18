/**
 * The lobby's **view-model** — pure, so the pick screen has nothing to test.
 *
 * The screen next door is a list of buttons. Everything that could be *wrong*
 * lives here: what this seat still owes, which characters its team has already
 * taken, whether a triad is complete, and whether what the player has assembled
 * is something the server will accept.
 *
 * **It renders what the protocol sends and re-derives nothing.** `LobbyView`
 * already carries own-team picks, the owed counts and the enemy's finished-seat
 * count; the R3 check, the coverage check and `lobbyReady` all live in
 * `room.ts` and are answered by the server. Recomputing any of that here would
 * be a second rulebook to keep in step with the first, and the half that
 * matters — the enemy's picks — is not on this client at all (BLIND-PICK), so
 * the client *could not* recompute R3 across a mirror even if it wanted to.
 *
 * The one thing this file does own is the **draft**: what the player has
 * clicked but not sent. A draft is deliberately allowed to be incomplete and
 * even illegal — a lobby where you cannot select a character until the whole
 * loadout is valid is a lobby nobody can use. `draftPicks` is the gate, and it
 * returns `undefined` until the draft is a thing worth sending.
 */

import { CATALYST_PHASES, type AbilityPhase, type CharacterDef } from '@cards/engine';
import type { LobbyView, NetState, Pick } from './net.js';

/** One character slot in the local player's draft, before it is sent. */
export interface DraftSlot {
  characterId?: string;
  /** Chosen catalyst per phase. A hole means "not chosen yet", which is legal. */
  catalysts: Partial<Record<AbilityPhase, string>>;
}

/** What this player has clicked so far. Sized by what the seat owes. */
export interface Draft {
  slots: DraftSlot[];
}

/**
 * An empty draft of `owed` slots.
 *
 * Sized rather than open-ended because the count is a *rule* (`charactersPerSeat`,
 * the server's), and a screen that let you pick a third character in a 4-player
 * 2v2 would be offering something the server refuses with `wrongCount`.
 */
export function emptyDraft(owed: number): Draft {
  return { slots: Array.from({ length: Math.max(0, owed) }, () => ({ catalysts: {} })) };
}

/**
 * Re-size a draft when the seat's owed count moves under it.
 *
 * It does move: a join or a leave re-prices the whole team (a 4-player 2v2 owes
 * one each; lose a player and the survivor owes two). Existing slots are kept in
 * order, so a player who had already chosen does not lose the choice because
 * somebody else walked in.
 */
export function resizeDraft(draft: Draft, owed: number): Draft {
  const target = Math.max(0, owed);
  if (draft.slots.length === target) return draft;
  const slots = draft.slots.slice(0, target);
  while (slots.length < target) slots.push({ catalysts: {} });
  return { slots };
}

/** Put `characterId` in slot `index`. Choosing the same one again clears it. */
export function chooseCharacter(draft: Draft, index: number, characterId: string): Draft {
  if (index < 0 || index >= draft.slots.length) return draft;
  const slot = draft.slots[index]!;
  const next: DraftSlot = slot.characterId === characterId
    ? { ...slot, characterId: undefined }
    : { ...slot, characterId };
  return { slots: draft.slots.map((s, i) => (i === index ? next : s)) };
}

/**
 * Put `catalystId` in slot `index`'s `phase` slot. Re-clicking clears it.
 *
 * One per phase is the engine's rule (CAT1) and the shape enforces it: a triad
 * is a map keyed by phase, so a second Dash pick *replaces* rather than adding a
 * fourth catalyst the server would reject.
 */
export function chooseCatalyst(draft: Draft, index: number, phase: AbilityPhase, catalystId: string): Draft {
  if (index < 0 || index >= draft.slots.length) return draft;
  const slot = draft.slots[index]!;
  const catalysts = { ...slot.catalysts };
  if (catalysts[phase] === catalystId) delete catalysts[phase];
  else catalysts[phase] = catalystId;
  return { slots: draft.slots.map((s, i) => (i === index ? { ...s, catalysts } : s)) };
}

/**
 * The draft as `Pick[]`, or `undefined` if it is not ready to send.
 *
 * Ready means **every slot has a character** — that is the count rule, and a
 * short list is refused as `wrongCount`. A *triad* may be incomplete: an
 * unchosen catalyst is a legal pick (the engine falls back to
 * `DEFAULT_CATALYSTS`), so a partial loadout is sent as no loadout rather than
 * as two-thirds of one, which the server would reject for having the wrong
 * number of catalysts.
 */
export function draftPicks(draft: Draft): Pick[] | undefined {
  if (draft.slots.length === 0) return undefined;
  const picks: Pick[] = [];
  for (const slot of draft.slots) {
    if (slot.characterId === undefined) return undefined;
    const triad = CATALYST_PHASES.map((p) => slot.catalysts[p]).filter((id): id is string => id !== undefined);
    picks.push(triad.length === CATALYST_PHASES.length
      ? { characterId: slot.characterId, catalysts: triad }
      : { characterId: slot.characterId });
  }
  return picks;
}

/**
 * Character ids this team has already claimed, **as the server reported them**,
 * minus this seat's own draft.
 *
 * Used to grey out a teammate's pick before the player clicks it and eats a
 * `duplicateCharacter` refusal (R3 is a team-wide rule). Taken from
 * `lobby.picks`, which is the server's own record of what has been *accepted* —
 * not from a local tally, which would drift the moment a pick was refused.
 *
 * The enemy's picks are **not** in it and must never be: they are not on this
 * client (BLIND-PICK), and a mirror across teams is legal anyway.
 */
export function takenByTeam(net: NetState): Set<string> {
  const taken = new Set<string>();
  const lobby = net.lobby;
  if (lobby === undefined) return taken;
  for (const [seatId, picks] of Object.entries(lobby.picks)) {
    if (seatId === net.seat?.seatId) continue; // our own accepted picks are ours to change
    for (const p of picks) taken.add(p.characterId);
  }
  return taken;
}

/** One character as the pick screen shows it. */
export interface CharacterOption {
  id: string;
  name: string;
  archetype: string;
  /** Claimed by a teammate — R3 refuses it, so the screen says so first. */
  taken: boolean;
  /** Chosen in the slot currently being filled. */
  chosen: boolean;
}

/** The roster, annotated for the slot being filled. Order follows the catalogue. */
export function characterOptions(
  catalog: readonly CharacterDef[],
  net: NetState,
  draft: Draft,
  index: number,
): CharacterOption[] {
  const taken = takenByTeam(net);
  // A character already in another of *this* seat's slots is taken too: R3 is
  // per team, and one seat's two picks are two of that team's characters.
  for (const [i, slot] of draft.slots.entries()) {
    if (i !== index && slot.characterId !== undefined) taken.add(slot.characterId);
  }
  const chosen = draft.slots[index]?.characterId;
  return catalog.map((c) => ({
    id: c.id,
    name: c.name,
    archetype: c.archetype,
    taken: taken.has(c.id),
    chosen: c.id === chosen,
  }));
}

/** One own-team seat, as the lobby lists it. */
export interface SeatRow {
  seatId: string;
  name: string;
  /** Yours — the row the pick controls belong to. */
  isMine: boolean;
  owed: number;
  /** Character *names*, resolved through the catalogue; empty until picked. */
  picked: string[];
  ready: boolean;
}

/**
 * This team's seats, in the room's order. The enemy is not here by design —
 * see {@link enemyProgress}.
 */
export function seatRows(net: NetState, catalog: readonly CharacterDef[]): SeatRow[] {
  const lobby = net.lobby;
  if (lobby === undefined || net.room === undefined || net.seat === undefined) return [];
  const nameOf = new Map(catalog.map((c) => [c.id, c.name]));
  return net.room.seats
    .filter((s) => s.team === net.seat!.team)
    .map((s) => ({
      seatId: s.seatId,
      name: s.name,
      isMine: s.seatId === net.seat!.seatId,
      owed: lobby.owed[s.seatId] ?? 0,
      picked: (lobby.picks[s.seatId] ?? []).map((p) => nameOf.get(p.characterId) ?? p.characterId),
      ready: lobby.ready.includes(s.seatId),
    }));
}

/**
 * Everything this client may know about the other side: **how many of them have
 * finished**, and nothing else (BLIND-PICK).
 *
 * A separate function from `seatRows` on purpose. The shapes are different
 * because the *rules* are different, and a single "all seats" list would be one
 * careless `.map` away from rendering an enemy pick that the payload does not
 * even contain.
 */
export function enemyProgress(net: NetState): { ready: number; of: number } {
  return { ready: net.lobby?.enemyReady ?? 0, of: net.lobby?.enemyOf ?? 0 };
}

/**
 * Whether the start button is live — the server's own `lobbyReady`, forwarded.
 *
 * Not recomputed from the rows above, and that is the point: this client cannot
 * see the enemy's picks, so it is structurally incapable of deciding whether the
 * *room* is ready. Only the server can, and it says so in one boolean.
 */
export function canStart(net: NetState): boolean {
  return net.lobby?.canStart === true;
}

/** What the lobby says it is waiting for, in one line. */
export function lobbyStatus(net: NetState): string {
  if (net.phase === 'closed') return 'Disconnected.';
  if (net.room === undefined) return 'Connecting…';
  const lobby: LobbyView | undefined = net.lobby;
  if (lobby === undefined) return `Room ${net.room.code} — joining…`;
  const mine = Object.keys(lobby.owed).length;
  const enemy = enemyProgress(net);
  if (canStart(net)) return `Room ${net.room.code} — everybody has picked. Start when ready.`;
  return `Room ${net.room.code} — your team ${lobby.ready.length}/${mine}, `
    + `the other side ${enemy.ready}/${enemy.of}.`;
}
