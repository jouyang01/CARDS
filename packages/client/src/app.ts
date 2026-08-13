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
  type Roster,
  type UnitOrders,
  type UnitState,
  type Vec2,
} from '@cards/engine';
import { createRenderer, type ProjectionName, type RenderUnit, type Renderer } from './renderer3d.js';
import { createTurnPlayer } from './turn-player.js';
import { focusSquares, phaseWindow, sampleFrame, type Frame } from './animate.js';
import { type Cue } from './choreograph.js';
import {
  abilityOptions,
  abilityPreview,
  abilityTooltip,
  aimFor,
  draftAbility,
  draftHasOrder,
  emptyDraft,
  moveEnvelope,
  nextDraft,
  pathTo,
  rangeEnvelope,
  toUnitOrders,
  type OrderDraft,
} from './targeting.js';
import { deriveSeats, mergeSeatOrders, type Seat } from './hotseat.js';
import { type ViewState } from './playback.js';

export interface HotSeatUI {
  board: HTMLElement;
  status: HTMLElement;
  controls: HTMLElement;
}

/**
 * What a board click will do. `idle` means the click does nothing — an ability
 * or Draw-move must be chosen first, which is the "click the skill to set the
 * mode" half of the owner's note (UI1).
 */
type Mode = 'idle' | 'aim' | 'move';

/**
 * Purely presentational pointer state (UI1). **Nothing here is ever written into
 * a draft.** Hover shows you what an action *would* do; only a click commits it.
 * Keeping the two apart is what lets the range envelope, the live cone and the
 * committed order all render at once without one overwriting another.
 */
interface Hover {
  /** An ability control is under the pointer — paint its range envelope. */
  abilityId?: string;
  /** A move control is under the pointer — paint where the unit could walk. */
  move?: 'move' | 'sprint';
  /** The board square under the pointer, while a mode is armed. */
  square?: Vec2;
}

const PALETTE = {
  open: 0x20242f, wall: 0x4a5065, cover: 0x6b5b3e, brush: 0x2e4632,
  team0: 0x4f8cff, team1: 0xff6b5e, background: 0x12141a,
};
const REACH = 0x4f8cff;
/** The hover range envelope (UI1) — dimmer than anything committed. */
const RANGE = 0x8fb6ff;
const AIM = 0xff9a3e;
const SELECT = 0xf0f0f0;
const IMPACT = 0xffd166;
/** The drawn move line (AIM1). Sprint is the same hue, dashed and brighter. */
const MOVE_LINE = 0x9fc4ff;
const SPRINT_LINE = 0xffd166;

/**
 * The single pacing constant: one beat of `choreograph`'s timeline in
 * milliseconds. Everything animated is a multiple of a beat, so playback speed
 * is this number and nothing else.
 */
const MS_PER_BEAT = 460;
const now = (): number => performance.now();

export function startHotSeat(
  ui: HotSeatUI,
  map: MapDef,
  roster: Roster,
  teams: [CharacterDef[], CharacterDef[]],
  format: FormatId,
  playersPerTeam: [number, number],
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
  let mode: Mode = 'idle';
  let hover: Hover = {};
  let projection: ProjectionName = 'isometric';

  const renderer: Renderer = createRenderer(ui.board, map, PALETTE);
  const fitCamera = (): void => renderer.fitBoard();
  // Size from the VIEWPORT, never from the container: the canvas is the
  // container's only child, so measuring the container would feed the canvas its
  // own width back and pin it at Three's 300px default.
  const sizeToContainer = (): void => {
    const w = Math.max(360, Math.min(globalThis.innerWidth - 48, 1000));
    renderer.resize(w, Math.round(w * 0.62));
  };
  sizeToContainer();
  fitCamera();
  // The renderer drives its own frames now: the orbit, the auto-camera's easing
  // and the billboarded bars all need continuous frames, not one render per
  // input event.
  renderer.start();
  globalThis.addEventListener('resize', () => { sizeToContainer(); fitCamera(); });
  ui.board.addEventListener('click', onBoardClick);
  ui.board.addEventListener('mousemove', onBoardHover);

  // Persistent corner phase label (A3): it stays put and changes text, so the
  // eye never has to hunt for which phase is playing.
  const phaseLabel = document.createElement('div');
  phaseLabel.className = 'phase-label';
  phaseLabel.style.display = 'none';
  ui.board.appendChild(phaseLabel);

  // Ability hover tooltip (TT1) — one reused element, positioned by the button.
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
  const showTip = (target: HTMLElement, def: AbilityDef): void => {
    tooltip.textContent = abilityTooltip(def).join('\n');
    const r = target.getBoundingClientRect();
    tooltip.style.left = `${Math.round(r.left)}px`;
    tooltip.style.top = `${Math.round(r.bottom + 6)}px`;
    tooltip.style.display = 'block';
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
  const clearHover = (): void => { hover = {}; };

  const stateUnits = (): RenderUnit[] => state.units.map((u) => ({
    unitId: u.unitId, owner: u.owner, pos: u.pos, hp: u.hp, maxHp: u.maxHp,
    energy: u.energy, alive: u.alive, label: (u.characterId[0] ?? '?').toUpperCase(),
    // Same shield sum `initView` takes, so the planning board and the playback
    // board show the same bar.
    shield: u.statuses.filter((s) => s.kind === 'shield' && s.remaining > 0).reduce((sum, s) => sum + (s.amount ?? 0), 0),
  }));

  const viewUnits = (view: ViewState): RenderUnit[] => [...view.units.values()].map((v) => ({
    unitId: v.unitId, owner: v.owner, pos: { ...v.pos }, hp: v.hp, maxHp: v.maxHp,
    energy: v.energy, alive: v.alive, label: (v.unitId[0] ?? '?').toUpperCase(), shield: v.shield,
  }));

  const viewDecoys = (view: ViewState): Vec2[] => [...view.decoys.values()].map((d) => ({ ...d.pos }));

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
    mode = 'idle';
    clearHover();
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

    renderer.show(stateUnits(), state.decoys.map((d) => d.pos));
    renderer.setSpotlight(null); // planning shows the whole board, undimmed
    phaseLabel.style.display = 'none';
    renderer.focusOn([]); // ease back out to the whole board after a resolution
    renderer.highlight('select', [unit.pos], SELECT, 0.5);

    const chosen = draftAbility(character, draft);
    const isDash = chosen?.phase === 'dash';

    // ── Layer: the effective-range ENVELOPE (UI1) ────────────────────────────
    // Where an action *could* go, which is a different question from what a
    // given aim covers — and the one a player asks before selecting anything.
    // Hovering a control answers it without touching the draft.
    const hovered = hover.abilityId !== undefined ? findOnCharacter(character, hover.abilityId) : undefined;
    const envelopeAbility = hovered ?? (hover.move === undefined ? chosen : undefined);
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
      || (!isDash && (draft.sprint || mode === 'move' || draft.movePath.length > 0));
    renderer.highlight('reach', showMove ? moveEnvelope(map, state, unit, sprinting) : [], REACH, 0.22);

    // ── Layer: the tiles an aim actually covers ──────────────────────────────
    // While the pointer is over the board with a mode armed, this previews the
    // HOVERED aim; otherwise it shows what has been committed. Same `aimFor`
    // either way, so the preview and the commit can never disagree.
    const preview = previewAim(unit, chosen, draft);
    renderer.highlight(
      'aim',
      chosen !== undefined ? abilityPreview(map, unit, chosen, preview.aim, preview.aimStep) : [],
      AIM,
      0.5,
    );

    // AIM1: the drawn move is a LINE from the unit through its path, with an
    // endpoint marker. Shaded reachability says where you *could* go; only a
    // line says which way you actually chose and in what order.
    const line = previewMovePath(unit, draft);
    renderer.drawPath(
      line.length > 0 ? [unit.pos, ...line] : [],
      draft.sprint ? SPRINT_LINE : MOVE_LINE,
      draft.sprint, // sprint is the dashed one, so the two read apart at a glance
    );
  }

  /** An ability (ult included) on a character by id — hover works off ids. */
  function findOnCharacter(character: CharacterDef, abilityId: string): AbilityDef | undefined {
    return [...character.abilities, character.ultimate].find((a) => a.id === abilityId);
  }

  /**
   * The aim to PAINT right now: the hovered square's aim while the pointer is
   * over the board in aim mode, else whatever the draft has committed. Hover
   * never writes to the draft — that is the whole commit/preview split (UI1).
   */
  function previewAim(unit: UnitState, ability: AbilityDef | undefined, draft: OrderDraft): { aim: Vec2[]; aimStep?: number } {
    if (ability !== undefined && mode === 'aim' && hover.square !== undefined) {
      return aimFor(map, state, unit, ability, hover.square);
    }
    return { aim: draft.aim, aimStep: draft.aimStep };
  }

  /** Likewise for the drawn move: hovered route while drawing, else committed. */
  function previewMovePath(unit: UnitState, draft: OrderDraft): Vec2[] {
    if (mode === 'move' && hover.square !== undefined) {
      return pathTo(map, state, unit, hover.square, movementBudget(unit, draft.sprint));
    }
    return draft.movePath;
  }

  function render(): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    renderPreviews();
    renderControls(unit, draftFor(unit), characterFor(unit));
    const seat = currentSeat();
    const roster = seatRoster();
    const done = roster.filter((u) => locked.has(u.unitId)).length;
    ui.status.textContent =
      `Turn ${state.turn} · ${teamName(seat?.team ?? 0)} · seat ${seat?.seatId ?? '?'}` +
      ` — ${characterFor(unit).name} (${done}/${roster.length} locked)`;
  }

  function renderControls(unit: UnitState, draft: OrderDraft, character: CharacterDef): void {
    ui.controls.replaceChildren();
    const row = (label: string) => {
      const d = document.createElement('div');
      d.className = 'control-row';
      d.append(label);
      ui.controls.appendChild(d);
      return d;
    };

    // The seat's characters. A player switches between them freely; Lock In
    // locks only the selected one (UI1's ruling).
    const roster = seatRoster();
    if (roster.length > 1) {
      const who = row('Character: ');
      for (const u of roster) {
        const b = document.createElement('button');
        const isLocked = locked.has(u.unitId);
        b.textContent = `${characterFor(u).name}${isLocked ? ' ✓' : draftHasOrder(draftFor(u)) ? ' •' : ''}`;
        b.className = u.unitId === unit.unitId ? 'sel' : '';
        b.disabled = isLocked;
        b.onclick = () => selectUnit(u.unitId);
        who.appendChild(b);
      }
    }

    const abilityRow = row('Ability: ');
    for (const opt of abilityOptions(unit, character)) {
      const b = document.createElement('button');
      b.textContent = `${opt.def.name}${opt.isUlt ? ' ★' : ''}` + (opt.available ? '' : ` (${opt.reason})`);
      b.disabled = !opt.available;
      b.className = draft.abilityId === opt.def.id ? 'sel' : '';
      b.onclick = () => selectAbility(opt.def.id);
      // UI1: hovering a control paints its effective range and nothing else —
      // no draft is touched, and mouse-out puts the board back.
      b.addEventListener('mouseenter', () => { showTip(b, opt.def); hover = { abilityId: opt.def.id }; renderPreviews(); });
      b.addEventListener('mouseleave', () => { hideTip(); clearHover(); renderPreviews(); });
      abilityRow.appendChild(b);
    }

    const budget = movementBudget(unit, draft.sprint);
    const moveRow = row(`Move (${budget}): `);
    const moveBtn = document.createElement('button');
    moveBtn.textContent = 'Draw move';
    moveBtn.className = mode === 'move' && !draft.sprint ? 'sel' : '';
    moveBtn.onclick = () => selectMove(false);
    const sprintBtn = document.createElement('button');
    sprintBtn.textContent = 'Sprint';
    sprintBtn.className = draft.sprint ? 'sel' : '';
    sprintBtn.disabled = draft.abilityId !== undefined; // Sprint is move-only (GAME_SPEC §2)
    sprintBtn.onclick = () => selectMove(true);
    for (const [btn, kind] of [[moveBtn, 'move'], [sprintBtn, 'sprint']] as const) {
      btn.addEventListener('mouseenter', () => { hover = { move: kind }; renderPreviews(); });
      btn.addEventListener('mouseleave', () => { clearHover(); renderPreviews(); });
    }
    const holdBtn = document.createElement('button');
    holdBtn.textContent = 'Hold / clear';
    holdBtn.onclick = () => { drafts.set(unit.unitId, emptyDraft(unit.unitId)); mode = 'idle'; clearHover(); render(); };
    moveRow.append(moveBtn, sprintBtn, holdBtn);

    const viewRow = row('View: ');
    const proj = document.createElement('button');
    proj.textContent = projection === 'isometric' ? 'Isometric' : 'Top-down';
    proj.onclick = () => {
      // One camera, two pitches — the whole point of going orthographic.
      projection = projection === 'isometric' ? 'top' : 'isometric';
      renderer.setProjection(projection);
      fitCamera(); // the pitch changes the foreshortening, so re-fit
      render();
    };
    const orbit = document.createElement('button');
    const free = renderer.orbitEnabled();
    orbit.textContent = free ? 'Camera: free orbit' : 'Camera: auto';
    orbit.className = free ? 'sel' : '';
    orbit.onclick = () => {
      // Auto follows the action; free orbit hands the camera to the player and
      // stands the auto-framing down so the two never fight.
      renderer.setOrbitEnabled(!renderer.orbitEnabled());
      if (!renderer.orbitEnabled()) fitCamera();
      render();
    };
    viewRow.append(proj, orbit);
    const hint = document.createElement('span');
    hint.style.opacity = '0.6';
    hint.textContent = free ? 'drag to orbit · wheel to zoom' : 'right-drag to orbit · wheel to zoom';
    viewRow.appendChild(hint);

    const lockRow = row('');
    const lock = document.createElement('button');
    const last = seatIdx === seats.length - 1 && roster.every((u) => u.unitId === unit.unitId || locked.has(u.unitId));
    lock.textContent = last ? 'Lock In & resolve ⚔' : 'Lock In ▸';
    lock.className = 'primary';
    lock.onclick = lockSelected;
    lockRow.appendChild(lock);

    const bars = row('');
    bars.textContent = `HP ${unit.hp}/${unit.maxHp} · Energy ${unit.energy}/100`;
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  const currentIsDash = (draft: OrderDraft, character: CharacterDef): boolean =>
    draftAbility(character, draft)?.phase === 'dash';

  function selectAbility(abilityId: string): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    const character = characterFor(unit);
    const prev = draftFor(unit);
    const chosen = draftAbility(character, { ...prev, abilityId });
    const isDash = chosen?.phase === 'dash';
    // Choosing another ability before Lock In simply replaces the last one
    // (UI1) — `nextDraft` owns the exclusivity rules (sprint, dash-owns-move).
    const draft = nextDraft(prev, { type: 'selectAbility', abilityId, isDash }, isDash);
    if (chosen && chosen.shape === 'self') draft.aim = [{ ...unit.pos }];
    draft.aimStep = undefined;
    drafts.set(unit.unitId, draft);
    // A self-cast has nowhere to point, so it is committed by selecting it;
    // everything else arms aim mode and waits for the confirming board click.
    mode = chosen && chosen.shape !== 'self' ? 'aim' : 'idle';
    clearHover();
    render();
  }

  function selectMove(sprint: boolean): void {
    const unit = selectedUnit();
    if (unit === undefined) return;
    const prev = draftFor(unit);
    const wasDash = currentIsDash(prev, characterFor(unit));
    drafts.set(unit.unitId, nextDraft(prev, { type: sprint ? 'selectSprint' : 'selectMove' }, wasDash));
    mode = 'move';
    clearHover();
    render();
  }

  /**
   * A board click CONFIRMS the armed action (UI1) — it does not end the turn.
   * The committed aim stays painted until the player replaces it or locks in.
   */
  function onBoardClick(evt: MouseEvent): void {
    const sq = renderer.squareFromPoint(evt.clientX, evt.clientY);
    if (!sq) return;
    const unit = selectedUnit();
    if (unit === undefined) return;
    const draft = draftFor(unit);

    if (mode === 'aim') {
      const ability = draftAbility(characterFor(unit), draft);
      if (ability === undefined) return;
      // Exactly the aim the hover was already painting — one resolver, so what
      // you saw is what you committed.
      const { aim, aimStep } = aimFor(map, state, unit, ability, sq);
      draft.aim = aim;
      draft.aimStep = aimStep;
      render();
    } else if (mode === 'move' || draft.sprint) {
      draft.movePath = pathTo(map, state, unit, sq, movementBudget(unit, draft.sprint));
      render();
    }
  }

  /**
   * Board hover (UI1): while a mode is armed, the pointer's square previews the
   * action live — the cone/line rotates with the mouse (the old AIM2-UX), a
   * circle follows it, a drawn route re-routes. **The draft is not touched**;
   * `renderPreviews` reads `hover.square` and paints from that instead.
   */
  function onBoardHover(evt: MouseEvent): void {
    if (mode === 'idle') return;
    if (selectedUnit() === undefined) return;
    const sq = renderer.squareFromPoint(evt.clientX, evt.clientY);
    if (sq === undefined) {
      if (hover.square === undefined) return;
      clearHover();
      return renderPreviews();
    }
    if (hover.square !== undefined && hover.square.x === sq.x && hover.square.y === sq.y) return;
    hover = { square: sq };
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
    const result = resolveTurn(prev, map, mergeSeatOrders(seats, ordersBySeat), roster);

    // The player owns state — its fold IS the board, so skipping and watching
    // agree by construction. Everything below only *decorates* that fold:
    // fractional positions, alpha, which squares glow. Drop every frame of it
    // and the board still lands in the same place.
    const player = createTurnPlayer(prev, result.events);
    for (const layer of ['reach', 'aim', 'select'] as const) renderer.highlight(layer, [], 0);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.show(viewUnits(player.view), viewDecoys(player.view));

    let skipped = false;
    const finish = (): void => {
      phaseLabel.style.display = 'none';
      renderer.setSpotlight(null);
      renderer.focusOn([]); // skipping must return the camera too, not leave it mid-push

      renderer.highlight('aim', [], AIM);
      renderer.highlight('select', [], IMPACT);
      renderer.show(viewUnits(player.view), viewDecoys(player.view));
    };
    renderPlaybackControls(() => {
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
    decoys: Vec2[],
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
  }

  function renderPlaybackControls(onSkip: () => void): void {
    ui.controls.replaceChildren();
    const row = document.createElement('div');
    row.className = 'control-row';
    const skip = document.createElement('button');
    skip.textContent = 'Skip ⏭';
    skip.className = 'primary';
    skip.onclick = onSkip;
    row.appendChild(skip);
    ui.controls.appendChild(row);
  }

  function renderGameOver(): void {
    renderer.show(stateUnits(), []);
    for (const layer of ['reach', 'aim', 'select'] as const) renderer.highlight(layer, [], 0);
    renderer.drawPath([], MOVE_LINE, false);
    renderer.setSpotlight(null);
    renderer.fitBoard();
    ui.controls.replaceChildren();
    ui.status.textContent = state.status === 'draw'
      ? 'Double KO — the match is a draw.'
      : `${teamName(state.winner ?? 0)} wins! (${state.kills[0]}–${state.kills[1]})`;
  }

  const teamName = (t: number) => (t === 0 ? 'Team 1' : 'Team 2');

  beginTurn();
}
