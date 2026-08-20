/**
 * Hot-seat controller: the interactive shell that drives the tested pure modules
 * — `targeting` (build a UnitOrders), `hotseat` (seats + per-team merge),
 * `turn-player` (fold the TurnEvent log), `choreograph` (the cue timeline) — and
 * paints the result through the orthographic renderer (RND1).
 *
 * All game logic lives in the engine; this file only wires pointer input to
 * those modules and shows what they return. One player orders at a time; when
 * every seat has locked in, the turn resolves and plays back phase by phase.
 */

import {
  ULT_COST,
  buildBoard,
  type Board,
  createMatch,
  movementBudget,
  resolveTurn,
  type AbilityDef,
  type CharacterDef,
  type FormatId,
  type GameState,
  type MapDef,
  type Phase,
  type CatalystPool,
  type Roster,
  type TeamId,
  type TurnEvent,
  type UnitOrders,
  type UnitState,
  type Vec2,
} from '@cards/engine';
import { createRenderer, type HighlightLayer, type ProjectionName, type RenderDecoy, type RenderTrap, type RenderUnit, type Renderer, type ShapeLayer } from './renderer3d.js';
import { createTurnPlayer } from './turn-player.js';
import { MS_PER_BEAT, focusSquares, phaseWindow, sampleFrame, type Frame, type Readout } from './animate.js';
import { type Cue } from './choreograph.js';
import {
  IDLE,
  afterCommit,
  arm,
  hoverAbility,
  hoverBoard,
  hoverMove,
  previewAim,
  previewCatalystAim,
  previewFreeAim,
  previewMovePath,
  impactLayer,
  refusedAim,
  waypointClick,
  type Interaction,
} from './order-mode.js';
import {
  abilityOptions,
  abilityPreview,
  previewBandSets,
  rotationOptions,
  impactPreview,
  abilityTooltip,
  aimFor,
  abilitiesAllowed,
  catalystCost,
  commitAim,
  dashRoute,
  draftAbility,
  modeOptions,
  draftFreeAbility,
  isFreeAbility,
  draftHasOrder,
  emptyDraft,
  moveEnvelope,
  nextDraft,
  appendWaypointRouted,
  liveWaypointMarks,
  pathTo,
  remainingMove,
  rangeEnvelope,
  chaseSprints,
  sprintAllowed,
  toUnitOrders,
  type OrderDraft,
} from './targeting.js';
import { createCombatLog, type CombatLog, type LogNames } from './combat-log.js';
import { downedLabel } from './waiting.js';
import { createHud, type Hud, type HudCharacter, type HudModel } from './hud.js';
import { deriveSeats, mergeSeatOrders, type Seat } from '@cards/engine';
import {
  camoTiles, fogView, planningState, rememberSightings, revealedView,
  type FogGhost, type FogView,
} from './fog.js';
import { padViews, type PadView, type ViewState } from './playback.js';
import { applyScenario, type ScenarioId } from './scenarios.js';
import { statusChips, statusPips, viewableStatuses } from './status-pips.js';
import {
  decoyNameplate, snapshotDecoy, unitNameplate, type DecoySnapshot,
} from './nameplates.js';
import { inspectDecoy, inspectUnit } from './inspect.js';
import { intentBadges } from './intent.js';
import { freshTimer, spendBank, timerView } from './timer.js';
import { previewNumbers, type PreviewNumber } from './preview-numbers.js';
import {
  clock, endReasonText, foldTurn, initTotals, matchBreakdown, scoreReadout, tally, topbar,
  type MatchTotals, type TopbarModel, type TopbarPortrait,
} from './scoreboard.js';
import { FRONT_DOOR, HOT_SEAT_DOOR, endHeadline, exitLabel, outcomeFor } from './end-screen.js';
import { AWAY_LABEL, NO_PRESENCE, type Presence } from './presence.js';
import { createTooltip, delegateTooltips } from './tooltip.js';
import { aimBoundaries, impactBoundaries } from './aim-boundary.js';

export interface HotSeatUI {
  board: HTMLElement;
  status: HTMLElement;
  controls: HTMLElement;
  /** The right-side combat log panel (UI6). Optional so tests can omit it. */
  log?: HTMLElement;
  /**
   * KESTREL-CONE — the renderer factory, so the controller can be driven without
   * a GPU.
   *
   * `createRenderer` builds a `WebGLRenderer` eagerly, which throws in any
   * headless DOM. That single line is why `startHotSeat` — the file where the
   * HUD, the draft reducer and the preview are actually wired together — had no
   * test at all, while every piece it wires had several. The Kestrel cone bug is
   * exactly what that gap hides: `abilityProfile`, `modeOptions`, `draftAbility`
   * and `toUnitOrders` each passed, and the question nobody could ask was
   * whether pressing the button in the HUD reached them.
   *
   * A factory rather than a flag, so the seam is the same shape as the real
   * thing and a test's stub has to satisfy `Renderer` in full. Absent in
   * production, where `main.ts` never passes one.
   */
  createRenderer?: typeof createRenderer;
}

/**
 * M3-NET-BOARD — the seam that turns this controller into a **networked**
 * client. Absent for the hot-seat, which is unchanged in every respect.
 *
 * Three differences, and they are all here rather than sprinkled through the
 * controller:
 *
 * 1. **One seat, no handover.** A networked client is one player of two, so
 *    `seats` is this seat alone and the "pass the mouse" loop has nothing to
 *    pass to. The hot-seat's `deriveSeats` walk is skipped entirely.
 * 2. **Lock-in submits.** The turn ends by sending orders, not by resolving —
 *    the client is not the authority and must not pretend to be. A client that
 *    ran its own `resolveTurn` would drift the moment the server disagreed, and
 *    the whole point of a pure engine is that it need not.
 * 3. **Resolutions arrive.** The server's `turnResolved` carries the state and
 *    the event log **already filtered for this team**, and both go straight into
 *    the same playback the hot-seat uses.
 */
export interface NetPlay {
  /** Which seat this client is — the one whose orders `submit` carries. */
  seatId: string;
  team: TeamId;
  /** The characters this seat orders, from `matchStarted`. */
  unitIds: string[];
  submit(orders: UnitOrders[]): void;
  /**
   * Register the handler the socket calls when a turn resolves. Called once, at
   * start-up; the controller supplies the callback rather than polling, so a
   * resolution can arrive whenever the server is ready.
   */
  onResolved(handler: (state: GameState, events: TurnEvent[]) => void): void;
  /**
   * M3-WAIT-STATE / M3-CONN-STATE — register the handler for "why is the board
   * not taking orders". A string is a reason to show and a locked board;
   * `undefined` means this client is deciding again.
   *
   * The *text* is composed outside the controller (`waiting.ts`), because the
   * one sentence that mentions the other team is the one place M3-HIDDEN's
   * count-only rule has to hold, and that belongs somewhere a test can reach.
   */
  onStatus(handler: (banner: string | undefined) => void): void;
  /**
   * M3-TIMER — register the handler for "how long is left", in milliseconds,
   * plus this seat's Time Bank charges. Called every time the server re-sends a
   * Decision phase, which is the only thing that moves either number.
   *
   * A duration rather than an instant: the deadline is the server's and the
   * skew between two machines' clocks is not something a countdown should have
   * to model. `undefined` means no window is open (the match ended) — draw
   * nothing rather than a zero.
   */
  onTimer(handler: (remainingMs: number | undefined, charges: number) => void): void;
  /**
   * M3-RECONNECT — register the handler for "which characters am I ordering
   * now". Fired whenever the server's control map changes: a teammate who
   * disconnects and misses a whole turn hands theirs over, and takes them back
   * when they return.
   *
   * A handler rather than a re-read of `unitIds`, because the control map is no
   * longer a fact about the start of the match — it is a fact about the turn,
   * and the server is the only thing that knows it.
   */
  onControl(handler: (unitIds: string[]) => void): void;
  /**
   * NET-PRESENCE-UI — register the handler for "who is actually here". Fired
   * when a seat drops or returns, and when the handoff changes what this seat is
   * holding for somebody else.
   *
   * The board only ever *draws* this: the marks say which player is gone and
   * which characters are on loan, and every one of those facts came off the wire.
   */
  onPresence(handler: (presence: Presence) => void): void;
  /**
   * Spend a Time Bank charge. Asks; does not apply. The server owns the window,
   * and an optimistic +10 s it then refused would be the one lie a clock must
   * never tell — so the extension appears when `onTimer` next fires.
   */
  extend(): void;
}

const PALETTE = {
  open: 0x20242f, wall: 0x4a5065, cover: 0x6b5b3e, brush: 0x2e4632,
  team0: 0x4f8cff, team1: 0xff6b5e, background: 0x12141a,
};
/** The same two team colours the board uses, for the DOM side of the HUD. */
const TEAM_CSS = ['#4f8cff', '#ff6b5e'] as const;
const REACH = 0x4f8cff;
/** The hover range envelope (UI1) — dimmer than anything committed. */
const RANGE = 0x8fb6ff;
const AIM = 0xff9a3e;
/** UI2's continuous shape — the same family as the tiles, deliberately paler. */
const SHAPE = 0xffc98a;
const SELECT = 0xf0f0f0;
/**
 * AIM-PREVIEW-TRUE — a plan on this side that is already locked in. Cooler and
 * paler than the live aim on purpose: it is a decision that has been made, and
 * it must never compete with the one still being composed over it.
 */
const LOCKED = 0x8fa6c4;
const IMPACT = 0xffd166;
/**
 * Fog (VISION1). Near-black rather than a tint: unseen board should read as
 * *absence of information*, and any hue would suggest the terrain underneath
 * meant something.
 */
const FOG = 0x05060a;
/**
 * CAMO-REVEAL's burning thicket. Deliberately hotter and purer than team 1's
 * `#ff6b5e` — this is an alarm, not an allegiance, and mistaking it for a red
 * unit is the one confusion it cannot afford.
 */
const CAMO_RED = 0xff2020;
const CAMO_OPACITY = 0.55;
/** The catalyst overlay — its own colour, because it is its own decision (CAT2). */
const CATALYST = 0x9be36b;
/** The free-action overlay — its own colour, because it is its own decision. */
const FREE = 0x6fe3c0;
/** Dark enough to read as "no information", light enough to keep terrain legible. */
const FOG_OPACITY = 0.62;
/**
 * The drawn movement lines (AIM1/UI4). All three share one geometry — a
 * polyline through tile centres plus an endpoint marker — and differ only in
 * colour and dashing, so a player learns the shape once and reads the colour:
 * blue walks, blue dashed sprints, YELLOW dashes (owner directive).
 */
/**
 * Every overlay a *plan* puts on the board, and every outline that goes with
 * them — the set that has to come off when there is no plan to show.
 *
 * Named because there are now three places that clear it (playback start, the
 * end screen, and DEATH-HANG's downed hold) and a list repeated three times is
 * a list that will be added to twice. A missed layer here is a ghost overlay
 * hanging over a board nobody is aiming on.
 */
const PLANNING_LAYERS = [
  'fog', 'camo', 'range', 'reach', 'aim', 'band', 'locked', 'impact', 'free', 'catalyst', 'select',
] as const satisfies readonly HighlightLayer[];
const PLANNING_SHAPE_LAYERS = [
  'shape', 'shapeBand', 'shapeImpact', 'shapeLocked',
] as const satisfies readonly ShapeLayer[];

const MOVE_LINE = 0x9fc4ff;
const SPRINT_LINE = 0x8fd6ff;
const DASH_LINE = 0xffd23f;
/** CHASE1's route + quarry ring: orange, distinct from move blue and dash yellow. */
const CHASE_LINE = 0xff8a3d;
/**
 * AUTO-PREVIEW's harder-hitting band. Warm and pale against `AIM`'s orange —
 * the same family, brighter, because it *is* the aim with more behind it.
 */
const BAND = 0xffe9a8;
/** AIM-RANGE-TELL's refusal marker — the one red on the planning overlays. */
const REFUSED = 0xff5a4e;
/**
 * WAYPOINT-TELL's marker — the move line's own blue, brightened, because a
 * waypoint is a point *on* that route rather than a different kind of thing.
 */
const WAYPOINT = 0xd6e6ff;

/**
 * Title + status line, overlaid on the top-left of the canvas (UI-VIEWPORT).
 * The only chrome whose size is assumed rather than measured — it is a text
 * block with a fixed font, and measuring an overlay that never wraps would be
 * ceremony. The HUD and the log ARE measured, because both have breakpoints.
 *
 * The board's own shape, max width and minimum are gone with the DOM-framed
 * board: the camera frames the board now, so those numbers no longer exist.
 */
/**
 * Fallback for the top chrome when nothing has laid out yet (the very first
 * `sizeToViewport`, before the scoreboard has been filled in). Every call after
 * that measures the real thing — the readout's height depends on how many
 * characters the format fields, so a constant would be wrong for 4v4 the moment
 * SCORE1 landed.
 */
const TOP_CHROME_FALLBACK_PX = 96;
/**
 * How far a floating readout rises over its lifetime, and where it starts —
 * above the billboarded bars, so a number never sits on top of the HP it just
 * changed.
 */
const READOUT_RISE_PX = 34;
/** Vertical gap between two preview numbers stacked on one unit. */
const PREVIEW_STACK_PX = 19;
const READOUT_LIFT = 1.6;
/** How each readout kind reads. Signs and words, not four identical numbers. */
const READOUT_TEXT: Record<Readout['kind'], (n: number) => string> = {
  damage: (n) => `−${n}`,
  absorb: (n) => `${n} absorbed`,
  heal: (n) => `+${n}`,
  shield: (n) => `+${n} shield`,
};
/**
 * Plan-time wording. Deliberately NOT the resolution wording: `−40` states a
 * fact and `40` over an unlocked aim is a projection, so the preview says what
 * it would do rather than what it did.
 */
const PREVIEW_TEXT: Record<PreviewNumber['kind'], (n: number) => string> = {
  damage: (n) => `${n}`,
  heal: (n) => `+${n}`,
  shield: (n) => `+${n}`,
};
const now = (): number => performance.now();

export function startHotSeat(
  ui: HotSeatUI,
  map: MapDef,
  roster: Roster,
  teams: [CharacterDef[], CharacterDef[]],
  format: FormatId,
  playersPerTeam: [number, number],
  catalysts: CatalystPool = {},
  /** CAMO-SEED: a dev-only starting arrangement. Absent for a normal match. */
  scenario?: ScenarioId,
  /** M3-NET-BOARD: present for a networked match, absent for the hot-seat. */
  net?: NetPlay,
  /** The server's opening state for a networked match — already team-filtered. */
  opening?: GameState,
): void {
  // CAMO-SEED: a dev-only nudge to the starting positions, applied once and
  // never again — everything after this is the ordinary engine on an ordinary
  // state. Absent for a normal match.
  //
  // M3-NET-BOARD: a networked match is handed its opening state instead. The
  // server is the authority, so the client never *creates* a match — it renders
  // the one it was given, already filtered for this seat.
  let state = opening ?? (scenario === undefined
    ? createMatch(map, format, teams)
    : applyScenario(scenario, buildBoard(map), createMatch(map, format, teams)));
  /** SCORE1's running ledger, folded from each turn's event log as it plays. */
  let totals: MatchTotals = initTotals(state);
  // One seat and no handover when networked (see `NetPlay`): this client is one
  // player of two, and there is nobody on this machine to pass the mouse to.
  const seats = net === undefined
    ? deriveSeats(state, playersPerTeam)
    : [{ seatId: net.seatId, team: net.team, unitIds: [...net.unitIds] }];

  // UI1's Lock-In ruling: a seat's characters are all orderable at once and the
  // player switches between them freely; **Lock In locks the selected character
  // only, and committing an action never ends the turn.** The old model walked
  // one character at a time and made "lock" mean "next", which is why choosing
  // an action felt like spending your turn.
  let seatIdx = 0;
  let selectedUnitId: string | undefined;
  let locked = new Set<string>();
  let drafts = new Map<string, OrderDraft>();
  let interaction: Interaction = IDLE;
  /**
   * WAYPOINTS-FIX — the square a Shift-click could not route to, marked until
   * the next click does something.
   *
   * Click-driven rather than hover-driven, unlike AIM-RANGE-TELL's marker: a
   * waypoint refusal is an answer to something the player *did*, and it has to
   * survive the pointer moving off the square or it would flash and vanish.
   */
  let refusedSquare: Vec2 | undefined;
  /**
   * WAYPOINT-TELL — the squares the player actually **clicked** while composing
   * a move, as opposed to every step the router filled in between them.
   *
   * Kept beside the draft rather than in it because the order carries a
   * `movePath` and nothing else: which of those squares were chosen and which
   * were routed is a fact about the *gesture*, and only the board needs it.
   */
  let waypointMarks: Vec2[] = [];
  /**
   * NET-PRESENCE-UI — who is missing and whose characters this seat is holding.
   *
   * Starts empty and stays empty in a hot-seat: there are no sockets on one
   * machine, so nobody can be absent from it. Networked, it is replaced whole by
   * `onPresence` — a value from the server rather than a thing this board works
   * out, which is what keeps the handoff's one implementation on the server.
   */
  let presence: Presence = NO_PRESENCE;
  /**
   * M3-WAIT-STATE — why the board is refusing orders, or `undefined` while it
   * is taking them. Networked only: a hot-seat is never waiting for anybody.
   */
  let banner: string | undefined;
  /**
   * DEATH-HANG — this networked seat has no living character to order, so it is
   * holding rather than planning.
   *
   * A separate flag from `banner` because the two mean opposite things about the
   * turn: `banner` says *the orders are already sent*, and this says *there are
   * none to send and the player has not yet said so*. Lock In is dead under the
   * first and alive under the second.
   */
  let downedHold = false;
  let projection: ProjectionName = 'isometric';

  /** The shield pool `initView` sums, so board and HUD never disagree. */
  const shieldOf = (u: UnitState): number =>
    u.statuses.filter((s) => s.kind === 'shield' && s.remaining > 0).reduce((sum, s) => sum + (s.amount ?? 0), 0);

  /**
   * `fogView` walks every unit's line of sight, and mouse-follow aiming
   * (AIM2-UX) repaints on every pointer move — but the state cannot change
   * mid-Decision, so the answer only ever depends on which seat is looking.
   * One slot is enough: the seat changes far more rarely than the pointer.
   */
  let fogMemo: { state: GameState; team: TeamId; view: FogView } | undefined;
  /**
   * LAST-KNOWN — where each team last *saw* each enemy, `(team, unitId) → pos`.
   *
   * The one genuinely stateful thing the client keeps, and it lives here rather
   * than in `fog.ts` for a specific reason: `fogView` is a pure function and the
   * memo below re-runs it whenever `(state, team)` changes, so a memory held
   * inside would be rebuilt from the current frame on every repaint — which is
   * precisely the memory being erased. `fog.ts` reads this map; only this line
   * writes it.
   *
   * It is not a vision rule and derives nothing: every square in it is one the
   * engine already showed this team.
   */
  let sightings: ReadonlyMap<string, Vec2> = new Map();
  const currentFog = (team: TeamId): FogView => {
    if (fogMemo?.state !== state || fogMemo.team !== team) {
      // Record what is visible *now* before building the view, so the next turn
      // has somewhere to put its ghost. A unit visible this frame gets no ghost
      // regardless — the real thing is being drawn.
      sightings = rememberSightings(sightings, map, state, team);
      fogMemo = { state, team, view: fogView(map, state, team, sightings) };
    }
    return fogMemo.view;
  };

  /**
   * `viewer` is the team doing the looking, and it is not decoration:
   * STATUS-ICONS renders **Stealth to its owner only**, so the row a unit shows
   * depends on who is reading it. Everything else about a visible unit is
   * public — if you can see them, you can see that they are Rooted.
   */
  /**
   * UI-INTENT — the queued plans this viewer's team may see, by unit id.
   *
   * Rebuilt per paint rather than cached: a draft changes on every click, and a
   * stale plan tile above a teammate is worse than none. Cheap — it is at most
   * four units and a string each.
   */
  const intentFor = (viewer: TeamId): Map<string, { label: string; locked: boolean }> =>
    new Map(intentBadges(state.units, roster, drafts, locked, viewer)
      .map((b) => [b.unitId, { label: b.label, locked: b.locked }]));

  const toRenderUnits = (units: readonly UnitState[], viewer: TeamId): RenderUnit[] => {
  const plans = intentFor(viewer);
  return units.map((u) => {
    // UI-NAMEPLATES: one model, and the icon row comes out of it too — since
    // NAMEPLATE-LAYOUT the row is painted into the plate itself, so the two
    // cannot disagree about what is on a unit even in principle.
    const plate = unitNameplate(u, roster, viewer);
    return {
      unitId: u.unitId, owner: u.owner, pos: u.pos, hp: u.hp, maxHp: u.maxHp,
      energy: u.energy, alive: u.alive, label: (u.characterId[0] ?? '?').toUpperCase(),
      shield: shieldOf(u),
      // STATUS-AUDIT / STATUS-ICONS: the status row rides *inside* the plate
      // since NAMEPLATE-LAYOUT — read straight off engine state during
      // Decision (an active status is one with turns left), with durations and
      // the shield pool as the glyph's numeral so the row says how long as
      // well as what.
      nameplate: plate,
      // UI-INTENT: allied plans only — `intentBadges` filtered by owner, so an
      // enemy simply has no entry here and the renderer draws nothing.
      ...(plans.has(u.unitId) ? { intent: plans.get(u.unitId)! } : {}),
    };
  });
  };

  /**
   * UI-NAMEPLATES — what each decoy's fake plate says, frozen at the cast.
   *
   * Client memory, like `sightings`, and for the same reason: the engine decoy
   * is `{id, teamId, pos, expiresOnTurn}` and deliberately carries nothing about
   * who cast it (edge-cases — the snapshot fields are the client's, derived from
   * the cast). Written when a `decoySpawned` event plays; read every frame after.
   */
  let decoySnapshots = new Map<string, DecoySnapshot>();

  /**
   * The plate for a decoy the viewer believes is a real unit.
   *
   * Only when it is being *impersonated*: to its owner a decoy is a purple
   * ground marker, not a body, and a nameplate over a marker would be the tell
   * in reverse.
   */
  const decoyPlate = (d: { id: string; owner: TeamId; asEnemy: boolean }) => {
    if (!d.asEnemy) return undefined;
    const snapshot = decoySnapshots.get(d.id)
      // A decoy already on the board when this client started drawing (the
      // scenario seeds, a reload) has no recorded cast. Falling back to the
      // caster as it stands is a small lie in the honest direction: it is what
      // the plate would have said a moment ago, and no plate at all is the one
      // answer that outs the decoy.
      ?? snapshotDecoy(state.units, roster, d.owner);
    return snapshot === undefined ? undefined : decoyNameplate(snapshot);
  };

  /**
   * A remembered enemy, in the renderer's shape. Everything live is blanked:
   * full HP, no energy, no statuses — a ghost that reported a real HP bar would
   * be telling the viewer something it stopped being allowed to know.
   */
  const toGhostUnits = (ghosts: readonly FogGhost[]): RenderUnit[] => ghosts.map((g) => ({
    unitId: g.unitId, owner: g.owner, pos: g.pos, hp: 1, maxHp: 1, energy: 0,
    alive: true, label: (g.characterId[0] ?? '?').toUpperCase(), ghost: true,
  }));

  /**
   * The board, for PREVIEW-MODIFIERS' cover check.
   *
   * Memoised because `buildBoard` walks the whole map and mouse-follow aiming
   * repaints on every pointer move — but the map is fixed for a match, so one
   * slot is all it ever needs.
   */
  let boardMemo: Board | undefined;
  const previewBoard = (): Board => (boardMemo ??= buildBoard(map));

  const renderer: Renderer = (ui.createRenderer ?? createRenderer)(ui.board, map, PALETTE);

  // ── VISION1-opening ───────────────────────────────────────────────────────
  // Paint the fogged board NOW, before the render loop starts, so the very
  // first composited frame already hides the enemy team. There is no turn-1
  // grace reveal and no full-board flash to fog out of.
  //
  // This held by accident before: `beginTurn()` runs at the end of this
  // function, still inside the same task, so it beat the first animation frame.
  // Anything asynchronous landing in between — a font, an asset, a lobby
  // handshake — would have reintroduced the leak silently. Painting it here
  // makes it a property of the code rather than of the scheduler.
  paintFog(seats[0]?.team ?? 0);

  const fitCamera = (): void => renderer.fitBoard();
  // Size from the VIEWPORT, never from the container: the canvas is the
  // container's only child, so measuring the container would feed the canvas its
  // own width back and pin it at Three's 300px default.
  /**
   * Fit the board to the space the fixed chrome leaves it.
   *
   * The HUD and the log are `position: fixed`, so they do not shrink the
   * viewport — the board has to subtract them itself or it renders underneath.
   * Their sizes are **measured**, not assumed: both have CSS breakpoints, and a
   * hardcoded 260/300 would silently mis-fit the board at every width except
   * the one it was tuned on.
   *
   * The board's own container is still never measured — the canvas is its only
   * child, so that would feed the canvas its own width back and pin it.
   */
  // SCORE1's readout lives in its own element, so the HUD's in-place update
  // never has to know about it and vice versa.
  //
  // HUD-LAYOUT (owner AC 4): it goes in the page's **top band** — beside the
  // title block rather than under it — so the score and team pips are at the
  // top of the window. `#topchrome` is `index.html`'s; when it is absent (the
  // test harness mounts four bare nodes) it falls back to sitting after the
  // status line, which is where it always was.
  const scoreEl = document.createElement('div');
  scoreEl.className = 'scoreboard';
  const topChrome = document.getElementById('topchrome');
  if (topChrome !== null) topChrome.appendChild(scoreEl);
  else ui.status.after(scoreEl);
  // TOOLTIP-SWEEP: the portraits' tooltips. Delegated on `scoreEl`, which is
  // built once, because the strip inside it is rebuilt wholesale on every
  // render — per-node listeners would be re-attached every turn.
  delegateTooltips(scoreEl, createTooltip());

  const sizeToViewport = (): void => {
    // UI-VIEWPORT: the canvas IS the viewport. The board used to be the app
    // frame — a DOM box the chrome was subtracted from — which meant a bigger
    // map pushed the controls off the bottom of the screen (`iron-basin` at
    // 22×19 is where it stopped being theoretical). Now the chrome overlays a
    // full-bleed canvas and the *camera* frames the board, so map size and
    // control placement stop being the same question.
    renderer.resize(globalThis.innerWidth, globalThis.innerHeight);

    // The log is a right-hand column on a wide screen and a strip above the HUD
    // on a narrow one, so it costs width in one layout and height in the other.
    // Which one is *read off the box*, not branched on a pixel threshold — the
    // breakpoint lives in the stylesheet and duplicating it here would let the
    // two drift apart silently.
    const logBox = ui.log?.getBoundingClientRect();
    const logIsColumn = logBox !== undefined && logBox.width < globalThis.innerWidth * 0.6;
    renderer.setSafeInsets({
      // Measured, not assumed: the scoreboard's strip grows with the format's
      // character count, so a fixed number would frame the board under it in
      // 4v4 and leave a gap in 1v1.
      //
      // HUD-LAYOUT: measured off the **band**, not off the scoreboard alone.
      // The two are side by side now, so whichever of them is taller sets the
      // bottom edge — reading only the score would frame the board under the
      // status line whenever the status line ran longer.
      top: Math.max((topChrome ?? scoreEl).getBoundingClientRect().bottom + 8, TOP_CHROME_FALLBACK_PX),
      right: logIsColumn ? (logBox?.width ?? 0) : 0,
      bottom: ui.controls.getBoundingClientRect().height + (logIsColumn ? 0 : (logBox?.height ?? 0)),
      left: 0,
    });
  };
  sizeToViewport();
  fitCamera();
  // The renderer drives its own frames now: the orbit, the auto-camera's easing
  // and the billboarded bars all need continuous frames, not one render per
  // input event.
  renderer.start();
  // The camera eases every frame, so the DOM-anchored plan-time numbers have to
  // be re-placed against the frame that was just drawn or they trail the board.
  renderer.onFrame(placePreviewNumbers);
  globalThis.addEventListener('resize', () => { sizeToViewport(); fitCamera(); });
  ui.board.addEventListener('click', onBoardClick);
  ui.board.addEventListener('mousemove', onBoardHover);
  // Leaving the board closes the panel: it is anchored to the pointer, so a
  // panel left behind would sit over the HUD pointing at nothing.
  ui.board.addEventListener('mouseleave', () => hud.inspect(undefined));

  // UI6: the right-side combat log accumulates for the whole match. It is a
  // pure `TurnEvent[]` consumer — same contract as playback.
  const combatLog: CombatLog | undefined = ui.log !== undefined ? createCombatLog(ui.log) : undefined;
  const logNames: LogNames = {
    unit: (unitId) => {
      const unit = unitById(unitId);
      return unit === undefined ? unitId : characterFor(unit).name;
    },
    ability: (abilityId) => {
      for (const character of Object.values(roster)) {
        const found = [...character.abilities, character.ultimate].find((a) => a.id === abilityId);
        if (found !== undefined) return found.name;
      }
      return catalysts[abilityId]?.name ?? abilityId;
    },
  };

  // Persistent corner phase label (A3): it stays put and changes text, so the
  // eye never has to hunt for which phase is playing.
  const phaseLabel = document.createElement('div');
  phaseLabel.className = 'phase-label';
  phaseLabel.style.display = 'none';
  ui.board.appendChild(phaseLabel);

  // UI5: floating readouts are DOM anchored to projected world positions —
  // crisp text with no font atlas, and the renderer stays a geometry engine.
  const readoutLayer = document.createElement('div');
  readoutLayer.className = 'readouts';
  ui.board.appendChild(readoutLayer);
  const readoutNodes = new Map<string, HTMLElement>();
  // PREVIEW-NUMBERS lives in the same layer but its own map: a resolution
  // readout is transient and a plan-time preview persists until the aim changes,
  // so one reconcile pass cannot own both without one clearing the other.
  const previewNodes = new Map<string, HTMLElement>();
  let livePreviews: readonly PreviewNumber[] = [];

  // The HUD is built ONCE and updated in place (UI3). Rebuilding it per render
  // would fire mouseleave on nodes that no longer exist, so UI1's hover state
  // would be wiped by its own repaint.
  const hud: Hud = createHud(ui.controls, {
    selectCharacter: selectUnit,
    selectAbility,
    selectCatalyst,
    selectChase: armChase,
    /**
     * BASIC-MODES — flip the armed ability's aim-time profile.
     *
     * Re-arms rather than merely re-labels: `selectMode` clears the aim (the two
     * profiles have different shapes and ranges, so a square legal for one is
     * often illegal for the other), and the interaction goes back to `aim` so the
     * player is pointing again immediately instead of at a stale preview.
     */
    selectMode: (mode) => {
      const unit = selectedUnit();
      if (unit === undefined) return;
      drafts.set(unit.unitId, nextDraft(draftFor(unit), { type: 'selectMode', mode }, false));
      interaction = arm('aim');
      render();
    },
    /**
     * WALL-ROTATE — turn the placed shape, keeping everything else.
     *
     * Deliberately NOT a `nextDraft` action, and deliberately not clearing the
     * aim the way `selectMode` does. A mode change makes the old aim meaningless
     * (a line's target is often illegal for a cone); a rotation is a change *to*
     * the aim, about a square the player has already chosen. Clearing it would
     * make "turn the wall" mean "put the wall away and start again", which is
     * the opposite of what the control is for.
     *
     * So: store the step, re-arm aiming so the preview follows the pointer
     * again, and re-render. A committed wall re-derives from the same draft, so
     * it turns in place.
     */
    selectRotation: (aimStep) => {
      const unit = selectedUnit();
      if (unit === undefined) return;
      draftFor(unit).aimStep = aimStep;
      interaction = arm('aim');
      render();
    },
    hoverAbility: (abilityId, control, def) => {
      if (abilityId === undefined || control === undefined || def === undefined) hideTip();
      else showTip(control, def);
      interaction = hoverAbility(interaction, abilityId);
      renderPreviews();
    },
    selectMove,
    hoverMove: (kind) => { interaction = hoverMove(interaction, kind); renderPreviews(); },
    hold: () => {
      const unit = selectedUnit();
      if (unit === undefined) return;
      drafts.set(unit.unitId, emptyDraft(unit.unitId));
      interaction = IDLE;
      render();
    },
    lock: lockSelected,
    toggleProjection: () => {
      // One camera, two pitches — the whole point of going orthographic.
      projection = projection === 'isometric' ? 'top' : 'isometric';
      renderer.setProjection(projection);
      fitCamera(); // the pitch changes the foreshortening, so re-fit
      render();
    },
    toggleOrbit: () => {
      // Auto follows the action; free orbit hands the camera to the player and
      // stands the auto-framing down so the two never fight.
      renderer.setOrbitEnabled(!renderer.orbitEnabled());
      if (!renderer.orbitEnabled()) fitCamera();
      render();
    },
    extendTime: () => {
      // M3-TIMER: in a networked match the bank is the **server's** — it owns
      // the one deadline the whole room shares, so this asks and waits. The
      // flash fires from `adoptWindow` when the charge count actually drops,
      // which means it can only ever celebrate an extension that happened.
      if (net !== undefined) return void net.extend();
      // UI-TIMER: the +10 s. Recorded as a moment rather than a boolean so the
      // flash can fade on its own — a charge that vanished silently would read
      // as a miscount, and "did my bank actually fire?" is the one question the
      // control must never leave open.
      const next = spendBank(remainingMs(), bankCharges);
      if (!next.spent) return;
      deadlineAt = performance.now() + next.remainingMs;
      bankCharges = next.charges;
      bankSpentAt = performance.now();
      paintTimer();
    },
  });

  // The HUD and log are what `sizeToContainer` measures, so re-fit now that both
  // exist and carry content — the first pass ran before either was populated.
  sizeToViewport();
  fitCamera();

  // Ability hover tooltip (TT1) — one reused element, positioned by the button.
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
  const showTip = (target: HTMLElement, def: AbilityDef): void => {
    tooltip.textContent = abilityTooltip(def).join('\n');
    tooltip.style.display = 'block';
    const r = target.getBoundingClientRect();
    // The hotbar sits at the bottom of the viewport (UI3), so a tooltip hung
    // below its button would fall off the screen. Flip it above when it must.
    const h = tooltip.getBoundingClientRect().height;
    const below = r.bottom + 6;
    tooltip.style.left = `${Math.round(Math.max(8, Math.min(r.left, globalThis.innerWidth - 296)))}px`;
    tooltip.style.top = `${Math.round(below + h > globalThis.innerHeight - 8 ? r.top - h - 6 : below)}px`;
  };
  const hideTip = (): void => { tooltip.style.display = 'none'; };

  const characterFor = (u: UnitState): CharacterDef => roster[u.characterId]!;
  const unitById = (uid: string) => state.units.find((u) => u.unitId === uid);
  const currentSeat = (): Seat | undefined => seats[seatIdx];
  /** The living characters the seat on the clock controls, in seat order. */
  const seatRoster = (): UnitState[] =>
    (currentSeat()?.unitIds ?? []).map(unitById).filter((u): u is UnitState => u !== undefined && u.alive);
  const selectedUnit = (): UnitState | undefined =>
    selectedUnitId === undefined ? undefined : unitById(selectedUnitId);
  const draftFor = (unit: UnitState): OrderDraft => {
    const existing = drafts.get(unit.unitId);
    if (existing !== undefined) return existing;
    const fresh = emptyDraft(unit.unitId);
    drafts.set(unit.unitId, fresh);
    return fresh;
  };

  const viewUnits = (view: ViewState): RenderUnit[] => {
    const viewer = currentSeat()?.team ?? 0;
    return [...view.units.values()].map((v) => ({
      unitId: v.unitId, owner: v.owner, pos: { ...v.pos }, hp: v.hp, maxHp: v.maxHp,
      energy: v.energy, alive: v.alive, label: (v.unitId[0] ?? '?').toUpperCase(), shield: v.shield,
      // UI-NAMEPLATES during playback: the same plate, fed by the fold rather
      // than by state, so an HP bar ticks down as the blow lands instead of
      // jumping when the turn ends.
      nameplate: {
        name: roster[unitById(v.unitId)?.characterId ?? '']?.name ?? v.unitId,
        hp: v.hp,
        maxHp: v.maxHp,
        shield: v.shield,
        energy: v.energy,
        ult: v.energy >= ULT_COST,
        // …and the status row off the folded event log — same icons, same
        // order, and no numerals: the log carries neither durations nor shield
        // pools, and inventing them is worse than leaving them off.
        pips: statusPips(viewableStatuses([...v.statuses].map((kind) => ({ kind })), v.owner === viewer)),
      },
    }));
  };

  /**
   * Playback decoys, seen from the seat that just planned (DECOY-RENDER).
   * The turn is history so nothing is hidden, but "revealed" is not "identical
   * for everyone" — a decoy still draws as an enemy to the team it fooled and
   * as its owner's purple marker to the team that placed it.
   */
  const viewDecoys = (view: ViewState): RenderDecoy[] => {
    const viewer = currentSeat()?.team ?? 0;
    return [...view.decoys.values()].map((d) => {
      const shown = { id: d.id, pos: { ...d.pos }, owner: d.teamId, asEnemy: d.teamId !== viewer };
      return { ...shown, nameplate: decoyPlate(shown) };
    });
  };

  /**
   * Playback traps (TRAP-INDICATOR). Nothing is hidden once the turn is history,
   * so every trap is drawn — but a marker that appears mid-Prep and vanishes the
   * instant somebody walks onto it is the clearest possible account of what just
   * happened, which is why the view folds `trapPlaced`/`trapTriggered` rather
   * than reading the resolved state.
   */
  /**
   * Playback camouflage tells (CAMO-REVEAL). The reveal *lands* during playback,
   * so this is where a player actually watches the thicket catch fire — folded
   * from the same `statusApplied` stream everything else in playback reads.
   */
  /**
   * PADS-INDICATOR — every pad on the map, armed or spent.
   *
   * Public terrain: both teams see every pad, so this takes no viewer and asks
   * no fog question. During playback the in-flight `powerupTaken` set is passed
   * so a pad picked up in the Move phase goes dark **as it happens** — the one
   * moment a player is actually watching that square.
   */
  // A `function` rather than a `const` arrow on purpose: VISION1-opening calls
  // `paintFog` during construction, well above this line, and a const would be
  // in its temporal dead zone — a blank page with "Cannot access before
  // initialization" and no board at all.
  function pads(view?: ViewState): PadView[] {
    return padViews(map, state, view?.takenPowerups);
  }

  const viewCamo = (view: ViewState): Vec2[] => camoTiles(map, [...view.units.values()].map((u) => ({
    pos: u.pos, alive: u.alive, revealed: u.statuses.has('reveal'),
  })));

  const viewTraps = (view: ViewState): RenderTrap[] => {
    const viewer = currentSeat()?.team ?? 0;
    return [...view.traps.values()].map((t) => ({
      id: t.id, pos: { ...t.pos }, owner: t.owner, own: t.owner === viewer,
    }));
  };

  function beginTurn(): void {
    drafts = new Map();
    locked = new Set();
    waypointMarks = [];
    seatIdx = 0;
    openSeat();
  }

  /**
   * UI-TIMER — the decision countdown, per seat.
   *
   * Client-side and **presentation only**: nothing here ends a turn. Enforcing a
   * deadline is server-authoritative and belongs to M3-TIMER, where it is the
   * same deadline for everybody; a hot-seat clock that resolved the turn by
   * itself would be a second, different rule, and the two would drift.
   *
   * Reset per seat rather than per turn because the Time Bank is a *player's*
   * resource — in a hot-seat, each seat is a player taking its own decision, so
   * each gets its own window and its own charge.
   */
  let deadlineAt = 0;
  let bankCharges = freshTimer().charges;
  let bankSpentAt: number | undefined;
  let timerHandle: ReturnType<typeof setInterval> | undefined;

  const remainingMs = (): number => Math.max(0, deadlineAt - performance.now());

  const paintTimer = (): void => {
    const since = bankSpentAt === undefined ? undefined : performance.now() - bankSpentAt;
    hud.setTimer(timerView(remainingMs(), bankCharges, since));
  };

  /**
   * Start a fresh window. Driven by an interval rather than the render loop:
   * the decision phase has no animation frame of its own, and repainting the
   * whole HUD ten times a second to move one number would tear the DOM out
   * from under UI1's hover.
   */
  function startTimer(): void {
    // M3-TIMER: a networked window is opened by the server's `decision`, not by
    // this client reaching its turn. Starting a local one here would put a
    // second clock on screen — the wrong one — for however long the frame took
    // to arrive, and the two would disagree by exactly the round trip.
    if (net !== undefined) return;
    const fresh = freshTimer();
    deadlineAt = performance.now() + fresh.remainingMs;
    bankCharges = fresh.charges;
    bankSpentAt = undefined;
    if (timerHandle !== undefined) clearInterval(timerHandle);
    // Ten hertz: enough that the tenths readout counts smoothly, cheap enough
    // that it costs nothing next to a WebGL frame.
    timerHandle = setInterval(paintTimer, 100);
    paintTimer();
  }

  function stopTimer(): void {
    if (timerHandle !== undefined) clearInterval(timerHandle);
    timerHandle = undefined;
    hud.setTimer(undefined);
  }

  /**
   * M3-TIMER — adopt the server's window as this client's.
   *
   * The server sends a *duration*, so the only thing done here is to anchor it
   * to this machine's clock; nothing re-derives how long a turn is, and the
   * client never decides that a window has closed. `undefined` means the match
   * has ended and there is nothing left to count.
   *
   * The flash is driven off the charge count **falling**, rather than off the
   * click that asked for it: that way it marks a charge the server actually
   * spent, and a refused extension animates nothing.
   */
  function adoptWindow(remaining: number | undefined, charges: number): void {
    if (remaining === undefined) return void stopTimer();
    if (charges < bankCharges) bankSpentAt = performance.now();
    deadlineAt = performance.now() + remaining;
    bankCharges = charges;
    if (timerHandle === undefined) timerHandle = setInterval(paintTimer, 100);
    paintTimer();
  }

  /** Put the next seat with living characters on the clock, or resolve. */
  function openSeat(): void {
    // DEATH-HANG. An empty roster reaches the bottom of this function meaning
    // two completely different things, and the shipped code could only see one
    // of them.
    //
    // Walking *off the end* of the seat list means the turn is answered — every
    // seat had its say — and `endTurn` sends it. That is the normal path in
    // both modes, and networked it is the only way a submission is ever made.
    //
    // But a networked match has exactly ONE seat, so arriving here at
    // `seatIdx === 0` means something else entirely: the walk has not started,
    // and this player's characters are simply **down**. The old code could not
    // tell those apart and ran the first meaning for both — `net.submit([])`
    // the instant a resolution downed the seat. The client answered a turn it
    // was never shown, every control then correctly refused to change orders
    // that were already sent, and the window the server opened next was a
    // window on a spent turn. "The lock-in is not possible", exactly.
    //
    // The turn ends when the SERVER says so. This seat has nothing to add to
    // it, which is not the same as having said so.
    if (net !== undefined && seatIdx === 0 && seatRoster().length === 0) return holdDownedSeat();

    while (seatIdx < seats.length && seatRoster().length === 0) seatIdx += 1;
    const roster = seatRoster();
    if (roster.length === 0) return void endTurn();
    downedHold = false;
    for (const unit of roster) draftFor(unit); // every character is orderable at once
    startTimer();
    selectUnit(roster[0]!.unitId);
  }

  /**
   * DEATH-HANG — a networked seat with every character down.
   *
   * It holds: no order goes out, because the player never chose one, and the
   * engine's ruled treatment of a seat that submits nothing is *hold position* —
   * the same result an empty submission produces, arrived at honestly.
   *
   * What it must not do is go quiet. The HUD is put back into its ordering
   * layout (so the server's window has somewhere visible to land) with no active
   * character, and the banner says why there is nothing to press. A silent
   * client and a crashed one look identical from the chair.
   *
   * Lock In stays **live** — as "Hold Position", the one thing this seat can
   * still say. It is the difference between a hold and the auto-submit that
   * caused the bug: the packet only leaves when the player sends it, and a
   * player who has nothing to do can still let the turn resolve early rather
   * than sit out the whole window.
   */
  function holdDownedSeat(): void {
    downedHold = true;
    selectedUnitId = undefined;
    interaction = IDLE;
    clearPreviewNumbers();
    for (const layer of PLANNING_LAYERS) renderer.highlight(layer, [], 0);
    for (const shapeLayer of PLANNING_SHAPE_LAYERS) renderer.drawShape([], SHAPE, 0, shapeLayer);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.drawPath([], DASH_LINE, false, 'catalystPath');
    paintFog(currentSeat()?.team ?? 0);

    const mine = (currentSeat()?.unitIds ?? []).map(unitById)
      .filter((u): u is UnitState => u !== undefined);
    hud.update(idleHudModel());
    hud.setBanner(downedLabel(mine.filter((u) => !u.alive).length, mine.length));
    ui.status.textContent = `Turn ${state.turn} · ${teamName(currentSeat()?.team ?? 0)} — down`;
    renderScoreboard();
  }

  /**
   * The HUD with nothing to order: the ordering layout, an empty hotbar and no
   * active character. `hud.update` has always tolerated an absent `active` —
   * that is the shape this uses.
   */
  function idleHudModel(): HudModel {
    return {
      roster: [],
      abilities: [],
      modes: [],
      rotations: [],
      catalysts: [],
      move: { budget: 0, drawing: false, sprinting: false, sprintDisabled: true },
      chase: { armed: false, disabled: true },
      lock: { label: 'Hold Position ▸' },
      view: {
        projection: projection === 'isometric' ? 'Isometric' : 'Top-down',
        orbit: renderer.orbitEnabled(),
      },
    };
  }

  function selectUnit(unitId: string): void {
    selectedUnitId = unitId;
    interaction = IDLE;
    render();
  }

  /**
   * Lock In (UI1): commit the *selected* character and hand the seat its next
   * unlocked one. Only when every character the seat controls is locked does the
   * clock move on — and only when every seat is done does the turn resolve.
   */
  function lockSelected(): void {
    if (banner !== undefined) return; // already sent, or disconnected
    // DEATH-HANG: a downed seat has no character to lock, but pressing the
    // button is still a decision — "I have nothing, resolve without me". That
    // sends the empty submission the bug used to send *for* the player.
    if (downedHold) {
      downedHold = false;
      return void endTurn();
    }
    if (selectedUnitId === undefined) return;
    locked.add(selectedUnitId);
    const next = seatRoster().find((u) => !locked.has(u.unitId));
    if (next !== undefined) return selectUnit(next.unitId);
    seatIdx += 1;
    openSeat();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  /**
   * Draw the board as `team` sees it: its own units plus whatever it can see of
   * the enemy, with everything outside team sight darkened. The one place fog
   * is applied, so the opening frame and every later Decision frame cannot
   * disagree about what is hidden.
   */
  function paintFog(team: TeamId): void {
    const view = currentFog(team);
    // Decoys come from the same view as the units (DECOY-RENDER): fogged by the
    // same rule, and tagged with how *this* viewer should see them. Drawing
    // `state.decoys` directly is what showed every decoy to both teams, through
    // walls, in a colour that announced it was fake.
    // Traps ride the same view for the same reason (TRAP-INDICATOR): the
    // placing team always sees its own, the enemy only a square it can see, and
    // that decision belongs to `fogView` rather than to the renderer.
    // LAST-KNOWN: ghosts ride the same reconcile path as live units — same
    // `unitId`, so one scene object is either the unit or its memory and the two
    // can never be on the board at once.
    // PADS-INDICATOR: pads are public terrain, so they are drawn from the map
    // and the authoritative state, with no fog view in the way.
    renderer.show(
      [...toRenderUnits(view.units, team), ...toGhostUnits(view.ghosts)],
      // UI-NAMEPLATES: a decoy being taken for a real unit wears a real unit's
      // plate. `fogView` already decided which decoys this viewer sees and
      // whether each is being impersonated; this only dresses them.
      view.decoys.map((d) => ({ ...d, nameplate: decoyPlate(d) })),
      view.traps, pads(),
    );
    renderer.highlight('fog', view.fogged, FOG, FOG_OPACITY);
    // CAMO-REVEAL: the thicket a unit gave itself away in burns red. Same view
    // as everything else, so it can never out a unit the seat cannot see.
    renderer.highlight('camo', view.camoTiles, CAMO_RED, CAMO_OPACITY);
  }

  /**
   * The board half of a decision-phase render. Split out from `render()` because
   * mouse-follow aiming (AIM2-UX) repaints on every pointer move — rebuilding
   * the control buttons at that rate would tear the DOM out from under the
   * pointer and kill hover tooltips.
   */
  function renderPreviews(): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    const draft = draftFor(unit);
    const character = characterFor(unit);
    // MOVE-FOG: every plan-time reachability query runs against the units this
    // seat can SEE, not the true unit list. Planning against the truth let an
    // invisible enemy block a square, so sweeping a move target across the fog
    // located a hidden body exactly. Resolution still uses the real board — the
    // engine stops the mover on contact, and that contact is the reveal.
    const planned = planningState(state, currentFog(currentSeat()?.team ?? unit.owner).units);

    // ── VISION1: fog of war ──────────────────────────────────────────────────
    // Planning is the only time hiding anything is honest — during playback the
    // turn is history and everything is shown. The engine answers *what* is
    // visible; this only paints the answer. Hot-seat fog is an aid for players
    // sharing a screen, not a security boundary — that is M3.
    paintFog(currentSeat()?.team ?? unit.owner);
    renderer.setSpotlight(null); // planning shows the whole board, undimmed
    phaseLabel.style.display = 'none';
    clearReadouts();
    renderer.focusOn([]); // ease back out to the whole board after a resolution
    renderer.highlight('select', [unit.pos], SELECT, 0.5);

    const chosen = draftAbility(character, draft);
    const isDash = chosen?.phase === 'dash';
    // All three aimable slots are resolved up front now: AIM-RANGE needs the
    // armed one to pick the range envelope, and the envelope is drawn before
    // the aims it bounds.
    const freeDef = draftFreeAbility(character, draft);
    const catalystDef = draft.catalystId !== undefined ? catalysts[draft.catalystId] : undefined;

    // AIM-PREVIEW-TRUE: resolved before the envelope, because the envelope now
    // *reads* it — "where could this go" is a question you stop asking the
    // moment you have aimed, so the envelope steps back when an aim is live.
    const preview = previewAim(map, state, unit, chosen, draft, interaction);
    const covered = chosen !== undefined ? abilityPreview(map, unit, chosen, preview.aim, preview.aimStep) : [];

    // ── Layer: the effective-range ENVELOPE (UI1 + AIM-RANGE) ────────────────
    // Where an action *could* go, which is a different question from what a
    // given aim covers — and the one a player asks before selecting anything.
    // Hovering a control answers it without touching the draft.
    //
    // AIM-RANGE: this used to read `chosen` alone, so arming a free ability or
    // a catalyst painted **no envelope at all** — "Overwatch Trap doesn't have a
    // range indicator either", "Dash catalyst doesn't have a range indicator".
    // The armed slot is whichever mode is live, so one envelope answers for all
    // three without three layers fighting for the same tiles.
    const { hover } = interaction;
    const hovered = hover.abilityId !== undefined ? findOnCharacter(character, hover.abilityId) : undefined;
    const armedDef =
      interaction.mode === 'free' ? freeDef
      : interaction.mode === 'catalyst' ? catalystDef
      : chosen;
    const envelopeAbility = hovered ?? (hover.move === undefined ? armedDef : undefined);
    // AIM-PREVIEW-TRUE: a **quieter channel**. Two similar fills competing for
    // the same tiles was the second half of the owner's "it feels like there's
    // the highlight preview + the squares that get affected" — so once a live
    // aim exists the envelope fades back to a wash and lets the shape it bounds
    // be the thing you are looking at.
    renderer.highlight(
      'range',
      envelopeAbility !== undefined ? rangeEnvelope(map, state, unit, envelopeAbility) : [],
      RANGE,
      covered.length > 0 ? 0.06 : 0.16,
    );

    // ── Layer: the MOVE envelope ─────────────────────────────────────────────
    // A dash *is* the movement, so it shows no separate move preview; the budget
    // comes straight from the engine (4 with an ability, 8 sprinting, 0 rooted).
    const sprinting = hover.move === 'sprint' || (hover.move === undefined && draft.sprint);
    const showMove = hover.move !== undefined
      || (!isDash && (draft.sprint || interaction.mode === 'move' || draft.movePath.length > 0));
    renderer.highlight('reach', showMove ? moveEnvelope(map, planned, unit, sprinting) : [], REACH, 0.22);

    // ── Layer: the tiles an aim actually covers ──────────────────────────────
    // While the pointer is over the board with a mode armed, this previews the
    // HOVERED aim; otherwise it shows what has been committed. Same `aimFor`
    // either way, so the preview and the commit can never disagree.
    renderer.highlight('aim', covered, AIM, 0.5);

    // ── AUTO-PREVIEW: the tiles inside the aim that hit HARDER ───────────────
    // "New auto attacks need new visual indicators in preview." A cone's axis
    // (BASIC-AXIS) and a circle's core (BASIC-INNER) pay a different number on
    // tiles the aim overlay draws identically, so the ability read as one flat
    // number over one flat shape. Its own layer, directly above the aim it
    // qualifies: it is a reading of those same tiles, not a separate area.
    //
    // PREVIEW-NUMBERS-AUDIT: derived once, as two sets. The highlight wants them
    // merged (both bands mean "this tile is special") and the numbers need them
    // apart (`innerAmount` replaces, `axisBonus` adds) — deriving them twice is
    // how the glow and the figure written on it would come to disagree.
    const bands = chosen !== undefined
      ? previewBandSets(map, unit, chosen, preview.aim, preview.aimStep)
      : { axis: [], inner: [] };
    renderer.highlight('band', [...bands.axis, ...bands.inner], BAND, 0.5);

    // ── DASH-PREVIEW: a dash's impact disc(s) ────────────────────────────────
    // "Shadowstep Strike needs to show what boxes are being hit, not just the
    // box of arrival." Its own layer rather than more tiles in `covered`: the
    // aimed area is where the dash GOES, the disc is what the arrival DOES, and
    // a player choosing between two landing squares is reading the second.
    // Plan-time only — the engine detonates from wherever the dash really stops.
    const impact = impactPreview(map, unit, chosen, preview.aim, preview.aimStep);
    // Three things share this layer, and they can never be wanted at once: a
    // dash's landing discs, AIM-RANGE-TELL's refused *aim*, and WAYPOINTS-FIX's
    // refused *waypoint*. A refusal has no landing to preview, and a landing is
    // not a refusal. (This line was dropped by the AIM-RANGE-TELL commit, which
    // silently took the dash discs off the board with it — see the regression
    // test in `dash-preview.test.ts`.)
    // BASTION-RAM-LINE: a CHARGE marks where it stops. *"The preview should be
    // like a line attack that also shows the ending dash location."* Its route
    // is already a line of tiles and every one of them looks identical —
    // including the square the player is actually choosing between. The landing
    // goes on this layer rather than getting one of its own because it answers
    // exactly this layer's question: the aim says where the dash *goes*, this
    // says what the arrival *is*. A teleport needs none — its aimed square IS
    // the landing, and is already the only tile lit.
    const chargeLanding = chosen?.shape === 'path' && impact.landing !== undefined
      ? [impact.landing]
      : [];
    const layer = impactLayer(
      [...impact.origin, ...impact.destination, ...chargeLanding],
      refusedAim(map, state, unit, chosen, interaction, draft.aimStep),
      refusedSquare,
    );
    renderer.highlight('impact', layer.squares, layer.refused ? REFUSED : IMPACT, 0.4);

    // ── UI2 Layer 1: the continuous shape over Layer 2's tiles ───────────────
    // The tiles are the truth (centre-in binary, AIM2); the wedge/beam/disk is
    // the fiction they approximate. Showing only the tiles makes a clipped
    // corner look like a bug; showing only the shape hides what actually gets
    // hit. Both, from the same numbers.
    // AIM-PREVIEW-TRUE: the boundary is the LOCUS of the engine's own
    // tile-centre predicate, so a tile lights iff its centre is inside it —
    // proved for every shape at every rotation by the congruence sweep in
    // `aim-boundary.test.ts`. The tiles above are still the engine's answer;
    // this is the same answer drawn as a continuous shape instead of inferred.
    const boundaries = chosen !== undefined && covered.length > 0
      ? aimBoundaries(unit, chosen, preview.aim, preview.aimStep, covered)
      : [];
    renderer.drawShape(boundaries.slice(0, 1), SHAPE, 0.16);
    // The sub-band gets its own outline in its own colour (Dev Note #1,
    // Bastion's centre hit): which tiles carry the bonus is a predicate too,
    // and it was left as a colour wash for the eye to guess at.
    renderer.drawShape(boundaries.slice(1), BAND, 0.2, 'shapeBand');
    renderer.drawShape(
      layer.refused ? [] : impactBoundaries(map, chosen, unit.pos, impact.landing),
      IMPACT,
      0.16,
      'shapeImpact',
    );

    // ── AIM-PREVIEW-TRUE AC #5: plans already locked in, same derivation ─────
    //
    // "Preview, confirmation and resolution all draw from one derivation." A
    // character that has locked in still has a plan on this board, and until now
    // it showed only as a badge over its head — so a player ordering their
    // second character could not see what their first had committed to.
    //
    // **Own team only.** `drafts` outlives the seat handover in a hot-seat, so
    // an unfiltered read would show the previous seat's committed shot to the
    // player it is aimed at. Same rule `intentBadges` is held to, and the same
    // reason: hidden information is team vs team.
    const lockedTiles: Vec2[] = [];
    const lockedShapes: Vec2[][] = [];
    for (const other of state.units) {
      if (other.unitId === unit.unitId || !locked.has(other.unitId)) continue;
      if (other.owner !== (currentSeat()?.team ?? unit.owner)) continue;
      const theirs = drafts.get(other.unitId);
      if (theirs === undefined) continue;
      const theirDef = draftAbility(characterFor(other), theirs);
      if (theirDef === undefined) continue;
      const theirCovered = abilityPreview(map, other, theirDef, theirs.aim, theirs.aimStep);
      if (theirCovered.length === 0) continue;
      lockedTiles.push(...theirCovered);
      lockedShapes.push(...aimBoundaries(other, theirDef, theirs.aim, theirs.aimStep, theirCovered));
    }
    renderer.highlight('locked', lockedTiles, LOCKED, 0.28);
    renderer.drawShape(lockedShapes, LOCKED, 0.1, 'shapeLocked');

    // ── FREE-UI: the free ability's own aim, in its own layer ───────────────
    // Same reasoning as the catalyst layer below: a trap being placed and a
    // shot being lined up are two decisions on one turn, and a player has to be
    // able to see both at once or the additivity is invisible.
    const freeAim = previewFreeAim(map, state, unit, freeDef, draft, interaction);
    renderer.highlight(
      'free',
      freeDef !== undefined && freeAim.length > 0 ? abilityPreview(map, unit, freeDef, freeAim) : [],
      FREE,
      0.42,
    );

    // ── CAT2: the catalyst's own aim, in its own layer ──────────────────────
    // A catalyst is a separate slot, so it gets a separate overlay — a Shift's
    // destination and a Rail Shot's beam are two decisions on one turn and have
    // to be readable at the same time.
    const catalystAim = previewCatalystAim(map, state, unit, catalystDef, draft, interaction);
    renderer.highlight(
      'catalyst',
      catalystDef !== undefined && catalystAim.length > 0
        ? abilityPreview(map, unit, catalystDef, catalystAim)
        : [],
      CATALYST,
      0.42,
    );

    // ── PREVIEW-NUMBERS: what each armed action would do, before Lock In ─────
    // All three slots at once, because all three are armed at once and a player
    // deciding between two aims wants the turn's total on a unit, not one
    // ability's share of it. A dash's numbers come from its impact discs, which
    // is where the damage is actually dealt — the aimed square is only where it
    // lands. `previewNumbers` applies FF1 polarity, so an ally in your own AoE
    // gets a red number too.
    // PREVIEW-FOG: the same view the board is drawn from decides who may carry a
    // number, so the preview cannot contradict the fog beside it.
    const seen = new Set(currentFog(currentSeat()?.team ?? unit.owner).units.map((u) => u.unitId));
    // PREVIEW-MODIFIERS: the board goes in so the preview can ask the engine
    // about cover. Built here rather than cached because it is derived from
    // `map`, which never changes for a match — see the memo below it.
    showPreviewNumbers(previewNumbers(state, previewBoard(), unit, [
      // PREVIEW-NUMBERS-AUDIT: the interior bands ride along with the footprint,
      // so a tile in Cinder's core is written 22 and one in her ring 14.
      ...(chosen !== undefined
        ? [{
          def: chosen,
          squares: [...covered, ...impact.origin, ...impact.destination],
          axis: bands.axis,
          inner: bands.inner,
        }]
        : []),
      ...(freeDef !== undefined && freeAim.length > 0
        ? [{
          def: freeDef,
          squares: abilityPreview(map, unit, freeDef, freeAim),
          ...previewBandSets(map, unit, freeDef, freeAim),
        }]
        : []),
      ...(catalystDef !== undefined && catalystAim.length > 0
        ? [{
          def: catalystDef,
          squares: abilityPreview(map, unit, catalystDef, catalystAim),
          ...previewBandSets(map, unit, catalystDef, catalystAim),
        }]
        : []),
      // PREVIEW-DECOY: the fogged, per-viewer decoy list the board is already
      // drawn from. A decoy renders to the enemy as a real Wisp, so it has to
      // preview like one — the *absence* of a number is a tell that outs it.
    ], seen, currentFog(currentSeat()?.team ?? unit.owner).decoys));

    // ── AIM1 (+UI4): the drawn route as a LINE ───────────────────────────────
    // Shaded reachability says where you *could* go; only a line says which way
    // you chose and in what order. A DASH is the same indicator in yellow (UI4)
    // — it is still a route, so it gets route geometry rather than nothing, and
    // colour carries the fact that it resolves in a different phase.
    //
    // A CHASE (CHASE1) draws the same geometry to a different destination: the
    // route the engine would take toward the target *as this seat sees it*.
    // Dashed and in its own colour, because unlike a drawn move it is a
    // prediction — the target has not moved yet, and where it ends up is what
    // the chase actually resolves against.
    const chaseTarget = draft.chaseTargetId === undefined ? undefined : chaseableEnemies()
      .find((u) => u.unitId === draft.chaseTargetId);
    // CHASE-SPRINT: the drawn route has to use the budget the *engine* will use,
    // which for a chase is derived from the turn rather than taken from the
    // draft's sprint flag. Reading `draft.sprint` here drew a four-square route
    // for a chase that resolves over eight.
    const chaseRoute = chaseTarget === undefined
      ? []
      : pathTo(map, planned, unit, chaseTarget.pos,
        movementBudget(unit, chaseSprints(draft, dashCatalystArmed(draft))));
    const route = isDash
      ? dashRoute(unit, chosen, preview.aim)
      : chaseTarget !== undefined
        ? chaseRoute
        : previewMovePath(map, planned, unit, draft, interaction);
    renderer.drawPath(
      route.length > 0 ? [unit.pos, ...route] : [],
      isDash ? DASH_LINE : chaseTarget !== undefined ? CHASE_LINE : draft.sprint ? SPRINT_LINE : MOVE_LINE,
      !isDash && (draft.sprint || chaseTarget !== undefined),
    );
    // …and the quarry is ringed, so the order reads as "that one" rather than
    // as a line that happens to end near somebody.
    // WAYPOINT-TELL: the clicked squares, so a composed route says which corners
    // were the player's and which the router's. Only while that unit's route is
    // still the one on screen — a mark over somebody else's turn is a lie.
    renderer.highlight('waypoint', liveWaypointMarks(waypointMarks, draft.movePath), WAYPOINT, 0.85);
    renderer.highlight('chase', chaseTarget === undefined ? [] : [chaseTarget.pos], CHASE_LINE, 0.45);

    // ── DASH-CAT-ROUTE: a Dash catalyst is a reposition, so it draws like one ─
    // "Shift's dash catalyst should show as a yellow movement similar to other
    // dash/blinks." It used to show only as a catalyst-coloured tile, which
    // reads as an area effect rather than as "you end up there". Its own path
    // layer rather than the shared one, because a dash ability and a Shift can
    // both be drafted on the same turn and each is a separate reposition.
    // CAT-DASH-COST clears the drawn *move* when a Dash catalyst is armed, so
    // this yellow line is what replaces it.
    const catalystRoute = catalystDef?.phase === 'dash'
      ? dashRoute(unit, catalystDef, catalystAim)
      : [];
    renderer.drawPath(
      catalystRoute.length > 0 ? [unit.pos, ...catalystRoute] : [],
      DASH_LINE,
      false,
      'catalystPath',
    );
  }

  /** An ability (ult included) on a character by id — hover works off ids. */
  function findOnCharacter(character: CharacterDef, abilityId: string): AbilityDef | undefined {
    return [...character.abilities, character.ultimate].find((a) => a.id === abilityId);
  }

  function render(): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    renderPreviews();
    hud.update(hudModel(unit, draftFor(unit), characterFor(unit)));
    const seat = currentSeat();
    const roster = seatRoster();
    const done = roster.filter((u) => locked.has(u.unitId)).length;
    ui.status.textContent =
      `Turn ${state.turn} · ${teamName(seat?.team ?? 0)} · seat ${seat?.seatId ?? '?'}` +
      ` — ${characterFor(unit).name} (${done}/${roster.length} locked)`;
    renderScoreboard();
  }

  /**
   * SCORE1 — the in-match readout: both kill tallies against the format's
   * target, the clock, and a per-character strip. It sits in its own element so
   * it survives the HUD's in-place update, and it is rebuilt wholesale because
   * it is a handful of nodes with no hover state to preserve.
   */
  function renderScoreboard(): void {
    const bar = topbar(scoreReadout(state, unitName), currentSeat()?.team ?? 0, presence);
    scoreEl.replaceChildren();

    const strip = document.createElement('div');
    strip.className = 'topbar';
    strip.append(
      portraitRow(bar.friendly, bar.friendlyTeam, 'own'),
      scoreBlock(bar),
      portraitRow(bar.enemy, bar.enemyTeam, 'foe'),
    );
    scoreEl.appendChild(strip);
  }

  /**
   * One team's portraits. `side` only decides which way they pack, so the
   * friendly strip grows away from the centre and the enemy strip toward it —
   * AR's layout, and the reason your own team is always in the same place.
   */
  function portraitRow(
    portraits: readonly TopbarPortrait[],
    team: TeamId,
    side: 'own' | 'foe',
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = `topbar-team ${side}`;
    for (const p of portraits) {
      const cell = document.createElement('div');
      cell.className = p.alive ? 'topbar-portrait' : 'topbar-portrait dead';
      // TOOLTIP-SWEEP: `data-tip`, read by the delegated tooltip on `scoreEl`,
      // rather than `title` and the browser's second-long delay.
      cell.dataset['tip'] = p.alive ? `${p.name} — ${p.hp}/${p.maxHp}` : `${p.name} — down, back in ${p.respawnIn}`;
      // NET-PRESENCE-UI: two marks, and they are different facts. `away` says
      // this character's *player* is gone (the seat is held for them); `borrowed`
      // says the handoff has put them in your hands. A character can be both,
      // which is the whole point — the second explains the first.
      if (p.away) {
        cell.classList.add('away');
        cell.dataset['away'] = 'true';
        cell.dataset['tip'] = `${p.name} — ${AWAY_LABEL}`;
      }
      if (p.borrowed) {
        cell.classList.add('borrowed');
        cell.dataset['borrowed'] = 'true';
        cell.dataset['tip'] = `${cell.dataset['tip']} · you are ordering them`;
      }

      const face = document.createElement('div');
      face.className = 'topbar-face';
      face.style.borderColor = TEAM_CSS[team];
      // Down units show the respawn count in place of the initial: "how long
      // until they are back" is the only thing about a corpse worth knowing,
      // and it is the number the attrition read turns on.
      face.textContent = p.alive ? p.initial : String(p.respawnIn);
      if (p.alive) face.style.background = TEAM_CSS[team];
      if (p.ultReady) cell.classList.add('ult');

      const bar = document.createElement('div');
      bar.className = 'topbar-hp';
      const fill = document.createElement('div');
      fill.className = 'topbar-hp-fill';
      fill.style.width = `${p.hpPct}%`;
      bar.appendChild(fill);

      cell.append(face, bar);
      row.appendChild(cell);
    }
    return row;
  }

  /** Kills vs target for both teams, with the clock between them. */
  function scoreBlock(bar: TopbarModel): HTMLElement {
    const block = document.createElement('div');
    block.className = 'topbar-score';
    const own = document.createElement('span');
    own.className = 'topbar-kills';
    own.style.color = TEAM_CSS[bar.friendlyTeam];
    own.textContent = tally(bar.friendlyKills, bar.killTarget).replace(/ \/ .*/, '');
    const foe = document.createElement('span');
    foe.className = 'topbar-kills';
    foe.style.color = TEAM_CSS[bar.enemyTeam];
    foe.textContent = String(bar.enemyKills);
    const clockEl = document.createElement('span');
    clockEl.className = 'topbar-clock';
    // Sudden death is the one thing here that changes how a turn should be
    // played, so it replaces the clock rather than sitting beside it. Turn X of
    // Y stays load-bearing otherwise — it is the clock the Support anti-stall
    // balance depends on.
    clockEl.textContent = bar.suddenDeath ? 'SUDDEN DEATH' : clock(bar.turn, bar.turnLimit);
    const target = document.createElement('span');
    target.className = 'topbar-target';
    target.textContent = `first to ${bar.killTarget}`;
    block.append(own, clockEl, foe, target);
    return block;
  }

  /** A unit's character name, for the scoreboard and the end screen. */
  function unitName(unitId: string): string {
    const u = unitById(unitId);
    return u === undefined ? unitId : roster[u.characterId]?.name ?? unitId;
  }

  /** One character as the HUD's view of it — presentation data only. */
  function hudCharacter(unit: UnitState): HudCharacter {
    const character = characterFor(unit);
    return {
      unitId: unit.unitId,
      name: character.name,
      archetype: character.archetype,
      colour: unit.owner === 0 ? TEAM_CSS[0] : TEAM_CSS[1],
      hp: unit.hp,
      maxHp: unit.maxHp,
      energy: unit.energy,
      shield: shieldOf(unit),
      locked: locked.has(unit.unitId),
      hasOrder: draftHasOrder(draftFor(unit)),
      // BUFF-UI. Same source as the plate's icon row (`statusPips`) and the
      // same order, so the strip and the row cannot disagree about what is on a
      // character — this one just spells it out.
      statuses: statusChips(unit.statuses),
    };
  }

  function hudModel(unit: UnitState, draft: OrderDraft, character: CharacterDef): HudModel {
    const roster = seatRoster();
    // The last unlocked character of the last seat is the one whose Lock In
    // actually resolves the turn — say so, rather than surprising the player.
    const last = seatIdx === seats.length - 1
      && roster.every((u) => u.unitId === unit.unitId || locked.has(u.unitId));
    return {
      active: hudCharacter(unit),
      roster: roster.map(hudCharacter),
      // `abilityOptions` already answers availability and why — never re-derived.
      abilities: abilityOptions(unit, character).map((opt) => ({
        id: opt.def.id,
        name: opt.def.name,
        isUlt: opt.isUlt,
        // CAT-DASH-FULL: a Dash catalyst is the whole active turn, so the normal
        // hotbar goes dark with Move and Sprint. Free abilities are exempt —
        // they are a separate free action and the ruling leaves them alone.
        available: opt.available
          && (opt.def.free === true || abilitiesAllowed(dashCatalystArmed(draft))),
        reason: opt.available && !abilitiesAllowed(dashCatalystArmed(draft)) && opt.def.free !== true
          ? 'catalyst' as const
          : opt.reason,
        cooldown: opt.cooldown,
        // A free ability lives in its own slot, so it is "selected" from the
        // free draft — never from `abilityId`, which it must never occupy.
        selected: opt.def.free === true ? draft.freeAbilityId === opt.def.id : draft.abilityId === opt.def.id,
        free: opt.def.free === true,
        def: opt.def,
      })),
      // BASIC-MODES: the armed ability's two profiles, or nothing. Derived from
      // the *resolved* ability (`draftAbility` already applied the mode), so the
      // row and the preview can never disagree about which one is live.
      modes: modeOptions(draftAbility(character, draft), draft.mode),
      // WALL-ROTATE: four cardinals for a placed shape, empty for everything
      // else. Read off the *resolved* ability for the same reason `modes` is.
      rotations: rotationOptions(draftAbility(character, draft), draft.aimStep),
      // Three slots, in phase order, read straight off the unit — `catalystsUsed`
      // is the engine's answer, so a slot can never grey out for the wrong reason.
      catalysts: unit.catalysts.flatMap((id) => {
        const def = catalysts[id];
        return def === undefined ? [] : [{
          id,
          name: def.name,
          phase: def.phase,
          cost: catalystCost(def),
          spent: unit.catalystsUsed.includes(id),
          selected: draft.catalystId === id,
          def,
        }];
      }),
      move: {
        // A Dash catalyst buys its effect with the Move (CAT-DASH-COST), so the
        // budget reads 0 rather than 4 — the number has to say what you will
        // actually get, or the cost is invisible until the turn resolves.
        // WAYPOINTS: what is **left**, not what you started with. Each accepted
        // waypoint spends its step (1 orthogonal, 2 diagonal), so the number the
        // player watches is the one the engine will charge them.
        budget: dashCatalystArmed(draft) ? 0 : remainingMove(unit, draft.sprint, draft.movePath),
        drawing: interaction.mode === 'move',
        sprinting: draft.sprint,
        // Sprint is move-only (GAME_SPEC §2) — but a FREE ability is not the
        // turn's ability, so it must not disable it. Keying this off the wrong
        // field is how "I cannot sprint after placing my trap" happened. A Dash
        // catalyst does disable it: it is no longer a free action.
        sprintDisabled: !sprintAllowed(draft, dashCatalystArmed(draft)),
      },
      // CHASE1. Disabled for exactly the reasons the engine would drop the
      // order anyway: a dash ability or a Dash catalyst already owns the
      // reposition, and there is nobody visible to chase.
      chase: {
        armed: interaction.mode === 'chase' || draft.chaseTargetId !== undefined,
        disabled: currentIsDash(draft, character) || dashCatalystArmed(draft) || chaseableEnemies().length === 0,
        targetName: draft.chaseTargetId === undefined
          ? undefined
          : roster0(draft.chaseTargetId)?.name,
      },
      lock: { label: last ? 'Lock In & resolve ⚔' : 'Lock In ▸' },
      view: {
        projection: projection === 'isometric' ? 'Isometric' : 'Top-down',
        orbit: renderer.orbitEnabled(),
      },
    };
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  const currentIsDash = (draft: OrderDraft, character: CharacterDef): boolean =>
    draftAbility(character, draft)?.phase === 'dash';

  /**
   * Is the draft holding a Dash catalyst? Since CAT-DASH-COST that is no longer
   * a free rider — it spends the Move — so it gates Sprint and the move budget
   * exactly as a dash ability does.
   */
  const dashCatalystArmed = (draft: OrderDraft): boolean => {
    const def = draft.catalystId !== undefined ? catalysts[draft.catalystId] : undefined;
    return def !== undefined && catalystCost(def) === 'action';
  };

  /**
   * Arm a **free** ability (FREE-UI): its own slot, its own aim, additive with
   * everything else the turn does. Mirrors `selectCatalyst` exactly, because
   * they are the same mechanic — one free action, declared beside your turn
   * rather than instead of it.
   */
  function selectFreeAbility(unit: UnitState, def: AbilityDef): void {
    const draft = nextDraft(draftFor(unit), { type: 'selectFreeAbility', abilityId: def.id }, false);
    if (draft.freeAbilityId !== undefined && def.shape === 'self') draft.freeAim = [{ ...unit.pos }];
    drafts.set(unit.unitId, draft);
    interaction = arm(draft.freeAbilityId !== undefined && def.shape !== 'self' ? 'free' : 'idle');
    render();
  }

  function selectAbility(abilityId: string): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    const character = characterFor(unit);
    const prev = draftFor(unit);
    const chosen = draftAbility(character, { ...prev, abilityId });
    if (chosen !== undefined && isFreeAbility(chosen)) return void selectFreeAbility(unit, chosen);
    const isDash = chosen?.phase === 'dash';
    // Choosing another ability before Lock In simply replaces the last one
    // (UI1) — `nextDraft` owns the exclusivity rules (sprint, dash-owns-move).
    const draft = nextDraft(
      prev,
      { type: 'selectAbility', abilityId, isDash },
      isDash,
      dashCatalystArmed(prev),
    );
    if (chosen && chosen.shape === 'self') draft.aim = [{ ...unit.pos }];
    draft.aimStep = undefined;
    drafts.set(unit.unitId, draft);
    // A self-cast has nowhere to point, so it is committed by selecting it;
    // everything else arms aim mode and waits for the confirming board click.
    interaction = arm(chosen && chosen.shape !== 'self' ? 'aim' : 'idle');
    render();
  }

  /**
   * Pick (or un-pick) a catalyst. It is a **separate slot** from the normal
   * ability — selecting one leaves the chosen ability, its aim and any drawn
   * move exactly where they were. Treating the two as one choice is the same
   * mutual-exclusivity trap MS1 fixed for move-and-shoot, and it would make the
   * mechanic unreachable: a catalyst you can only use *instead* of your turn is
   * not a free action.
   */
  function selectCatalyst(catalystId: string): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    const def = catalysts[catalystId];
    if (def === undefined || unit.catalystsUsed.includes(catalystId)) return;
    const prev = draftFor(unit);
    const draft = nextDraft(
      prev,
      { type: 'selectCatalyst', catalystId, isDash: def.phase === 'dash' },
      false,
      dashCatalystArmed(prev),
    );
    // A self-cast has nowhere to point; a Shift or a Suppression needs a square,
    // so the board click that follows lands in the catalyst's own aim slot.
    if (draft.catalystId !== undefined && def.shape === 'self') draft.catalystAim = [{ ...unit.pos }];
    drafts.set(unit.unitId, draft);
    interaction = arm(draft.catalystId !== undefined && def.shape !== 'self' ? 'catalyst' : 'idle');
    render();
  }

  /**
   * Enemies this seat may currently chase (CHASE1): the ones it can actually
   * see. The engine drops a chase against a never-seen target, and offering one
   * the player cannot see would either be a dead control or — worse — a way to
   * confirm somebody is out there. The list comes from `currentFog`, the same
   * view that decides what is drawn, so the affordance and the fog can never
   * disagree about who is on screen.
   */
  function chaseableEnemies(): UnitState[] {
    const me = selectedUnit();
    if (me === undefined) return [];
    const shown = new Set(currentFog(me.owner).units.map((u) => u.unitId));
    return state.units.filter((u) => u.alive && u.owner !== me.owner && shown.has(u.unitId));
  }

  /** A chaseable enemy's display name, for the HUD's "Chase <name>" label. */
  const roster0 = (unitId: string): CharacterDef | undefined => {
    const u = unitById(unitId);
    return u === undefined ? undefined : roster[u.characterId];
  };

  /** Arm chase mode: the next board click on a visible enemy sets the target. */
  function armChase(): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    interaction = arm('chase');
    render();
  }

  function selectMove(sprint: boolean): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    const prev = draftFor(unit);
    const wasDash = currentIsDash(prev, characterFor(unit));
    drafts.set(unit.unitId, nextDraft(
      prev,
      { type: sprint ? 'selectSprint' : 'selectMove' },
      wasDash,
      dashCatalystArmed(prev),
    ));
    interaction = arm('move');
    render();
  }

  /**
   * A board click CONFIRMS the armed action (UI1) — it does not end the turn.
   * It also **disarms** (UI1-fix): the aim stops following the mouse and the
   * committed order is what stays on screen. Re-aim by re-selecting the ability.
   */
  function onBoardClick(evt: MouseEvent): void {
    // M3-WAIT-STATE: a sent turn is not re-aimable. The board disarms rather
    // than quietly accepting clicks that will never be submitted — "it let me
    // change my order and then ignored it" is worse than a locked board.
    if (banner !== undefined) return;
    const sq = renderer.squareFromPoint(evt.clientX, evt.clientY);
    if (!sq) return;
    const unit = selectedUnit();
    if (unit === undefined) return;
    const draft = draftFor(unit);

    // WAYPOINTS-FIX: a Shift-click is a waypoint before it is anything else,
    // and it **arms move by itself** — the shipped version only ran once move
    // was already armed, which is why the reported gesture did nothing. The
    // aiming modes still win (`waypointClick` returns 'ignore' for them), so
    // this cannot steal a click from an aim in progress.
    const waypoint = waypointClick(interaction, draft, evt.shiftKey, unit.alive);
    if (waypoint !== 'ignore') {
      if (waypoint === 'armAndAppend') {
        drafts.set(unit.unitId, nextDraft(
          draft, { type: 'selectMove' }, currentIsDash(draft, characterFor(unit)), dashCatalystArmed(draft),
        ));
        interaction = arm('move');
      }
      // MOVE-FOG: segments route against the team-visible board, like every
      // other plan-time query — a fogged enemy is not an obstacle you know about.
      const planned = planningState(state, currentFog(currentSeat()?.team ?? unit.owner).units);
      const live = draftFor(unit);
      const extended = appendWaypointRouted(map, planned, unit, live.movePath, sq, live.sprint);
      // Every click answers: the route grows, or the square is marked. Silence
      // is what made the shipped version look broken.
      if (extended === undefined) refusedSquare = { x: sq.x, y: sq.y };
      else {
        live.movePath = extended;
        refusedSquare = undefined;
        // WAYPOINT-TELL: mark the square that was clicked, not the whole
        // segment — the marks are the decisions, the line is the route.
        waypointMarks = [...waypointMarks, { x: sq.x, y: sq.y }];
      }
      render();
      return;
    }
    refusedSquare = undefined;

    // AIM-RANGE: every slot commits through `commitAim`, which returns nothing
    // for an out-of-range click. The slot then stays armed rather than
    // recording an order the engine will silently drop at resolution — the
    // behaviour that made Blink and Intercept look like they had no range.
    if (interaction.mode === 'aim') {
      const ability = draftAbility(characterFor(unit), draft);
      if (ability === undefined) return;
      // Exactly the aim the hover was already painting — one resolver, so what
      // you saw is what you committed.
      // WALL-ROTATE: the draft's rotation goes in so the committed wall is the
      // one the hover was drawing, and comes back out on `committed.aimStep`.
      const committed = commitAim(map, state, unit, ability, sq, draft.aimStep);
      if (committed === undefined) return;
      draft.aim = committed.aim;
      draft.aimStep = committed.aimStep;
      interaction = afterCommit();
      render();
    } else if (interaction.mode === 'free') {
      const def = draftFreeAbility(characterFor(unit), draft);
      if (def === undefined) return;
      const committed = commitAim(map, state, unit, def, sq);
      if (committed === undefined) return;
      draft.freeAim = committed.aim;
      interaction = afterCommit();
      render();
    } else if (interaction.mode === 'catalyst') {
      const def = draft.catalystId !== undefined ? catalysts[draft.catalystId] : undefined;
      if (def === undefined) return;
      const committed = commitAim(map, state, unit, def, sq);
      if (committed === undefined) return;
      draft.catalystAim = committed.aim;
      interaction = afterCommit();
      render();
    } else if (interaction.mode === 'chase') {
      // A chase names a UNIT, so the click resolves to whoever is standing on
      // the square — and only if this seat can see them. Clicking empty ground
      // leaves the mode armed rather than silently dropping the order.
      const target = chaseableEnemies().find((u) => u.pos.x === sq.x && u.pos.y === sq.y);
      if (target === undefined) return;
      const next = nextDraft(
        draft,
        { type: 'selectChase', targetUnitId: target.unitId },
        currentIsDash(draft, characterFor(unit)),
        dashCatalystArmed(draft),
      );
      drafts.set(unit.unitId, next);
      interaction = afterCommit();
      render();
    } else if (interaction.mode === 'move' || draft.sprint) {
      // MOVE-FOG: the committed path is planned against the visible board too —
      // otherwise the preview and the order would disagree, and the order would
      // be the one that leaked.
      // Without Shift this is the ordinary direct-line auto-route (MOVE1),
      // unchanged: it replaces the drawn path rather than extending it.
      const planned = planningState(state, currentFog(currentSeat()?.team ?? unit.owner).units);
      draft.movePath = pathTo(map, planned, unit, sq, movementBudget(unit, draft.sprint));
      // A plain click **replaces** the route, so the marks from a composed one
      // go with it — leaving them would label squares this path never visits.
      waypointMarks = [];
      interaction = afterCommit();
      render();
    }
  }

  /**
   * Board hover (UI1): while a mode is armed, the pointer's square previews the
   * action live — the cone/line rotates with the mouse (the old AIM2-UX), a
   * circle follows it, a drawn route re-routes. **The draft is not touched**;
   * `renderPreviews` reads `interaction.hover.square` and paints from that.
   *
   * Once an action is committed the mode is idle, so this early-returns and the
   * committed order is left alone.
   */
  function onBoardHover(evt: MouseEvent): void {
    const square = renderer.squareFromPoint(evt.clientX, evt.clientY);
    // UI-INSPECT runs whether or not an action is armed, and before the
    // early-returns below: inspecting is reading, not planning, and a player
    // with nothing selected is exactly the player asking "what is that".
    showInspect(square, evt.clientX, evt.clientY);
    if (selectedUnit() === undefined) return;
    const next = hoverBoard(interaction, square, evt.shiftKey);
    if (next === undefined) return; // same tile, or nothing armed: no repaint
    interaction = next;
    renderPreviews();
  }

  /**
   * UI-INSPECT — the panel for whatever is under the pointer, or nothing.
   *
   * The vision gate is **structural**: the candidates are the units and decoys
   * `fogView` already handed the renderer, so a fogged or stealthed enemy is not
   * in the list to be found. There is no visibility branch here that could be
   * written the wrong way round, which is the only way to be sure the most
   * detailed panel on screen never becomes the leak.
   */
  function showInspect(square: Vec2 | undefined, x: number, y: number): void {
    if (square === undefined) return hud.inspect(undefined);
    const viewer = currentSeat()?.team ?? 0;
    const view = currentFog(viewer);

    const unit = view.units.find((u) => u.alive && u.pos.x === square.x && u.pos.y === square.y);
    if (unit !== undefined) {
      return hud.inspect(inspectUnit(unit, roster, catalysts, viewer), { x, y });
    }

    // A decoy answers inspection **as the character it is pretending to be**,
    // from the cast snapshot. Never live and never a refusal: "this one won't
    // open" is a perfect tell, and the louder of the two ways to be outed.
    const decoy = view.decoys.find((d) => d.pos.x === square.x && d.pos.y === square.y);
    if (decoy !== undefined && decoy.asEnemy) {
      const snapshot = decoySnapshots.get(decoy.id) ?? snapshotDecoy(state.units, roster, decoy.owner);
      const panel = snapshot === undefined
        ? undefined
        : inspectDecoy(snapshot, roster, catalysts, decoy.owner);
      return hud.inspect(panel, { x, y });
    }

    hud.inspect(undefined);
  }

  // ── Turn resolution + playback ───────────────────────────────────────────────

  /** This board's drafts, as `UnitOrders`, keyed by the seat that owns them. */
  function collectOrders(): Map<string, UnitOrders[]> {
    const ordersBySeat = new Map<string, UnitOrders[]>();
    for (const seat of seats) {
      const units = seat.unitIds
        .map((uid) => {
          const draft = drafts.get(uid);
          const unit = unitById(uid);
          return draft && unit ? toUnitOrders(roster[unit.characterId]!, draft) : undefined;
        })
        .filter((o): o is UnitOrders => o !== undefined);
      if (units.length > 0) ordersBySeat.set(seat.seatId, units);
    }
    return ordersBySeat;
  }

  /**
   * M3-NET-BOARD — end the turn the way this match ends turns.
   *
   * The hot-seat resolves locally because it *is* both sides. A networked client
   * is one seat of two and **may not resolve anything**: it sends its orders and
   * waits for the server's `turnResolved`, which arrives already filtered for
   * this team. The whole difference between the two matches is this fork —
   * everything downstream (the log, the playback, the camera) is fed the same
   * `(prev, events, next)` either way, which is what keeps one renderer honest
   * about two very different sources of truth.
   */
  async function endTurn(): Promise<void> {
    const ordersBySeat = collectOrders();
    if (net !== undefined) {
      // M3-TIMER: the clock is **not** stopped here, unlike the hot-seat's. The
      // window is the room's, not this seat's, and it is still running — it is
      // now what bounds the opponent. That is the pairing the item asks for:
      // the banner says what you are waiting for, the countdown says how long
      // it can last, and neither is the other.
      //
      // Disarmed before the send, not after the reply: the click that ends the
      // turn must not leave a live aim on screen while the packet is in flight.
      interaction = IDLE;
      net.submit(ordersBySeat.get(net.seatId) ?? []);
      render();
      return;
    }
    const prev = state;
    const result = resolveTurn(prev, map, mergeSeatOrders(seats, ordersBySeat), roster, catalysts);
    await playResolution(prev, result.events, result.state);
  }

  /**
   * Fold one resolved turn into the board: the log, the decoy snapshots, the
   * animation, and the next Decision phase.
   *
   * Source-agnostic on purpose. `resolveTurn` produced these three arguments in
   * a hot-seat match and the **server** produced them in a networked one, and
   * nothing below this line can tell — which is exactly the property that lets a
   * networked match render on the board the hot-seat already drew.
   */
  async function playResolution(prev: GameState, events: TurnEvent[], next: GameState): Promise<void> {
    const result = { state: next, events };
    // The log is written from the resolved event list up front, so it is
    // complete whether the player watches the animation or skips it.
    combatLog?.appendTurn(prev.turn, result.events, logNames);

    // UI-NAMEPLATES: freeze each new decoy's fake plate at the cast, and forget
    // the ones that expired. `prev` is the pre-turn state, which is the caster
    // as it stood when the decoy was placed — Veil & Decoy is a Prep-phase free
    // action, so nothing has happened to it yet. (A caster hurt by a Prep AoE
    // in the same turn would freeze one tick early; the alternative is
    // threading the playback fold back into here for a difference no player can
    // see.) Expired ids are dropped so the map cannot grow for the whole match.
    const stillThere = new Set(result.state.decoys.map((d) => d.id));
    const nextSnapshots = new Map([...decoySnapshots].filter(([id]) => stillThere.has(id)));
    for (const event of result.events) {
      if (event.type !== 'decoySpawned') continue;
      const snapshot = snapshotDecoy(prev.units, roster, event.teamId);
      if (snapshot !== undefined) nextSnapshots.set(event.decoyId, snapshot);
    }
    decoySnapshots = nextSnapshots;

    // The player owns state — its fold IS the board, so skipping and watching
    // agree by construction. Everything below only *decorates* that fold:
    // fractional positions, alpha, which squares glow. Drop every frame of it
    // and the board still lands in the same place.
    const player = createTurnPlayer(prev, result.events);
    // The turn stops being a plan the instant it resolves, so the plan-time
    // numbers go with the aim overlays rather than lingering over the playback.
    clearPreviewNumbers();
    for (const layer of PLANNING_LAYERS) renderer.highlight(layer, [], 0);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.drawPath([], DASH_LINE, false, 'catalystPath');
    for (const shapeLayer of PLANNING_SHAPE_LAYERS) renderer.drawShape([], SHAPE, 0, shapeLayer);
    renderer.show(viewUnits(player.view), viewDecoys(player.view), viewTraps(player.view), pads(player.view));

    let skipped = false;
    const finish = (): void => {
      phaseLabel.style.display = 'none';
      renderer.setSpotlight(null);
      renderer.focusOn([]); // skipping must return the camera too, not leave it mid-push

      renderer.highlight('aim', [], AIM);
      renderer.highlight('select', [], IMPACT);
      clearReadouts();
      renderer.show(viewUnits(player.view), viewDecoys(player.view), viewTraps(player.view), pads(player.view));
      renderer.highlight('camo', viewCamo(player.view), CAMO_RED, CAMO_OPACITY);
    };
    // The plan is committed, so its deadline is history. A clock still ticking
    // over a resolving turn is a lie about what the player can still do.
    stopTimer();
    hud.showPlayback(() => {
      skipped = true;
      player.skip();
      finish();
    });

    for (let step = player.advancePhase(); step !== undefined; step = player.advancePhase()) {
      ui.status.textContent = `Turn ${prev.turn} · resolving — ${step.phase.toUpperCase()}`;
      if (skipped) continue; // keep folding; just stop animating
      await animatePhase(
        player.cues, step.phase,
        viewUnits(player.view), viewDecoys(player.view), viewTraps(player.view), viewCamo(player.view),
        pads(player.view),
        () => skipped,
      );
    }
    finish();

    state = result.state;
    // SCORE1 — the damage/healing ledger is folded from the same log playback
    // just consumed, so the scoreboard and the animation can never describe
    // different turns.
    totals = foldTurn(totals, result.events);
    if (state.status !== 'active') return renderGameOver();
    beginTurn();
  }

  /**
   * Play one phase's slice of the cue timeline in real time. The renderer is a
   * dumb applier: `sampleFrame` (pure, tested) says what the board should look
   * like at time `t`, and this pushes that into scene objects.
   *
   * `units` is the view *after* the phase was folded — HP and aliveness are
   * already final, which is what makes the deferred-death fade the only thing
   * standing between a dead unit and looking dead.
   */
  async function animatePhase(
    cues: readonly Cue[],
    phase: Phase,
    units: RenderUnit[],
    decoys: RenderDecoy[],
    traps: RenderTrap[],
    camo: Vec2[],
    padList: PadView[],
    cancelled: () => boolean,
  ): Promise<void> {
    const { start, end } = phaseWindow(cues, phase);
    renderer.show(units, decoys, traps, padList);
    renderer.highlight('camo', camo, CAMO_RED, CAMO_OPACITY);
    phaseLabel.textContent = phase.toUpperCase();
    phaseLabel.style.display = 'block';
    const posOf = (unitId: string): Vec2 | undefined => units.find((u) => u.unitId === unitId)?.pos;
    const t0 = now();

    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (cancelled()) return resolve();
        const t = start + (now() - t0) / MS_PER_BEAT;
        applyFrame(sampleFrame(cues, Math.min(t, end)), units, posOf);
        if (t >= end) return resolve();
        globalThis.requestAnimationFrame(tick);
      };
      globalThis.requestAnimationFrame(tick);
    });
  }

  /** Push one sampled `Frame` into the renderer. No game state is read here. */
  function applyFrame(frame: Frame, units: RenderUnit[], posOf: (id: string) => Vec2 | undefined): void {
    for (const [unitId, pose] of frame.poses) renderer.setUnitAt(unitId, pose.x, pose.y, pose.lift);
    for (const u of units) renderer.setUnitFade(u.unitId, frame.fades.get(u.unitId) ?? 1);
    renderer.setSpotlight(frame.spotlight);
    renderer.highlight('aim', frame.areas, AIM, 0.45);
    // A hit is one beat of glow under the victim — the only feedback that says
    // *this* unit is the one being hit right now. Mid-tween victims are lit
    // where they currently *are*, not where the fold left them.
    const squareOf = (id: string): Vec2 | undefined => {
      const pose = frame.poses.get(id);
      return pose !== undefined ? { x: Math.round(pose.x), y: Math.round(pose.y) } : posOf(id);
    };
    renderer.highlight('select', frame.impacts.map(squareOf).filter((p): p is Vec2 => p !== undefined), IMPACT, 0.55);
    if (frame.phase !== undefined) phaseLabel.textContent = frame.phase.toUpperCase();
    renderer.focusOn(focusSquares(frame, posOf));
    showReadouts(frame.readouts, squareOf);
  }

  /**
   * Paint UI5's floating numbers. Nodes are keyed and reconciled — a readout
   * lives for a couple of beats, so rebuilding the layer every frame would
   * restart its CSS transition on each one.
   */
  function showReadouts(readouts: readonly Readout[], squareOf: (id: string) => Vec2 | undefined): void {
    const live = new Set<string>();
    for (const r of readouts) {
      // One node per (unit, kind, amount): a hit and the shield that ate part of
      // it are two separate numbers on the same unit, and both should show.
      const key = `${r.unitId}:${r.kind}:${r.amount}`;
      live.add(key);
      let node = readoutNodes.get(key);
      if (node === undefined) {
        node = document.createElement('div');
        node.className = `readout ${r.kind}`;
        node.textContent = READOUT_TEXT[r.kind](r.amount);
        readoutLayer.appendChild(node);
        readoutNodes.set(key, node);
      }
      const square = squareOf(r.unitId);
      const at = square === undefined ? undefined : renderer.screenPosition(square.x, square.y, READOUT_LIFT);
      if (at === undefined) { node.style.display = 'none'; continue; }
      node.style.display = '';
      // Rise and fade with age, so several numbers on one unit stack visibly
      // instead of overprinting.
      node.style.left = `${at.x.toFixed(1)}px`;
      node.style.top = `${(at.y - r.age * READOUT_RISE_PX).toFixed(1)}px`;
      node.style.opacity = `${(1 - r.age * r.age).toFixed(3)}`;
    }
    for (const [key, node] of readoutNodes) {
      if (!live.has(key)) { node.remove(); readoutNodes.delete(key); }
    }
  }

  function clearReadouts(): void {
    for (const node of readoutNodes.values()) node.remove();
    readoutNodes.clear();
  }

  /**
   * PREVIEW-NUMBERS: the plan-time floats. Same layer and same three colours as
   * UI5's resolution readouts — a player should not have to learn red twice —
   * but marked `.preview` so "will happen" and "just happened" are still
   * distinguishable, and pinned rather than rising, because nothing has happened
   * yet for them to rise away from.
   */
  function showPreviewNumbers(numbers: readonly PreviewNumber[]): void {
    livePreviews = numbers;
    const live = new Set<string>();
    let index = 0;
    for (const n of numbers) {
      const key = `${n.targetId}:${n.kind}`;
      live.add(key);
      let node = previewNodes.get(key);
      if (node === undefined) {
        node = document.createElement('div');
        node.className = `readout preview ${n.kind}`;
        readoutLayer.appendChild(node);
        previewNodes.set(key, node);
      }
      node.textContent = PREVIEW_TEXT[n.kind](n.amount);
      node.dataset['slot'] = String(index++);
    }
    for (const [key, node] of previewNodes) {
      if (!live.has(key)) { node.remove(); previewNodes.delete(key); }
    }
    placePreviewNumbers();
  }

  /**
   * Re-anchor the previews to the current camera. Called every drawn frame:
   * `focusOn` eases the camera back out when planning resumes, so a number
   * placed once would sit next to its unit rather than over it for a second.
   */
  function placePreviewNumbers(): void {
    if (previewNodes.size === 0) return;
    // Several colours on one unit stack upward rather than overprinting.
    const stack = new Map<string, number>();
    for (const n of livePreviews) {
      const node = previewNodes.get(`${n.targetId}:${n.kind}`);
      if (node === undefined) continue;
      // The anchor rides on the number itself: half the targets are decoys, and
      // a decoy is deliberately not in `state.units` to look up (edge-cases R2).
      const at = renderer.screenPosition(n.pos.x, n.pos.y, READOUT_LIFT);
      if (at === undefined) { node.style.display = 'none'; continue; }
      const tier = stack.get(n.targetId) ?? 0;
      stack.set(n.targetId, tier + 1);
      node.style.display = '';
      node.style.left = `${at.x.toFixed(1)}px`;
      node.style.top = `${(at.y - tier * PREVIEW_STACK_PX).toFixed(1)}px`;
    }
  }

  function clearPreviewNumbers(): void {
    livePreviews = [];
    for (const node of previewNodes.values()) node.remove();
    previewNodes.clear();
  }

  function renderGameOver(): void {
    clearPreviewNumbers();
    const revealed = revealedView(state, currentSeat()?.team ?? 0);
    renderer.show(toRenderUnits(revealed.units, currentSeat()?.team ?? 0), revealed.decoys, revealed.traps, pads());
    for (const layer of PLANNING_LAYERS) renderer.highlight(layer, [], 0);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.drawPath([], DASH_LINE, false, 'catalystPath');
    for (const shapeLayer of PLANNING_SHAPE_LAYERS) renderer.drawShape([], SHAPE, 0, shapeLayer);
    renderer.setSpotlight(null);
    renderer.fitBoard();
    stopTimer();
    hud.clear();
    const result = matchBreakdown(state, unitName, totals);
    ui.status.textContent = endReasonText(result);
    // SCORE1's end-of-match breakdown: what each character actually did, from
    // the folded log. It replaces the scoreboard rather than sitting under it —
    // the tally it was showing is now the final score on the line above.
    scoreEl.replaceChildren();
    const table = document.createElement('table');
    table.className = 'score-table';
    const header = document.createElement('tr');
    for (const h of ['', 'Kills', 'Deaths', 'Dmg dealt', 'Dmg taken', 'Healing']) {
      const th = document.createElement('th');
      th.textContent = h;
      header.appendChild(th);
    }
    table.appendChild(header);
    for (const row of result.rows) {
      const tr = document.createElement('tr');
      const cells = [row.name, row.kills, row.deaths, row.damageDealt, row.damageTaken, row.supportGiven];
      for (const [i, value] of cells.entries()) {
        const td = document.createElement('td');
        td.textContent = String(value);
        if (i === 0) td.style.color = TEAM_CSS[row.owner];
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    scoreEl.appendChild(table);

    // M3-END-SCREEN — the two things a decided match was missing.
    //
    // The breakdown above already says *what* happened; a networked seat also
    // needs to know whether it won, because "Team 2 wins on kills" does not tell
    // a player which team they were. The headline is therefore per-seat and
    // exists only where a seat does — a hot-seat holds both sides on one screen,
    // and its neutral team line is already the right sentence.
    const outcome = outcomeFor(state, net?.team ?? currentSeat()?.team ?? 0);
    if (outcome !== undefined && net !== undefined) {
      const headline = document.createElement('h2');
      headline.className = `end-headline is-${outcome}`;
      headline.dataset['outcome'] = outcome;
      headline.textContent = endHeadline(outcome);
      scoreEl.prepend(headline);
    }
    // …and a way out, however it ended. The front door rather than a rematch:
    // re-entering a room is a protocol conversation nobody has specced, and the
    // create form is one click from a new match.
    const exit = document.createElement('a');
    exit.className = 'end-exit';
    exit.dataset['action'] = 'exit';
    exit.href = net === undefined ? HOT_SEAT_DOOR : FRONT_DOOR;
    exit.textContent = exitLabel(net !== undefined);
    scoreEl.appendChild(exit);
  }

  const teamName = (t: number) => (t === 0 ? 'Team 1' : 'Team 2');

  // M3-NET-BOARD: a resolution can arrive at any moment once this client has
  // submitted, so the handler is registered before the first turn opens. It
  // feeds the server's `(state, events)` into exactly the playback the hot-seat
  // uses — the board cannot tell which produced them, which is the property
  // that lets one renderer serve both matches.
  net?.onResolved((next, events) => { void playResolution(state, events, next); });
  // M3-TIMER: the countdown is the server's window, adopted. Registered
  // alongside `onStatus` and kept separate from it on purpose — the banner and
  // the clock are two different sentences about the same wait, and a single
  // handler would sooner or later let one overwrite the other.
  net?.onTimer((remaining, charges) => { adoptWindow(remaining, charges); });
  // M3-RECONNECT: the control map is the server's and can change mid-match.
  // Replaced in place rather than rebuilt, because `seatRoster` and
  // `collectOrders` both read `seat.unitIds` fresh — so the next turn opens
  // drafts for whatever this seat now holds, and drafts for characters it has
  // handed back simply stop being collected.
  // NET-PRESENCE-UI: a repaint, because the marks live on the topbar and the
  // topbar is rebuilt wholesale. Registered before `onControl` so a frame that
  // changes both leaves the strip agreeing with the seat.
  net?.onPresence((next) => {
    presence = next;
    renderScoreboard();
  });
  net?.onControl((unitIds) => {
    const seat = seats[0];
    if (seat === undefined) return;
    seats[0] = { ...seat, unitIds: [...unitIds] };
  });
  net?.onStatus((text) => {
    banner = text;
    hud.setBanner(text);
    // A locked board keeps nothing armed: the next repaint would otherwise
    // paint a hover over a turn that has already gone.
    if (text !== undefined) interaction = IDLE;
    render();
  });

  beginTurn();

  // …and re-fit once more, now that the top strip has actually been drawn.
  //
  // Both earlier calls run before `beginTurn` fills the scoreboard, so they
  // measure an empty element and fall back to `TOP_CHROME_FALLBACK_PX`. That was
  // harmless while the strip was two lines of text — the fallback was *larger*
  // than the real thing, so the board was framed conservatively. UI-TOPBAR's
  // portrait row is taller than the fallback, and a camera framing the board
  // into a region that starts above the chrome puts the top rank underneath it.
  //
  // The fallback stays for the first pass (nothing has laid out yet); this is
  // the measurement that replaces it.
  sizeToViewport();
  fitCamera();
}
