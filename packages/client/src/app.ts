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
  type Roster,
  type UnitOrders,
  type UnitState,
  type Vec2,
} from '@cards/engine';
import { createRenderer, type ProjectionName, type RenderUnit, type Renderer } from './renderer3d.js';
import { createTurnPlayer } from './turn-player.js';
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

/** Beats are shown as a plain pause for now; the A3 re-spec tweens them. */
const PHASE_MS = 520;
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
  globalThis.addEventListener('resize', () => { sizeToContainer(); fitCamera(); renderer.render(); });
  ui.board.addEventListener('click', onBoardClick);

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
  }));

  const viewUnits = (view: ViewState): RenderUnit[] => [...view.units.values()].map((v) => ({
    unitId: v.unitId, owner: v.owner, pos: v.pos, hp: v.hp, maxHp: v.maxHp,
    energy: v.energy, alive: v.alive, label: (v.unitId[0] ?? '?').toUpperCase(), shield: v.shield,
  }));

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
    const draft = drafts.get(step.unit.unitId)!;
    const character = characterFor(step.unit);

    renderer.show(stateUnits(), state.decoys.map((d) => d.pos));
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
      ability !== undefined
        ? abilityPreview(map, step.unit, ability, draft.aim, draft.aimStep)
        : draft.movePath,
      AIM,
      0.5,
    );
    renderer.render();

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
    viewRow.appendChild(proj);

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
    // agree by construction. Cue-driven tweening is the A3 re-spec's job.
    const player = createTurnPlayer(prev, result.events);
    for (const layer of ['reach', 'aim', 'select'] as const) renderer.highlight(layer, [], 0);
    renderer.show(viewUnits(player.view), []);
    renderer.render();

    let skipped = false;
    renderPlaybackControls(() => {
      skipped = true;
      player.skip();
      renderer.show(viewUnits(player.view), []);
      renderer.render();
    });

    for (let step = player.advancePhase(); step !== undefined; step = player.advancePhase()) {
      ui.status.textContent = `Turn ${prev.turn} · resolving — ${step.phase.toUpperCase()}`;
      renderer.show(viewUnits(player.view), []);
      renderer.render();
      if (!skipped) await sleep(PHASE_MS);
    }
    renderer.show(viewUnits(player.view), []);
    renderer.render();

    state = result.state;
    if (state.status !== 'active') return renderGameOver();
    beginTurn();
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
    renderer.render();
    ui.controls.replaceChildren();
    ui.status.textContent = state.status === 'draw'
      ? 'Double KO — the match is a draw.'
      : `${teamName(state.winner ?? 0)} wins! (${state.kills[0]}–${state.kills[1]})`;
  }

  const teamName = (t: number) => (t === 0 ? 'Team 1' : 'Team 2');

  beginTurn();
}
