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
  type UnitOrders,
  type UnitState,
  type Vec2,
} from '@cards/engine';
import { createRenderer, type ProjectionName, type RenderDecoy, type RenderUnit, type Renderer } from './renderer3d.js';
import { createTurnPlayer } from './turn-player.js';
import { focusSquares, phaseWindow, sampleFrame, type Frame, type Readout } from './animate.js';
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
  type Interaction,
} from './order-mode.js';
import {
  abilityOptions,
  abilityPreview,
  impactPreview,
  abilityTooltip,
  aimFor,
  commitAim,
  dashRoute,
  draftAbility,
  draftFreeAbility,
  isFreeAbility,
  draftHasOrder,
  emptyDraft,
  moveEnvelope,
  nextDraft,
  pathTo,
  rangeEnvelope,
  shapeOutline,
  sprintAllowed,
  toUnitOrders,
  type OrderDraft,
} from './targeting.js';
import { createCombatLog, type CombatLog, type LogNames } from './combat-log.js';
import { createHud, type Hud, type HudCharacter, type HudModel } from './hud.js';
import { deriveSeats, mergeSeatOrders, type Seat } from './hotseat.js';
import { fogView, revealedView, type FogView } from './fog.js';
import { type ViewState } from './playback.js';
import { statusPips } from './status-pips.js';
import { previewNumbers, type PreviewNumber } from './preview-numbers.js';

export interface HotSeatUI {
  board: HTMLElement;
  status: HTMLElement;
  controls: HTMLElement;
  /** The right-side combat log panel (UI6). Optional so tests can omit it. */
  log?: HTMLElement;
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
const IMPACT = 0xffd166;
/**
 * Fog (VISION1). Near-black rather than a tint: unseen board should read as
 * *absence of information*, and any hue would suggest the terrain underneath
 * meant something.
 */
const FOG = 0x05060a;
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
const MOVE_LINE = 0x9fc4ff;
const SPRINT_LINE = 0x8fd6ff;
const DASH_LINE = 0xffd23f;

/**
 * The single pacing constant: one beat of `choreograph`'s timeline in
 * milliseconds. Everything animated is a multiple of a beat, so playback speed
 * is this number and nothing else.
 */
const MS_PER_BEAT = 460;
/** Board shape and the space page chrome claims around it. */
const BOARD_ASPECT = 0.58;
const MAX_BOARD_WIDTH_PX = 1180;
const MIN_BOARD_PX = { width: 320, height: 240 };
/** Title + status line above the board; the HUD and log are measured instead. */
const TOP_CHROME_PX = 120;
/** Breathing room either side of the board. */
const GUTTER_PX = 32;
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
): void {
  let state = createMatch(map, format, teams);
  const seats = deriveSeats(state, playersPerTeam);

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
  const currentFog = (team: TeamId): FogView => {
    if (fogMemo?.state !== state || fogMemo.team !== team) {
      fogMemo = { state, team, view: fogView(map, state, team) };
    }
    return fogMemo.view;
  };

  const toRenderUnits = (units: readonly UnitState[]): RenderUnit[] => units.map((u) => ({
    unitId: u.unitId, owner: u.owner, pos: u.pos, hp: u.hp, maxHp: u.maxHp,
    energy: u.energy, alive: u.alive, label: (u.characterId[0] ?? '?').toUpperCase(),
    shield: shieldOf(u),
    // STATUS-AUDIT: read straight off engine state during Decision. An active
    // status is one with turns left — an expired instance is not a status.
    pips: statusPips(u.statuses.filter((s) => s.remaining > 0)),
  }));

  const renderer: Renderer = createRenderer(ui.board, map, PALETTE);

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
  const sizeToContainer = (): void => {
    // The log is a right-hand column on a wide screen and a strip above the HUD
    // on a narrow one, so it costs width in one layout and height in the other.
    // Which one is *read off the box*, not branched on a pixel threshold — the
    // breakpoint lives in the stylesheet and duplicating it here would let the
    // two drift apart silently.
    const logBox = ui.log?.getBoundingClientRect();
    const logIsColumn = logBox !== undefined && logBox.width < globalThis.innerWidth * 0.6;
    const sideChrome = logIsColumn ? logBox.width : 0;
    const bottomChrome =
      ui.controls.getBoundingClientRect().height
      + (logIsColumn ? 0 : (logBox?.height ?? 0))
      + TOP_CHROME_PX;
    const w = Math.max(MIN_BOARD_PX.width, Math.min(globalThis.innerWidth - sideChrome - GUTTER_PX, MAX_BOARD_WIDTH_PX));
    const h = Math.max(MIN_BOARD_PX.height, Math.min(Math.round(w * BOARD_ASPECT), globalThis.innerHeight - bottomChrome));
    // Keep the aspect when height is the binding constraint, so a short window
    // narrows the board rather than stretching it.
    renderer.resize(Math.min(Math.round(h / BOARD_ASPECT), w), h);
  };
  sizeToContainer();
  fitCamera();
  // The renderer drives its own frames now: the orbit, the auto-camera's easing
  // and the billboarded bars all need continuous frames, not one render per
  // input event.
  renderer.start();
  // The camera eases every frame, so the DOM-anchored plan-time numbers have to
  // be re-placed against the frame that was just drawn or they trail the board.
  renderer.onFrame(placePreviewNumbers);
  globalThis.addEventListener('resize', () => { sizeToContainer(); fitCamera(); });
  ui.board.addEventListener('click', onBoardClick);
  ui.board.addEventListener('mousemove', onBoardHover);

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
  });

  // The HUD and log are what `sizeToContainer` measures, so re-fit now that both
  // exist and carry content — the first pass ran before either was populated.
  sizeToContainer();
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

  const viewUnits = (view: ViewState): RenderUnit[] => [...view.units.values()].map((v) => ({
    unitId: v.unitId, owner: v.owner, pos: { ...v.pos }, hp: v.hp, maxHp: v.maxHp,
    energy: v.energy, alive: v.alive, label: (v.unitId[0] ?? '?').toUpperCase(), shield: v.shield,
    // …and during playback, off the folded event log — same pips, same order.
    pips: statusPips([...v.statuses].map((kind) => ({ kind }))),
  }));

  /**
   * Playback decoys, seen from the seat that just planned (DECOY-RENDER).
   * The turn is history so nothing is hidden, but "revealed" is not "identical
   * for everyone" — a decoy still draws as an enemy to the team it fooled and
   * as its owner's purple marker to the team that placed it.
   */
  const viewDecoys = (view: ViewState): RenderDecoy[] => {
    const viewer = currentSeat()?.team ?? 0;
    return [...view.decoys.values()].map((d) => ({
      id: d.id,
      pos: { ...d.pos },
      asEnemy: d.teamId !== viewer,
    }));
  };

  function beginTurn(): void {
    drafts = new Map();
    locked = new Set();
    seatIdx = 0;
    openSeat();
  }

  /** Put the next seat with living characters on the clock, or resolve. */
  function openSeat(): void {
    while (seatIdx < seats.length && seatRoster().length === 0) seatIdx += 1;
    const roster = seatRoster();
    if (roster.length === 0) return void resolveAndPlay(); // nobody left to order
    for (const unit of roster) draftFor(unit); // every character is orderable at once
    selectUnit(roster[0]!.unitId);
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
    renderer.show(toRenderUnits(view.units), view.decoys);
    renderer.highlight('fog', view.fogged, FOG, FOG_OPACITY);
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
    renderer.highlight(
      'range',
      envelopeAbility !== undefined ? rangeEnvelope(map, state, unit, envelopeAbility) : [],
      RANGE,
      0.16,
    );

    // ── Layer: the MOVE envelope ─────────────────────────────────────────────
    // A dash *is* the movement, so it shows no separate move preview; the budget
    // comes straight from the engine (4 with an ability, 8 sprinting, 0 rooted).
    const sprinting = hover.move === 'sprint' || (hover.move === undefined && draft.sprint);
    const showMove = hover.move !== undefined
      || (!isDash && (draft.sprint || interaction.mode === 'move' || draft.movePath.length > 0));
    renderer.highlight('reach', showMove ? moveEnvelope(map, state, unit, sprinting) : [], REACH, 0.22);

    // ── Layer: the tiles an aim actually covers ──────────────────────────────
    // While the pointer is over the board with a mode armed, this previews the
    // HOVERED aim; otherwise it shows what has been committed. Same `aimFor`
    // either way, so the preview and the commit can never disagree.
    const preview = previewAim(map, state, unit, chosen, draft, interaction);
    const covered = chosen !== undefined ? abilityPreview(map, unit, chosen, preview.aim, preview.aimStep) : [];
    renderer.highlight('aim', covered, AIM, 0.5);

    // ── DASH-PREVIEW: a dash's impact disc(s) ────────────────────────────────
    // "Shadowstep Strike needs to show what boxes are being hit, not just the
    // box of arrival." Its own layer rather than more tiles in `covered`: the
    // aimed area is where the dash GOES, the disc is what the arrival DOES, and
    // a player choosing between two landing squares is reading the second.
    // Plan-time only — the engine detonates from wherever the dash really stops.
    const impact = impactPreview(map, unit, chosen, preview.aim, preview.aimStep);
    renderer.highlight('impact', [...impact.origin, ...impact.destination], IMPACT, 0.4);

    // ── UI2 Layer 1: the continuous shape over Layer 2's tiles ───────────────
    // The tiles are the truth (centre-in binary, AIM2); the wedge/beam/disk is
    // the fiction they approximate. Showing only the tiles makes a clipped
    // corner look like a bug; showing only the shape hides what actually gets
    // hit. Both, from the same numbers.
    renderer.drawShape(
      chosen !== undefined && covered.length > 0 ? shapeOutline(unit, chosen, preview.aim, preview.aimStep, covered) : [],
      SHAPE,
      0.16,
    );

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
    showPreviewNumbers(previewNumbers(state, unit, [
      ...(chosen !== undefined
        ? [{ def: chosen, squares: [...covered, ...impact.origin, ...impact.destination] }]
        : []),
      ...(freeDef !== undefined && freeAim.length > 0
        ? [{ def: freeDef, squares: abilityPreview(map, unit, freeDef, freeAim) }]
        : []),
      ...(catalystDef !== undefined && catalystAim.length > 0
        ? [{ def: catalystDef, squares: abilityPreview(map, unit, catalystDef, catalystAim) }]
        : []),
    ]));

    // ── AIM1 (+UI4): the drawn route as a LINE ───────────────────────────────
    // Shaded reachability says where you *could* go; only a line says which way
    // you chose and in what order. A DASH is the same indicator in yellow (UI4)
    // — it is still a route, so it gets route geometry rather than nothing, and
    // colour carries the fact that it resolves in a different phase.
    const route = isDash ? dashRoute(unit, chosen, preview.aim) : previewMovePath(map, state, unit, draft, interaction);
    renderer.drawPath(
      route.length > 0 ? [unit.pos, ...route] : [],
      isDash ? DASH_LINE : draft.sprint ? SPRINT_LINE : MOVE_LINE,
      !isDash && draft.sprint, // sprint is the dashed one; a dash reads by colour
    );

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
        available: opt.available,
        reason: opt.reason,
        cooldown: opt.cooldown,
        // A free ability lives in its own slot, so it is "selected" from the
        // free draft — never from `abilityId`, which it must never occupy.
        selected: opt.def.free === true ? draft.freeAbilityId === opt.def.id : draft.abilityId === opt.def.id,
        free: opt.def.free === true,
        def: opt.def,
      })),
      // Three slots, in phase order, read straight off the unit — `catalystsUsed`
      // is the engine's answer, so a slot can never grey out for the wrong reason.
      catalysts: unit.catalysts.flatMap((id) => {
        const def = catalysts[id];
        return def === undefined ? [] : [{
          id,
          name: def.name,
          phase: def.phase,
          spent: unit.catalystsUsed.includes(id),
          selected: draft.catalystId === id,
          def,
        }];
      }),
      move: {
        // A Dash catalyst buys its effect with the Move (CAT-DASH-COST), so the
        // budget reads 0 rather than 4 — the number has to say what you will
        // actually get, or the cost is invisible until the turn resolves.
        budget: dashCatalystArmed(draft) ? 0 : movementBudget(unit, draft.sprint),
        drawing: interaction.mode === 'move',
        sprinting: draft.sprint,
        // Sprint is move-only (GAME_SPEC §2) — but a FREE ability is not the
        // turn's ability, so it must not disable it. Keying this off the wrong
        // field is how "I cannot sprint after placing my trap" happened. A Dash
        // catalyst does disable it: it is no longer a free action.
        sprintDisabled: !sprintAllowed(draft, dashCatalystArmed(draft)),
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
  const dashCatalystArmed = (draft: OrderDraft): boolean =>
    draft.catalystId !== undefined && catalysts[draft.catalystId]?.phase === 'dash';

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
    const draft = nextDraft(prev, { type: 'selectAbility', abilityId, isDash }, isDash);
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
    const sq = renderer.squareFromPoint(evt.clientX, evt.clientY);
    if (!sq) return;
    const unit = selectedUnit();
    if (unit === undefined) return;
    const draft = draftFor(unit);

    // AIM-RANGE: every slot commits through `commitAim`, which returns nothing
    // for an out-of-range click. The slot then stays armed rather than
    // recording an order the engine will silently drop at resolution — the
    // behaviour that made Blink and Intercept look like they had no range.
    if (interaction.mode === 'aim') {
      const ability = draftAbility(characterFor(unit), draft);
      if (ability === undefined) return;
      // Exactly the aim the hover was already painting — one resolver, so what
      // you saw is what you committed.
      const committed = commitAim(map, state, unit, ability, sq);
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
    } else if (interaction.mode === 'move' || draft.sprint) {
      draft.movePath = pathTo(map, state, unit, sq, movementBudget(unit, draft.sprint));
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
    if (selectedUnit() === undefined) return;
    const next = hoverBoard(interaction, renderer.squareFromPoint(evt.clientX, evt.clientY));
    if (next === undefined) return; // same tile, or nothing armed: no repaint
    interaction = next;
    renderPreviews();
  }

  // ── Turn resolution + playback ───────────────────────────────────────────────

  async function resolveAndPlay(): Promise<void> {
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
    const prev = state;
    const result = resolveTurn(prev, map, mergeSeatOrders(seats, ordersBySeat), roster, catalysts);
    // The log is written from the resolved event list up front, so it is
    // complete whether the player watches the animation or skips it.
    combatLog?.appendTurn(prev.turn, result.events, logNames);

    // The player owns state — its fold IS the board, so skipping and watching
    // agree by construction. Everything below only *decorates* that fold:
    // fractional positions, alpha, which squares glow. Drop every frame of it
    // and the board still lands in the same place.
    const player = createTurnPlayer(prev, result.events);
    // The turn stops being a plan the instant it resolves, so the plan-time
    // numbers go with the aim overlays rather than lingering over the playback.
    clearPreviewNumbers();
    for (const layer of ['fog', 'range', 'reach', 'aim', 'impact', 'free', 'catalyst', 'select'] as const) renderer.highlight(layer, [], 0);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.drawPath([], DASH_LINE, false, 'catalystPath');
    renderer.drawShape([], SHAPE);
    renderer.show(viewUnits(player.view), viewDecoys(player.view));

    let skipped = false;
    const finish = (): void => {
      phaseLabel.style.display = 'none';
      renderer.setSpotlight(null);
      renderer.focusOn([]); // skipping must return the camera too, not leave it mid-push

      renderer.highlight('aim', [], AIM);
      renderer.highlight('select', [], IMPACT);
      clearReadouts();
      renderer.show(viewUnits(player.view), viewDecoys(player.view));
    };
    hud.showPlayback(() => {
      skipped = true;
      player.skip();
      finish();
    });

    for (let step = player.advancePhase(); step !== undefined; step = player.advancePhase()) {
      ui.status.textContent = `Turn ${prev.turn} · resolving — ${step.phase.toUpperCase()}`;
      if (skipped) continue; // keep folding; just stop animating
      await animatePhase(player.cues, step.phase, viewUnits(player.view), viewDecoys(player.view), () => skipped);
    }
    finish();

    state = result.state;
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
    cancelled: () => boolean,
  ): Promise<void> {
    const { start, end } = phaseWindow(cues, phase);
    renderer.show(units, decoys);
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
      const key = `${n.unitId}:${n.kind}`;
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
      const node = previewNodes.get(`${n.unitId}:${n.kind}`);
      if (node === undefined) continue;
      const square = unitById(n.unitId)?.pos;
      const at = square === undefined ? undefined : renderer.screenPosition(square.x, square.y, READOUT_LIFT);
      if (at === undefined) { node.style.display = 'none'; continue; }
      const tier = stack.get(n.unitId) ?? 0;
      stack.set(n.unitId, tier + 1);
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
    renderer.show(toRenderUnits(revealedView(state, currentSeat()?.team ?? 0).units), []);
    for (const layer of ['fog', 'range', 'reach', 'aim', 'impact', 'free', 'catalyst', 'select'] as const) renderer.highlight(layer, [], 0);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.drawPath([], DASH_LINE, false, 'catalystPath');
    renderer.drawShape([], SHAPE);
    renderer.setSpotlight(null);
    renderer.fitBoard();
    hud.clear();
    ui.status.textContent = state.status === 'draw'
      ? 'Double KO — the match is a draw.'
      : `${teamName(state.winner ?? 0)} wins! (${state.kills[0]}–${state.kills[1]})`;
  }

  const teamName = (t: number) => (t === 0 ? 'Team 1' : 'Team 2');

  beginTurn();
}
