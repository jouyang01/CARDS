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
  buildBoard,
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
import { createRenderer, type ProjectionName, type RenderDecoy, type RenderTrap, type RenderUnit, type Renderer } from './renderer3d.js';
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
  abilitiesAllowed,
  catalystCost,
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
import { deriveSeats, mergeSeatOrders, type Seat } from '@cards/engine';
import { camoTiles, fogView, rememberSightings, revealedView, type FogGhost, type FogView } from './fog.js';
import { padViews, type PadView, type ViewState } from './playback.js';
import { applyScenario, type ScenarioId } from './scenarios.js';
import { statusChips, statusPips, viewableStatuses } from './status-pips.js';
import { previewNumbers, type PreviewNumber } from './preview-numbers.js';
import {
  clock, endReasonText, foldTurn, initTotals, matchBreakdown, scoreReadout, tally,
  type MatchTotals,
} from './scoreboard.js';

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
const MOVE_LINE = 0x9fc4ff;
const SPRINT_LINE = 0x8fd6ff;
const DASH_LINE = 0xffd23f;
/** CHASE1's route + quarry ring: orange, distinct from move blue and dash yellow. */
const CHASE_LINE = 0xff8a3d;

/**
 * The single pacing constant: one beat of `choreograph`'s timeline in
 * milliseconds. Everything animated is a multiple of a beat, so playback speed
 * is this number and nothing else.
 */
const MS_PER_BEAT = 460;
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
): void {
  // CAMO-SEED: a dev-only nudge to the starting positions, applied once and
  // never again — everything after this is the ordinary engine on an ordinary
  // state. Absent for a normal match.
  let state = scenario === undefined
    ? createMatch(map, format, teams)
    : applyScenario(scenario, buildBoard(map), createMatch(map, format, teams));
  /** SCORE1's running ledger, folded from each turn's event log as it plays. */
  let totals: MatchTotals = initTotals(state);
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
  const toRenderUnits = (units: readonly UnitState[], viewer: TeamId): RenderUnit[] => units.map((u) => ({
    unitId: u.unitId, owner: u.owner, pos: u.pos, hp: u.hp, maxHp: u.maxHp,
    energy: u.energy, alive: u.alive, label: (u.characterId[0] ?? '?').toUpperCase(),
    shield: shieldOf(u),
    // STATUS-AUDIT: read straight off engine state during Decision. An active
    // status is one with turns left — an expired instance is not a status.
    // STATUS-ICONS: durations and the shield pool ride along as the glyph's
    // numeral, so the row says how long as well as what.
    pips: statusPips(viewableStatuses(u.statuses.filter((s) => s.remaining > 0), u.owner === viewer)),
  }));

  /**
   * A remembered enemy, in the renderer's shape. Everything live is blanked:
   * full HP, no energy, no statuses — a ghost that reported a real HP bar would
   * be telling the viewer something it stopped being allowed to know.
   */
  const toGhostUnits = (ghosts: readonly FogGhost[]): RenderUnit[] => ghosts.map((g) => ({
    unitId: g.unitId, owner: g.owner, pos: g.pos, hp: 1, maxHp: 1, energy: 0,
    alive: true, label: (g.characterId[0] ?? '?').toUpperCase(), ghost: true,
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
  // SCORE1's readout lives in its own element under the status line, so the
  // HUD's in-place update never has to know about it and vice versa.
  const scoreEl = document.createElement('div');
  scoreEl.className = 'scoreboard';
  ui.status.after(scoreEl);

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
      top: Math.max(scoreEl.getBoundingClientRect().bottom + 8, TOP_CHROME_FALLBACK_PX),
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
      // …and during playback, off the folded event log — same icons, same
      // order, and no numerals: the log carries neither durations nor shield
      // pools, and inventing them is worse than leaving them off.
      pips: statusPips(viewableStatuses([...v.statuses].map((kind) => ({ kind })), v.owner === viewer)),
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
    return [...view.decoys.values()].map((d) => ({
      id: d.id,
      pos: { ...d.pos },
      owner: d.teamId,
      asEnemy: d.teamId !== viewer,
    }));
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
    // Traps ride the same view for the same reason (TRAP-INDICATOR): the
    // placing team always sees its own, the enemy only a square it can see, and
    // that decision belongs to `fogView` rather than to the renderer.
    // LAST-KNOWN: ghosts ride the same reconcile path as live units — same
    // `unitId`, so one scene object is either the unit or its memory and the two
    // can never be on the board at once.
    // PADS-INDICATOR: pads are public terrain, so they are drawn from the map
    // and the authoritative state, with no fog view in the way.
    renderer.show([...toRenderUnits(view.units, team), ...toGhostUnits(view.ghosts)], view.decoys, view.traps, pads());
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
    // PREVIEW-FOG: the same view the board is drawn from decides who may carry a
    // number, so the preview cannot contradict the fog beside it.
    const seen = new Set(currentFog(currentSeat()?.team ?? unit.owner).units.map((u) => u.unitId));
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
    const chaseRoute = chaseTarget === undefined
      ? []
      : pathTo(map, state, unit, chaseTarget.pos, movementBudget(unit, draft.sprint));
    const route = isDash
      ? dashRoute(unit, chosen, preview.aim)
      : chaseTarget !== undefined
        ? chaseRoute
        : previewMovePath(map, state, unit, draft, interaction);
    renderer.drawPath(
      route.length > 0 ? [unit.pos, ...route] : [],
      isDash ? DASH_LINE : chaseTarget !== undefined ? CHASE_LINE : draft.sprint ? SPRINT_LINE : MOVE_LINE,
      !isDash && (draft.sprint || chaseTarget !== undefined),
    );
    // …and the quarry is ringed, so the order reads as "that one" rather than
    // as a line that happens to end near somebody.
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
    const readout = scoreReadout(state, unitName);
    scoreEl.replaceChildren();
    const head = document.createElement('div');
    head.className = 'score-head';
    for (const team of [0, 1] as const) {
      const side = document.createElement('span');
      side.className = 'score-team';
      side.style.color = TEAM_CSS[team];
      side.textContent = `${teamName(team)} ${tally(readout.kills[team], readout.killTarget)}`;
      head.appendChild(side);
    }
    const turn = document.createElement('span');
    turn.className = 'score-clock';
    // Sudden death is the one thing here that changes how a turn should be
    // played, so it replaces the clock rather than sitting beside it.
    turn.textContent = readout.suddenDeath ? 'SUDDEN DEATH' : clock(readout.turn, readout.turnLimit);
    head.appendChild(turn);
    scoreEl.appendChild(head);

    const strip = document.createElement('div');
    strip.className = 'score-strip';
    for (const row of readout.rows) {
      const cell = document.createElement('span');
      cell.className = row.alive ? 'score-unit' : 'score-unit dead';
      cell.style.borderColor = TEAM_CSS[row.owner];
      cell.textContent = row.alive
        ? `${row.name} ${row.hp}/${row.maxHp} · ult ${row.ultPct}%`
        : `${row.name} — down (${row.respawnIn})`;
      strip.appendChild(cell);
    }
    scoreEl.appendChild(strip);
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
      // BUFF-UI. Same source as the floating pips (`statusPips`) and the same
      // order, so the strip and the pips cannot disagree about what is on a
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
        budget: dashCatalystArmed(draft) ? 0 : movementBudget(unit, draft.sprint),
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
    for (const layer of ['fog', 'camo', 'range', 'reach', 'aim', 'impact', 'free', 'catalyst', 'select'] as const) renderer.highlight(layer, [], 0);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.drawPath([], DASH_LINE, false, 'catalystPath');
    renderer.drawShape([], SHAPE);
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
    for (const layer of ['fog', 'camo', 'range', 'reach', 'aim', 'impact', 'free', 'catalyst', 'select'] as const) renderer.highlight(layer, [], 0);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.drawPath([], DASH_LINE, false, 'catalystPath');
    renderer.drawShape([], SHAPE);
    renderer.setSpotlight(null);
    renderer.fitBoard();
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
  }

  const teamName = (t: number) => (t === 0 ? 'Team 1' : 'Team 2');

  beginTurn();
}
