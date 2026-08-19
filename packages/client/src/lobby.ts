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

import { CATALYST_PHASES, ULT_COST, type AbilityPhase, type CharacterDef } from '@cards/engine';
import { damageTell } from './targeting.js';
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
  /**
   * NET-PRESENCE-UI — whether a socket is attached to this seat.
   *
   * Read straight off `RoomView.seats`, which has carried it since
   * M3-RECONNECT and which nothing drew. A seat whose player dropped is **held**
   * for them, so it stays in the list; without this it stayed in the list
   * looking exactly like somebody who was still there and simply slow to pick.
   */
  connected: boolean;
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
      connected: s.connected,
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
export function enemyProgress(net: NetState): EnemyProgress {
  const of = net.lobby?.enemyOf ?? 0;
  return { ready: net.lobby?.enemyReady ?? 0, of, present: enemyPresent(net, of) };
}

export interface EnemyProgress {
  /** How many of them have finished picking. */
  ready: number;
  /** How many seats they have. */
  of: number;
  /**
   * NET-PRESENCE-ENEMY — how many of those seats have a socket attached.
   *
   * A **count and nothing else**, exactly like `ready`: the ruled shape for
   * anything crossing the team line (M3-LOCKLIST, BLIND-PICK). Which of them
   * dropped is a durable handle on one specific opponent and stays out; how many
   * of them are there is the same kind of coarse status the lock count already
   * is, and a lobby that hid it would leave you waiting on somebody who has gone.
   */
  present: number;
}

/**
 * Count the other side's live seats off `RoomView`, which has carried
 * `connected` since M3-RECONNECT.
 *
 * Falls back to "all of them" whenever this client cannot tell — before it has a
 * seat of its own, or before the room has arrived. The safe direction is
 * silence: claiming somebody is missing when you do not know is worse than not
 * mentioning presence at all, because the UI only speaks up on an absence.
 */
function enemyPresent(net: NetState, of: number): number {
  if (net.room === undefined || net.seat === undefined) return of;
  const mine = net.seat.team;
  return net.room.seats.filter((s) => s.team !== mine && s.connected).length;
}

/**
 * Whether the start button is live — the server's own gate, forwarded.
 *
 * Not recomputed from the rows above, and that is the point: this client cannot
 * see the enemy's picks, so it is structurally incapable of deciding whether the
 * *room* is ready. Only the server can, and it says so in one boolean — which
 * since LOBBY-READY also carries the handshake.
 */
export function canStart(net: NetState): boolean {
  return net.lobby?.canStart === true;
}

/**
 * LOBBY-READY — is this seat the room's creator, and so the one holding Start?
 *
 * The server names the creator rather than the client assuming "seat 0 is the
 * first row I was sent": a reconnecting client sees the room in whatever order
 * the server lists it, and guessing would put the button under the wrong player
 * exactly when somebody has just dropped.
 */
export function isCreator(net: NetState): boolean {
  const creator = net.lobby?.creator;
  return creator !== undefined && creator === net.seat?.seatId;
}

/** LOBBY-READY — has this seat said it is happy to start? */
export function isReady(net: NetState): boolean {
  return net.seat !== undefined && (net.lobby?.readied ?? []).includes(net.seat.seatId);
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

// ── LOBBY-DETAIL-PANEL ──────────────────────────────────────────────────────

/**
 * One skill as the lobby's side panel lists it.
 *
 * Name, what it costs you to read (phase and the numeric tell), and the
 * Designer's own sentence. Nothing is composed here that is not already in
 * `data/` — the panel is a *reading* of the character file, which is why a
 * balance edit shows up in it with no client change.
 */
export interface DetailSkill {
  id: string;
  name: string;
  /** The ultimate, which is worth marking: it is the one with a price. */
  isUlt: boolean;
  phase: AbilityPhase;
  /** `damageTell` — the numbers, and where they differ. Empty for pure utility. */
  tell: string;
  description: string;
}

/**
 * LOBBY-DETAIL-PANEL — everything a character is, for the panel on the left.
 *
 * Owner Dev Note: *"When selecting a character in the lobby, the mouseover is
 * going great, but it should also expand into a bigger window on the side that
 * shows a description of all the skills. There is space on the left."*
 *
 * LOBBY-INSPECT's hover tooltip answers "what is this" in a glance and vanishes;
 * this answers "what would I be playing" and stays. Same source — the character
 * file — so the two can never disagree about a kit; the difference is that the
 * hover shows the *slots* and this shows the *sentences*.
 *
 * **Every** ability plus the ultimate, in the file's own order. A panel that
 * showed four of five would be worse than none, because it would look complete.
 */
export interface CharacterDetail {
  id: string;
  name: string;
  archetype: string;
  maxHp: number;
  /** What an ultimate costs, so the last row's price is on screen beside it. */
  ultCost: number;
  skills: DetailSkill[];
}

export function characterDetail(character: CharacterDef): CharacterDetail {
  const row = (def: CharacterDef['ultimate'], isUlt: boolean): DetailSkill => ({
    id: def.id,
    name: def.name,
    isUlt,
    phase: def.phase,
    tell: damageTell(def),
    description: def.description,
  });
  return {
    id: character.id,
    name: character.name,
    archetype: character.archetype,
    maxHp: character.maxHp,
    ultCost: ULT_COST,
    skills: [
      ...character.abilities.map((def) => row(def, false)),
      row(character.ultimate, true),
    ],
  };
}
