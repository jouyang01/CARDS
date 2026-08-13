/**
 * Hot-seat controller (items 18–20): the interactive shell that drives the
 * tested pure modules — `targeting` (build a UnitOrders), `hotseat` (seats +
 * per-team merge), `playback` (animate the TurnEvent log). All game logic lives
 * in the engine; this file only wires clicks to those modules and paints what
 * they return (Dev Note 1). One player orders at a time; when every seat has
 * locked in, the turn resolves and plays back phase by phase.
 */

import {
  buildBoard,
  createMatch,
  movementBudget,
  reachableSquares,
  reconstructPath,
  resolveTurn,
  type CharacterDef,
  type FormatId,
  type GameState,
  type MapDef,
  type Roster,
  type UnitOrders,
  type UnitState,
  type Vec2,
} from '@cards/engine';
import { cssVar, paintOverlay, renderBoard, renderState, squareFromPoint, type RenderUnit } from './render.js';
import { abilityOptions, abilityPreview, draftAbility, emptyDraft, movePreview, toUnitOrders, type OrderDraft } from './targeting.js';
import { deriveSeats, mergeSeatOrders, type Seat } from './hotseat.js';
import { applyEvent, initView, segmentByPhase, type ViewState } from './playback.js';

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

  const characterFor = (u: UnitState): CharacterDef => roster[u.characterId]!;
  const unitById = (uid: string) => state.units.find((u) => u.unitId === uid);
  const currentStep = () => steps[stepIdx];

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

  function render(): void {
    const step = currentStep();
    if (step === undefined) return;
    const svg = renderState(map, state);
    const draft = drafts.get(step.unit.unitId)!;
    const character = characterFor(step.unit);

    // Highlight the unit being ordered.
    paintOverlay(svg, [step.unit.pos], cssVar('--select'), 0.5);

    // Previews.
    const ability = draftAbility(character, draft);
    if (ability !== undefined) {
      paintOverlay(svg, abilityPreview(map, step.unit, ability, draft.aim), cssVar('--aim'), 0.5);
    } else if (draft.sprint || mode === 'move') {
      const { stops, through } = movePreview(map, state, step.unit, draft.sprint);
      paintOverlay(svg, stops, cssVar('--reach'), 0.28);
      paintOverlay(svg, through, cssVar('--reach'), 0.12);
      paintOverlay(svg, draft.movePath, cssVar('--aim'), 0.5);
    }

    svg.style.cursor = 'crosshair';
    svg.addEventListener('click', onBoardClick);
    ui.board.replaceChildren(svg);
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
      abilityRow.appendChild(b);
    }

    const moveRow = row('Move: ');
    const moveBtn = document.createElement('button');
    moveBtn.textContent = 'Draw move';
    moveBtn.className = mode === 'move' && !draft.sprint ? 'sel' : '';
    moveBtn.onclick = () => selectMove(false);
    const sprintBtn = document.createElement('button');
    sprintBtn.textContent = 'Sprint';
    sprintBtn.className = draft.sprint ? 'sel' : '';
    sprintBtn.onclick = () => selectMove(true);
    const holdBtn = document.createElement('button');
    holdBtn.textContent = 'Hold / clear';
    holdBtn.onclick = () => { drafts.set(step.unit.unitId, emptyDraft(step.unit.unitId)); mode = 'idle'; render(); };
    moveRow.append(moveBtn, sprintBtn, holdBtn);

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

  function selectAbility(abilityId: string): void {
    const step = currentStep();
    if (step === undefined) return;
    const draft = drafts.get(step.unit.unitId)!;
    draft.abilityId = abilityId;
    draft.sprint = false;
    draft.aim = [];
    draft.movePath = [];
    const ability = draftAbility(characterFor(step.unit), draft);
    mode = ability && ability.shape !== 'self' ? 'aim' : 'idle';
    if (ability && ability.shape === 'self') draft.aim = [{ ...step.unit.pos }];
    render();
  }

  function selectMove(sprint: boolean): void {
    const step = currentStep();
    if (step === undefined) return;
    const draft = drafts.get(step.unit.unitId)!;
    draft.abilityId = undefined;
    draft.aim = [];
    draft.sprint = sprint;
    draft.movePath = [];
    mode = 'move';
    render();
  }

  function onBoardClick(evt: MouseEvent): void {
    const svg = ui.board.querySelector('svg');
    if (!svg) return;
    const sq = squareFromPoint(svg as unknown as SVGSVGElement, evt.clientX, evt.clientY);
    if (!sq) return;
    const step = currentStep();
    if (step === undefined) return;
    const draft = drafts.get(step.unit.unitId)!;

    if (mode === 'aim') {
      const ability = draftAbility(characterFor(step.unit), draft);
      if (!ability) return;
      draft.aim = ability.shape === 'path' ? reachPath(step.unit, sq, ability.range) : [sq];
      render();
    } else if (mode === 'move' || draft.sprint) {
      draft.movePath = reachPath(step.unit, sq, movementBudget(step.unit, draft.sprint));
      render();
    }
  }

  /** A legal orthogonal path from the unit to `target` within `budget`, or []. */
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

    // Play back phase by phase from the event log.
    const view = initView(prev);
    for (const segment of segmentByPhase(result.events)) {
      for (const e of segment.events) applyEvent(view, e);
      renderView(view);
      ui.status.textContent = `Turn ${prev.turn} · resolving — ${segment.phase.toUpperCase()}`;
      ui.controls.replaceChildren();
      await sleep(650);
    }

    state = result.state;
    if (state.status !== 'active') return renderGameOver();
    beginTurn();
  }

  function renderView(view: ViewState): void {
    const units: RenderUnit[] = [...view.units.values()].map((v) => ({
      owner: v.owner, pos: v.pos, hp: v.hp, maxHp: v.maxHp, energy: v.energy, alive: v.alive,
      label: (v.unitId[0] ?? '?').toUpperCase(), shield: v.shield,
    }));
    ui.board.replaceChildren(renderBoard(map, units));
  }

  function renderGameOver(): void {
    ui.board.replaceChildren(renderState(map, state));
    ui.controls.replaceChildren();
    ui.status.textContent = state.status === 'draw'
      ? 'Double KO — the match is a draw.'
      : `${teamName(state.winner ?? 0)} wins! (${state.kills[0]}–${state.kills[1]})`;
  }

  const teamName = (t: number) => (t === 0 ? 'Team 1' : 'Team 2');

  beginTurn();
}
