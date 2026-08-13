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
  reachableSquares,
  reconstructPath,
  resolveTurn,
  buildBoard,
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
  dragToAimStep,
  draftAbility,
  emptyDraft,
  isRotatable,
  movePreview,
  nextDraft,
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

interface Step {
  seat: Seat;
  unit: UnitState;
}

type Mode = 'idle' | 'aim' | 'move';

const PALETTE = {
  open: 0x20242f, wall: 0x4a5065, cover: 0x6b5b3e, brush: 0x2e4632,
  team0: 0x4f8cff, team1: 0xff6b5e, background: 0x12141a,
};
const REACH = 0x4f8cff;
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

  let steps: Step[] = [];
  let stepIdx = 0;
  let drafts = new Map<string, OrderDraft>();
  let mode: Mode = 'idle';
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
  const currentStep = () => steps[stepIdx];

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
    steps = seats.flatMap((seat) =>
      seat.unitIds
        .map((uid) => state.units.find((u) => u.unitId === uid))
        .filter((u): u is UnitState => u !== undefined && u.alive)
        .map((unit) => ({ seat, unit })),
    );
    stepIdx = 0;
    if (steps.length === 0) return void resolveAndPlay(); // nobody alive to order
    startStep();
  }

  function startStep(): void {
    const step = currentStep();
    if (step === undefined) return;
    drafts.set(step.unit.unitId, emptyDraft(step.unit.unitId));
    mode = 'idle';
    render();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  /**
   * The board half of a decision-phase render. Split out from `render()` because
   * mouse-follow aiming (AIM2-UX) repaints on every pointer move — rebuilding
   * the control buttons at that rate would tear the DOM out from under the
   * pointer and kill hover tooltips.
   */
  function renderPreviews(): void {
    const step = currentStep();
    if (step === undefined) return;
    const draft = drafts.get(step.unit.unitId)!;
    const character = characterFor(step.unit);

    renderer.show(stateUnits(), state.decoys.map((d) => d.pos));
    renderer.setSpotlight(null); // planning shows the whole board, undimmed
    phaseLabel.style.display = 'none';
    renderer.focusOn([]); // ease back out to the whole board after a resolution
    renderer.highlight('select', [step.unit.pos], SELECT, 0.5);

    // Previews (MS1: a non-dash ability and a Move coexist). A dash *is* the
    // movement, so it shows no separate move preview; the budget comes straight
    // from the engine (4 with an ability, 8 sprinting, 0 rooted).
    const ability = draftAbility(character, draft);
    const isDash = ability?.phase === 'dash';
    if (!isDash && (draft.sprint || mode === 'move' || draft.movePath.length > 0)) {
      const { stops, through } = movePreview(map, state, step.unit, draft.sprint);
      renderer.highlight('reach', [...stops, ...through], REACH, 0.22);
    } else {
      renderer.highlight('reach', [], REACH);
    }
    renderer.highlight(
      'aim',
      ability !== undefined ? abilityPreview(map, step.unit, ability, draft.aim, draft.aimStep) : [],
      AIM,
      0.5,
    );

    // AIM1: the drawn move is a LINE from the unit through its path, with an
    // endpoint marker. Shaded reachability says where you *could* go; only a
    // line says which way you actually chose and in what order.
    renderer.drawPath(
      draft.movePath.length > 0 ? [step.unit.pos, ...draft.movePath] : [],
      draft.sprint ? SPRINT_LINE : MOVE_LINE,
      draft.sprint, // sprint is the dashed one, so the two read apart at a glance
    );
  }

  function render(): void {
    const step = currentStep();
    if (step === undefined) return;
    const draft = drafts.get(step.unit.unitId)!;
    const character = characterFor(step.unit);

    renderPreviews();
    renderControls(step, draft, character);
    ui.status.textContent =
      `Turn ${state.turn} · ${teamName(step.seat.team)} · seat ${step.seat.seatId} — order ${character.name}` +
      ` (${stepIdx + 1}/${steps.length})`;
  }

  function renderControls(step: Step, draft: OrderDraft, character: CharacterDef): void {
    ui.controls.replaceChildren();
    const row = (label: string) => {
      const d = document.createElement('div');
      d.className = 'control-row';
      d.append(label);
      ui.controls.appendChild(d);
      return d;
    };

    const abilityRow = row('Ability: ');
    for (const opt of abilityOptions(step.unit, character)) {
      const b = document.createElement('button');
      b.textContent = `${opt.def.name}${opt.isUlt ? ' ★' : ''}` + (opt.available ? '' : ` (${opt.reason})`);
      b.disabled = !opt.available;
      b.className = draft.abilityId === opt.def.id ? 'sel' : '';
      b.onclick = () => selectAbility(opt.def.id);
      b.addEventListener('mouseenter', () => showTip(b, opt.def)); // TT1
      b.addEventListener('mouseleave', hideTip);
      abilityRow.appendChild(b);
    }

    const budget = movementBudget(step.unit, draft.sprint);
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
    const holdBtn = document.createElement('button');
    holdBtn.textContent = 'Hold / clear';
    holdBtn.onclick = () => { drafts.set(step.unit.unitId, emptyDraft(step.unit.unitId)); mode = 'idle'; render(); };
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
    lock.textContent = stepIdx + 1 < steps.length ? 'Lock character ▸' : 'Lock & resolve turn ⚔';
    lock.className = 'primary';
    lock.onclick = lockStep;
    lockRow.appendChild(lock);

    const bars = row('');
    bars.textContent = `HP ${step.unit.hp}/${step.unit.maxHp} · Energy ${step.unit.energy}/100`;
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  const currentIsDash = (draft: OrderDraft, character: CharacterDef): boolean =>
    draftAbility(character, draft)?.phase === 'dash';

  function selectAbility(abilityId: string): void {
    const step = currentStep();
    if (step === undefined) return;
    const character = characterFor(step.unit);
    const chosen = draftAbility(character, { ...drafts.get(step.unit.unitId)!, abilityId });
    const isDash = chosen?.phase === 'dash';
    const draft = nextDraft(drafts.get(step.unit.unitId)!, { type: 'selectAbility', abilityId, isDash }, isDash);
    if (chosen && chosen.shape === 'self') draft.aim = [{ ...step.unit.pos }];
    draft.aimStep = undefined;
    drafts.set(step.unit.unitId, draft);
    mode = chosen && chosen.shape !== 'self' ? 'aim' : 'idle';
    render();
  }

  function selectMove(sprint: boolean): void {
    const step = currentStep();
    if (step === undefined) return;
    const prev = drafts.get(step.unit.unitId)!;
    const wasDash = currentIsDash(prev, characterFor(step.unit));
    drafts.set(step.unit.unitId, nextDraft(prev, { type: sprint ? 'selectSprint' : 'selectMove' }, wasDash));
    mode = 'move';
    render();
  }

  function onBoardClick(evt: MouseEvent): void {
    const sq = renderer.squareFromPoint(evt.clientX, evt.clientY);
    if (!sq) return;
    const step = currentStep();
    if (step === undefined) return;
    const draft = drafts.get(step.unit.unitId)!;

    if (mode === 'aim') {
      const ability = draftAbility(characterFor(step.unit), draft);
      if (!ability) return;
      if (isRotatable(ability)) {
        // AIM2: a line/cone is aimed by DIRECTION. The pointer becomes a
        // quantized integer step — the only thing the engine ever sees — so the
        // shape rotates freely instead of snapping to a compass point.
        draft.aimStep = dragToAimStep(step.unit.pos, sq);
        draft.aim = [];
      } else {
        draft.aim = ability.shape === 'path' ? reachPath(step.unit, sq, ability.range) : [sq];
        draft.aimStep = undefined;
      }
      render();
    } else if (mode === 'move' || draft.sprint) {
      draft.movePath = reachPath(step.unit, sq, movementBudget(step.unit, draft.sprint));
      render();
    }
  }

  /**
   * AIM2-UX: a line/cone aims by DIRECTION, so it follows the pointer instead of
   * waiting for a click. The covered tiles update live from `expandShape` at the
   * quantized step — the very tiles the engine will hit — and the click that
   * follows just commits whatever is already on screen. Click-to-aim shapes
   * (circle/square/path) are untouched: there is no direction to preview.
   */
  function onBoardHover(evt: MouseEvent): void {
    if (mode !== 'aim') return;
    const step = currentStep();
    if (step === undefined) return;
    const draft = drafts.get(step.unit.unitId)!;
    const ability = draftAbility(characterFor(step.unit), draft);
    if (ability === undefined || !isRotatable(ability)) return;
    const sq = renderer.squareFromPoint(evt.clientX, evt.clientY);
    if (!sq) return;
    const aimStep = dragToAimStep(step.unit.pos, sq);
    if (aimStep === draft.aimStep) return; // same quantized direction: nothing moved
    draft.aimStep = aimStep;
    draft.aim = [];
    renderPreviews();
  }

  /** A legal path from the unit to `target` within `budget`, or []. */
  function reachPath(unit: UnitState, target: Vec2, budget: number): Vec2[] {
    const board = buildBoard(map);
    const squares = reachableSquares(board, state, unit, budget);
    return reconstructPath(squares, unit.pos, target) ?? [];
  }

  // ── Turn resolution + playback ───────────────────────────────────────────────

  function lockStep(): void {
    stepIdx += 1;
    if (stepIdx >= steps.length) void resolveAndPlay();
    else startStep();
  }

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
