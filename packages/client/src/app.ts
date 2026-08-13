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
  type AbilityDef,
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
import { abilityOptions, abilityPreview, abilityTooltip, draftAbility, emptyDraft, movePreview, nextDraft, toUnitOrders, type OrderDraft } from './targeting.js';
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

    // Previews (MS1: a non-dash ability and a Move coexist). Paint the move
    // reachability + drawn path first, then the ability's affected squares on
    // top. A dash *is* the movement, so it shows no separate move preview; its
    // move budget is the ability-turn 4 (Haste/Slow-adjusted, 0 if Rooted) —
    // `movePreview` reads that straight off `movementBudget(unit, sprint=false)`.
    const ability = draftAbility(character, draft);
    const isDash = ability?.phase === 'dash';
    if (!isDash && (draft.sprint || mode === 'move' || draft.movePath.length > 0)) {
      const { stops, through } = movePreview(map, state, step.unit, draft.sprint);
      paintOverlay(svg, stops, cssVar('--reach'), 0.28);
      paintOverlay(svg, through, cssVar('--reach'), 0.12);
      paintOverlay(svg, draft.movePath, cssVar('--aim'), 0.5);
    }
    if (ability !== undefined) {
      paintOverlay(svg, abilityPreview(map, step.unit, ability, draft.aim), cssVar('--aim'), 0.5);
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
      b.addEventListener('mouseenter', () => showTip(b, opt.def)); // TT1
      b.addEventListener('mouseleave', hideTip);
      abilityRow.appendChild(b);
    }

    // Live move budget: 4 with an ability, 8 sprinting, 0 rooted (Haste/Slow
    // adjusted) — read straight off the engine so the UI never guesses (MS1).
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
      unitId: v.unitId, owner: v.owner, pos: v.pos, hp: v.hp, maxHp: v.maxHp, energy: v.energy, alive: v.alive,
      label: (v.unitId[0] ?? '?').toUpperCase(), shield: v.shield,
    }));
    const svg = renderBoard(map, units);
    // Decoys (D1): a ghost marker on each live decoy square. Hot-seat shows both
    // sides; team-scoped "enemy sees it as Wisp" is a fog concern for M3.
    const decoys = [...view.decoys.values()];
    if (decoys.length > 0) paintOverlay(svg, decoys.map((d) => d.pos), cssVar('--spawn1'), 0.35);
    ui.board.replaceChildren(svg);
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
