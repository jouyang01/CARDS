/**
 * The decision-phase HUD (UI3) — bottom-left character panel, bottom-centre
 * ability hotbar, bottom-right Lock In.
 *
 * **Built once, updated in place.** The old controls called `replaceChildren`
 * on every render, which is fine until UI1 makes hover meaningful: rebuilding a
 * button under the pointer fires `mouseleave` on a node that no longer exists,
 * so the hover state you just set is immediately cleared by its own repaint.
 * Keyed nodes (A1's principle, in DOM) fix that structurally — a button
 * survives the frame, so the pointer stays over the same element.
 *
 * This module owns *presentation only*. It is handed a plain `HudModel` and a
 * bag of handlers; it never reads game state, never consults the roster, and
 * never decides what is legal. `abilityOptions` already answers availability, so
 * nothing here re-derives it.
 */

import { TIMEBANK_SECONDS, type AbilityDef } from '@cards/engine';
import type { CatalystCost } from './targeting.js';
import type { StatusChip } from './status-pips.js';
import { ULT_MARK } from './hud-marks.js';
import type { InspectPanel } from './inspect.js';
import { renderInspectPanel } from './inspect-panel.js';
import { createTooltip, delegateTooltips } from './tooltip.js';
import type { TimerView } from './timer.js';
import type { ModeOption } from './targeting.js';

export interface HudAbility {
  id: string;
  name: string;
  isUlt: boolean;
  available: boolean;
  /** Why it is unavailable, straight from `abilityOptions`. */
  /**
   * Why it is unavailable. A closed set, not free text: the HUD owns the
   * wording (`3t`, `energy`, `catalyst`), the caller owns the fact.
   */
  reason?: 'cooldown' | 'energy' | 'catalyst';
  cooldown: number;
  selected: boolean;
  /**
   * A **free action** (FREE-UI): additive, so the hotbar has to say so. A
   * player who cannot tell a free ability from a normal one will spend their
   * turn on it — which is exactly what the shipped UI made them do.
   */
  free: boolean;
  /** The definition itself, so the TT1 tooltip survives into the hotbar. */
  def: AbilityDef;
}

/**
 * One catalyst slot (CAT2). `spent` is read from the engine's `catalystsUsed`,
 * never inferred from the log — a slot greyed out by a missed event would be a
 * lie the player cannot argue with.
 */
export interface HudCatalyst {
  id: string;
  name: string;
  /** The phase it fires in — the slot's colour, in the Prep/Dash/Blast order. */
  phase: string;
  /**
   * What spending it costs (CAT-COST-LABEL). Passed as the *rule*, not as the
   * wording: the HUD owns how a cost reads, the caller owns what it is.
   */
  cost: CatalystCost;
  spent: boolean;
  selected: boolean;
  def: AbilityDef;
}

export interface HudCharacter {
  unitId: string;
  name: string;
  archetype: string;
  /** Team colour as a CSS colour, so the HUD needs no palette of its own. */
  colour: string;
  hp: number;
  maxHp: number;
  energy: number;
  shield: number;
  locked: boolean;
  hasOrder: boolean;
  /**
   * Everything currently on this character (BUFF-UI), in pip order. The plate's
   * icon row says *something* is on you; this strip is the only place that says
   * what it is and how long it lasts.
   */
  statuses: StatusChip[];
}

export interface HudModel {
  /** The character being ordered; absent during playback/game-over. */
  active?: HudCharacter;
  /** Every character this seat controls, in seat order (the switcher). */
  roster: HudCharacter[];
  abilities: HudAbility[];
  /**
   * BASIC-MODES — the armed ability's two aim-time profiles, or empty when it
   * has none (which is every ability but one).
   *
   * A row of its own rather than a second state on the ability button: the
   * ability and the mode are two decisions, and folding them into one control
   * would make "switch to Focus" and "re-arm Twin Bolts" the same click.
   */
  modes: ModeOption[];
  /**
   * WALL-ROTATE — the four cardinals a *placed* shape may be turned to, or empty
   * for every ability that is not one (which is all of them but Warding Wall).
   *
   * Its own row beside `modes` rather than folded into it, because they answer
   * different questions with the same widget: a mode changes **what the ability
   * is**, a rotation changes **which way this placement points**. An ability
   * could one day want both, and a single row could not show them.
   *
   * `index` carries the aim step itself rather than a 0..3 position — the value
   * the draft stores and the engine reads, so nothing in between has to map it
   * back.
   */
  rotations: ModeOption[];
  /** The three catalyst slots, in phase order. Empty if the match has no pool. */
  catalysts: HudCatalyst[];
  move: { budget: number; drawing: boolean; sprinting: boolean; sprintDisabled: boolean };
  /**
   * The chase control (CHASE1). `targetName` is who is being chased, so the
   * button can say so — a chase is the one order whose subject is a unit rather
   * than a square, and "Chase" alone would not tell you whom.
   */
  chase: { armed: boolean; disabled: boolean; targetName?: string };
  lock: { label: string };
  view: { projection: string; orbit: boolean };
}

export interface HudHandlers {
  selectCharacter(unitId: string): void;
  selectAbility(abilityId: string): void;
  selectCatalyst(catalystId: string): void;
  hoverAbility(abilityId: string | undefined, control?: HTMLElement, def?: AbilityDef): void;
  selectMove(sprint: boolean): void;
  selectChase(): void;
  hoverMove(kind: 'move' | 'sprint' | undefined): void;
  /** UI-TIMER: the player spent their Time Bank charge. */
  extendTime(): void;
  /** BASIC-MODES: the player flipped the armed ability's aim-time profile. */
  selectMode(mode: number): void;
  /** WALL-ROTATE: the player turned a placed shape to one of its four cardinals. */
  selectRotation(aimStep: number): void;
  hold(): void;
  lock(): void;
  toggleProjection(): void;
  toggleOrbit(): void;
}

export interface Hud {
  /** Show the decision HUD for this model, reusing every node it can. */
  update(model: HudModel): void;
  /**
   * UI-INSPECT: show (or hide, with `undefined`) the inspect panel for a unit
   * under the pointer, anchored near `at` in viewport coordinates.
   */
  inspect(panel: InspectPanel | undefined, at?: { x: number; y: number }): void;
  /**
   * UI-TIMER: the countdown beside LOCK IN. `undefined` hides it (playback,
   * game over) — a clock still ticking over a resolved turn is a lie.
   */
  setTimer(view: TimerView | undefined): void;
  /**
   * M3-WAIT-STATE / M3-CONN-STATE — a banner over the HUD saying why the board
   * is not taking orders: the turn is sent and the opponent is still deciding,
   * or the socket has gone. `undefined` hides it.
   *
   * A banner rather than a disabled button alone, because "nothing happens when
   * I click" needs a reason attached or it reads as a freeze — which is exactly
   * the complaint both items were opened for.
   */
  setBanner(text: string | undefined): void;
  /** Swap to the resolution HUD: one Skip control, no ordering. */
  showPlayback(onSkip: () => void): void;
  /** Hide everything (game over). */
  clear(): void;
}



const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
};

/**
 * A labelled bar whose fill is set by fraction — HP, shield and energy share it.
 * `hideWhenEmpty` is for shield: a permanent "SH 0/95" is noise, and the bar
 * appearing is itself the signal that someone shielded you.
 */
function makeBar(label: string, kind: string, opts: { hideWhenEmpty?: boolean; showTotal?: boolean } = {}):
  { root: HTMLElement; set(value: number, max: number): void } {
  const root = el('div', 'hud-bar');
  const name = el('span', 'hud-bar-label');
  name.textContent = label;
  const track = el('div', `hud-bar-track ${kind}`);
  const fill = el('div', 'hud-bar-fill');
  track.appendChild(fill);
  const readout = el('span', 'hud-bar-value');
  root.append(name, track, readout);
  return {
    root,
    set(value, max) {
      const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
      fill.style.width = `${(frac * 100).toFixed(1)}%`;
      readout.textContent = opts.showTotal === false ? `${value}` : `${value}/${max}`;
      root.style.display = max > 0 && !(opts.hideWhenEmpty === true && value <= 0) ? '' : 'none';
    },
  };
}

export function createHud(root: HTMLElement, handlers: HudHandlers): Hud {
  root.replaceChildren();
  root.classList.add('hud');

  // ── bottom-left: who am I ordering ────────────────────────────────────────
  const left = el('div', 'hud-left');
  const portrait = el('div', 'hud-portrait');
  const identity = el('div', 'hud-identity');
  const charName = el('div', 'hud-name');
  const charRole = el('div', 'hud-role');
  identity.append(charName, charRole);
  const statusStrip = el('div', 'hud-statuses');
  const bars = el('div', 'hud-bars');
  const hp = makeBar('HP', 'hp');
  const shield = makeBar('SH', 'shield', { hideWhenEmpty: true, showTotal: false });
  const energy = makeBar('EN', 'energy');
  bars.append(hp.root, shield.root, energy.root);
  const switcher = el('div', 'hud-switcher');

  // ── bottom-centre: the hotbar ─────────────────────────────────────────────
  const centre = el('div', 'hud-centre');
  const hotbar = el('div', 'hud-hotbar');
  /**
   * HUD-LAYOUT — the catalyst row is **bottom-left, beside the character**
   * (owner AC 1). It used to sit above the hotbar in the centre column.
   *
   * Three slots, once per match, so they read as a resource rather than as four
   * more abilities — and a resource belongs with the character that owns it,
   * next to its HP and energy, rather than in the column the turn is *spent*
   * from. Moving it out is also half of why the board grew: the centre column
   * was five stacked rows and is now three (AC 5).
   */
  const catalystRow = el('div', 'hud-catalysts');
  left.append(portrait, identity, bars, statusStrip, switcher, catalystRow);
  // BASIC-MODES: the mode row sits between the hotbar and the move controls —
  // under the ability it belongs to, above the movement it trades against.
  // Hidden when the armed ability has no modes, which is almost always.
  const modeRow = el('div', 'hud-modes');
  modeRow.style.display = 'none';
  // WALL-ROTATE: the rotate row lives directly under the mode row, for the same
  // reason the mode row lives under the hotbar — it qualifies the armed ability,
  // so it belongs between the ability and the movement it trades against.
  const rotateRow = el('div', 'hud-rotations');
  rotateRow.style.display = 'none';
  /**
   * HUD-LAYOUT — the movement controls are **bottom-right** (owner AC 2).
   *
   * They were the last row of the centre column, under the abilities. Move is
   * the thing a turn does *as well as* an ability rather than instead of one
   * (MS1), so it reads better as its own corner than as a fifth row of the
   * column the ability is chosen from — and the centre column is what was
   * pushing the board up.
   */
  const moveRow = el('div', 'hud-moves');
  const moveBtn = el('button', 'hud-move');
  moveBtn.textContent = 'Move';
  const sprintBtn = el('button', 'hud-move');
  sprintBtn.textContent = 'Sprint';
  const chaseBtn = el('button', 'hud-move');
  chaseBtn.textContent = 'Chase';
  const holdBtn = el('button', 'hud-move');
  holdBtn.textContent = 'Clear';
  moveRow.append(moveBtn, sprintBtn, chaseBtn, holdBtn);

  moveBtn.onclick = () => handlers.selectMove(false);
  sprintBtn.onclick = () => handlers.selectMove(true);
  chaseBtn.onclick = () => handlers.selectChase();
  holdBtn.onclick = () => handlers.hold();
  for (const [btn, kind] of [[moveBtn, 'move'], [sprintBtn, 'sprint']] as const) {
    btn.addEventListener('mouseenter', () => handlers.hoverMove(kind));
    btn.addEventListener('mouseleave', () => handlers.hoverMove(undefined));
  }

  // ── TIMER-BAR: the clock is a draining bar across the top of the hotbar,
  //    running into an enlarged Lock In at its right end ─────────────────────
  //
  // Dev Notes #6+#7, one redesign rather than two. The countdown used to be a
  // number stacked above the button in the right-hand column, which put the two
  // things a player watches in the last ten seconds — how long is left, and the
  // button that ends it — in a corner, at the size of everything else in that
  // corner. AR puts the deadline *across the abilities it applies to* and makes
  // the button the largest thing on the bar, and that is what this is.
  //
  // The row survives the timer being hidden. `setTimer(undefined)` hides the
  // bar during playback (there is no deadline then), and Lock In has to stay —
  // so the button is a sibling of the bar rather than a child of it.
  const lockRow = el('div', 'hud-lockrow');
  const timerRow = el('div', 'hud-timer');
  const timerTrack = el('div', 'hud-timer-track');
  const timerFill = el('div', 'hud-timer-fill');
  timerTrack.appendChild(timerFill);
  const timerText = el('span', 'hud-timer-text');
  const bankBtn = el('button', 'hud-bank');
  bankBtn.onclick = () => handlers.extendTime();
  timerRow.append(timerTrack, timerText, bankBtn);
  const lockBtn = el('button', 'hud-lock');
  lockBtn.onclick = () => handlers.lock();
  lockRow.append(timerRow, lockBtn);
  // HUD-LAYOUT (AC 3): the centre column is now Lock In + timer, the abilities,
  // and the mode toggle — three rows where there were five. The bar sits
  // directly over the hotbar it times, in the slot the catalyst row vacated.
  centre.append(lockRow, hotbar, modeRow, rotateRow);

  // ── bottom-right: the view toggles and the waiting banner ─────────────────
  const right = el('div', 'hud-right');
  // Built once and hidden, like every other node here (UI3): a banner created
  // on demand would be a new element under the pointer on the frame it appears.
  const banner = el('div', 'hud-banner');
  banner.style.display = 'none';
  const viewRow = el('div', 'hud-view');
  const projBtn = el('button', 'hud-small');
  projBtn.onclick = () => handlers.toggleProjection();
  const orbitBtn = el('button', 'hud-small');
  orbitBtn.onclick = () => handlers.toggleOrbit();
  viewRow.append(projBtn, orbitBtn);
  // HUD-LAYOUT: the movement row is last, so it sits at the very bottom-right
  // (the column is bottom-aligned) — the corner the owner's annotation puts it
  // in, and diagonally opposite the catalysts it trades against.
  right.append(banner, viewRow, moveRow);

  // ── playback: one Skip, replacing the ordering controls ───────────────────
  const playback = el('div', 'hud-playback');
  // HUD-LAYOUT folds in Builder OQ 2026-09-20 #5: Skip wore `hud-lock`, so
  // "the first `.hud-lock`" meant Lock In only by accident of row order and a
  // test that addressed it that way would have started pressing Skip the day
  // the rows moved — which is this item. It styles the same; it is not the
  // same control, and the DOM now says so.
  const skipBtn = el('button', 'hud-skip');
  skipBtn.textContent = 'Skip ⏭';
  playback.appendChild(skipBtn);
  playback.style.display = 'none';

  root.append(left, centre, right, playback);

  // Keyed nodes: an ability button and a character chip are looked up by id and
  // REUSED, never recreated, so the pointer never loses the element under it.
  const abilityNodes = new Map<string, HTMLButtonElement>();
  const catalystNodes = new Map<string, HTMLButtonElement>();
  const chipNodes = new Map<string, HTMLButtonElement>();
  const statusNodes = new Map<string, HTMLElement>();

  const setOrdering = (visible: boolean): void => {
    for (const node of [left, centre, right]) node.style.display = visible ? '' : 'none';
    playback.style.display = visible ? 'none' : '';
  };

  // ── UI-INSPECT: one floating panel, built once and re-filled ─────────────
  // Built once for the same reason the hotbar is: it is rebuilt on every
  // pointer move over the board, and replacing the node under the pointer is
  // how you lose a hover to its own repaint.
  const inspectPanel = el('div', 'inspect');
  inspectPanel.style.display = 'none';
  document.body.appendChild(inspectPanel);

  /**
   * TOOLTIP-SWEEP — instant tooltips for the HUD's `data-tip` nodes (the Time
   * Bank pip and the status chips), replacing native `title`.
   *
   * Delegated over the whole HUD rather than wired per node, because these
   * nodes are keyed and re-filled on every update (UI3): the text changes every
   * turn while the element stays, so an attribute the update already writes is
   * the natural carrier and one listener on the root is the natural reader.
   */
  const tip = createTooltip();
  delegateTooltips(root, tip);

  return {
    setBanner(text) {
      banner.textContent = text ?? '';
      banner.style.display = text === undefined ? 'none' : '';
    },

    setTimer(view) {
      timerRow.style.display = view === undefined ? 'none' : '';
      if (view === undefined) return;
      // TIMER-BAR: the bar is the primary read and the number is the precise
      // one. `fraction` is already clamped by `timerView`, so the width is a
      // straight percentage and the model owns the arithmetic.
      timerFill.style.width = `${Math.round(view.fraction * 1000) / 10}%`;
      timerFill.classList.toggle('urgent', view.urgent);
      timerFill.classList.toggle('expired', view.expired);
      timerText.textContent = view.text;
      timerText.classList.toggle('urgent', view.urgent);
      timerText.classList.toggle('expired', view.expired);
      // The extension has to be *seen*. A +10 s that silently changed the number
      // would read as a miscount, and the one thing a player must never wonder
      // about is whether their own charge was consumed.
      timerRow.classList.toggle('extending', view.extending);
      // One pip per charge (we have one; AR shows two). Spent reads as an empty
      // socket rather than as nothing, so the resource is still legible after
      // it is gone.
      bankBtn.textContent = view.charges > 0 ? '●' : '○';
      // TOOLTIP-SWEEP: `data-tip`, not `title` — the browser's reveal delay is
      // about a second, and this is the button a player reaches for with eight
      // seconds on the clock.
      bankBtn.dataset['tip'] = view.charges > 0
        ? `Time Bank — add ${TIMEBANK_SECONDS} seconds (${view.charges} left)`
        : 'Time Bank — spent';
      bankBtn.disabled = !view.canExtend;
      bankBtn.classList.toggle('spent', view.charges <= 0);
    },

    inspect(panel, at) {
      // LOBBY-INSPECT moved the drawing into `inspect-panel.ts` so the lobby
      // can show the same panel. The HUD keeps the node — built once, never
      // recreated (UI3) — and hands it over.
      renderInspectPanel(inspectPanel, panel, at);
    },

    update(model) {
      setOrdering(true);

      const active = model.active;
      if (active !== undefined) {
        portrait.textContent = active.name.slice(0, 1).toUpperCase();
        portrait.style.background = active.colour;
        charName.textContent = active.name;
        charRole.textContent = active.archetype;
        hp.set(active.hp, active.maxHp);
        shield.set(active.shield, active.maxHp);
        energy.set(active.energy, 100);
      }

      // BUFF-UI. The strip is absent, not empty, when nothing is on the
      // character: a permanently reserved blank row reads as a thing that is
      // broken rather than as a thing that is quiet.
      const statuses = active?.statuses ?? [];
      statusStrip.style.display = statuses.length > 0 ? '' : 'none';
      for (const status of statuses) {
        let node = statusNodes.get(status.kind);
        if (node === undefined) {
          node = el('span', 'hud-status');
          statusNodes.set(status.kind, node);
          statusStrip.appendChild(node);
        }
        node.replaceChildren();
        // STATUS-ICONS: the same glyph that floats over the unit, so the board
        // and the strip teach each other rather than being two vocabularies.
        // `innerHTML` is safe here — the markup is built from a fixed path table
        // and a colour this module never sees a user write.
        const dot = el('span', 'hud-status-dot');
        dot.innerHTML = status.glyph;
        const name = el('span', 'hud-status-name');
        name.textContent = status.label;
        node.append(dot, name);
        // Shields carry what is left to absorb as well as how long: "1t" on a
        // shield that has already eaten everything it was going to is a promise
        // the bar has already broken.
        if (status.amount !== undefined) {
          const amount = el('span', 'hud-status-amount');
          amount.textContent = String(status.amount);
          node.appendChild(amount);
        }
        const turns = el('span', 'hud-status-turns');
        // "1t" is the last turn it is on you, so it reads as a countdown rather
        // than as an age.
        turns.textContent = `${status.remaining}t`;
        node.appendChild(turns);
        node.classList.toggle('harm', status.harmful);
        // TOOLTIP-SWEEP: what a status actually does is the thing a player
        // most often does not know, so it is the worst place for a delay.
        node.dataset['tip'] = `${status.label} — ${status.blurb} ${status.remaining} turn${status.remaining === 1 ? '' : 's'} left.`;
      }
      for (const [kind, node] of statusNodes) {
        if (!statuses.some((s) => s.kind === kind)) { node.remove(); statusNodes.delete(kind); }
      }
      for (const status of statuses) statusStrip.appendChild(statusNodes.get(status.kind)!);

      // Character switcher — only earns its space when the seat runs more than one.
      switcher.style.display = model.roster.length > 1 ? '' : 'none';
      for (const character of model.roster) {
        let chip = chipNodes.get(character.unitId);
        if (chip === undefined) {
          chip = el('button', 'hud-chip');
          chip.onclick = () => handlers.selectCharacter(character.unitId);
          chipNodes.set(character.unitId, chip);
          switcher.appendChild(chip);
        }
        // ✓ locked, • has an order but is still editable, nothing = holding.
        const mark = character.locked ? ' ✓' : character.hasOrder ? ' •' : '';
        chip.textContent = character.name + mark;
        chip.disabled = character.locked;
        chip.classList.toggle('sel', character.unitId === active?.unitId);
      }
      for (const [unitId, chip] of chipNodes) {
        if (!model.roster.some((c) => c.unitId === unitId)) { chip.remove(); chipNodes.delete(unitId); }
      }

      for (const ability of model.abilities) {
        let btn = abilityNodes.get(ability.id);
        if (btn === undefined) {
          btn = el('button', 'hud-ability');
          btn.onclick = () => handlers.selectAbility(ability.id);
          // Hover drives UI1's range envelope and TT1's tooltip from one place.
          btn.addEventListener('mouseenter', () => {
            const current = model.abilities.find((a) => a.id === ability.id);
            handlers.hoverAbility(ability.id, btn, current?.def ?? ability.def);
          });
          btn.addEventListener('mouseleave', () => handlers.hoverAbility(undefined));
          abilityNodes.set(ability.id, btn);
          hotbar.appendChild(btn);
        }
        btn.replaceChildren();
        const name = el('span', 'hud-ability-name');
        name.textContent = ability.name + (ability.isUlt ? ` ${ULT_MARK}` : '');
        btn.appendChild(name);
        // Cooldown/energy is the more urgent note when both apply — "free" tells
        // you how it costs, "3t" tells you that you cannot have it at all.
        const note = !ability.available
          ? ability.reason === 'cooldown' ? `${ability.cooldown}t`
            // CAT-DASH-FULL: the Dash catalyst is the turn, so the hotbar is not
            // "on cooldown" or "too expensive" — it is spoken for.
            : ability.reason === 'catalyst' ? 'catalyst'
            : 'energy'
          : ability.free ? 'free' : '';
        if (note !== '') {
          const el2 = el('span', 'hud-ability-note');
          el2.textContent = note;
          btn.appendChild(el2);
        }
        btn.disabled = !ability.available;
        btn.classList.toggle('sel', ability.selected);
        btn.classList.toggle('ult', ability.isUlt);
        btn.classList.toggle('free', ability.free);
      }
      for (const [id, btn] of abilityNodes) {
        if (!model.abilities.some((a) => a.id === id)) { btn.remove(); abilityNodes.delete(id); }
      }
      // Keep the hotbar in model order even as characters change.
      for (const ability of model.abilities) hotbar.appendChild(abilityNodes.get(ability.id)!);

      // BASIC-MODES: rebuilt wholesale rather than keyed like the hotbar. Two
      // buttons that only exist while one ability is armed have no hover state
      // worth preserving across a repaint, and keying them would mean reasoning
      // about a node that belongs to an ability the player has since switched.
      modeRow.style.display = model.modes.length > 0 ? '' : 'none';
      modeRow.replaceChildren();
      for (const mode of model.modes) {
        const btn = el('button', 'hud-mode');
        btn.textContent = mode.label;
        btn.dataset['mode'] = String(mode.index);
        btn.classList.toggle('sel', mode.selected);
        btn.onclick = () => handlers.selectMode(mode.index);
        modeRow.appendChild(btn);
      }

      // WALL-ROTATE: rebuilt wholesale, exactly like the mode row above and for
      // the same reason — four buttons that exist only while one ability is
      // armed have no state worth keying across a repaint.
      rotateRow.style.display = model.rotations.length > 0 ? '' : 'none';
      rotateRow.replaceChildren();
      for (const rotation of model.rotations) {
        const btn = el('button', 'hud-rotate');
        btn.textContent = rotation.label;
        btn.dataset['rotation'] = String(rotation.index);
        btn.classList.toggle('sel', rotation.selected);
        btn.onclick = () => handlers.selectRotation(rotation.index);
        rotateRow.appendChild(btn);
      }

      catalystRow.style.display = model.catalysts.length > 0 ? '' : 'none';
      for (const catalyst of model.catalysts) {
        let btn = catalystNodes.get(catalyst.id);
        if (btn === undefined) {
          btn = el('button', 'hud-catalyst');
          btn.onclick = () => handlers.selectCatalyst(catalyst.id);
          btn.addEventListener('mouseenter', () => handlers.hoverAbility(catalyst.id, btn, catalyst.def));
          btn.addEventListener('mouseleave', () => handlers.hoverAbility(undefined));
          catalystNodes.set(catalyst.id, btn);
          catalystRow.appendChild(btn);
        }
        btn.replaceChildren();
        const name = el('span', 'hud-ability-name');
        // Spent slots keep their name and go dim: an empty box tells you nothing
        // about what you spent, which is the thing you want to remember.
        name.textContent = catalyst.name;
        btn.appendChild(name);
        const note = el('span', 'hud-ability-note');
        note.textContent = catalyst.spent ? 'spent' : catalyst.phase;
        btn.appendChild(note);
        // CAT-COST-LABEL: "Prep Catalyst and Blast Catalyst are not showing as
        // free actions." Free abilities already carried a `free` tag and the
        // catalyst row carried none, so the two additive mechanics on screen at
        // once looked like different kinds of thing. Post-CAT-DASH-FULL the
        // answer differs by colour, which makes the tag load-bearing rather than
        // decorative: Dash is the one slot that *is* your turn.
        if (!catalyst.spent) {
          const cost = el('span', `hud-catalyst-cost ${catalyst.cost}`);
          cost.textContent = catalyst.cost === 'action' ? 'your action' : 'free';
          btn.appendChild(cost);
        }
        btn.disabled = catalyst.spent;
        btn.classList.toggle('spent', catalyst.spent);
        btn.classList.toggle('sel', catalyst.selected);
        btn.dataset['phase'] = catalyst.phase;
      }
      for (const [id, btn] of catalystNodes) {
        if (!model.catalysts.some((c) => c.id === id)) { btn.remove(); catalystNodes.delete(id); }
      }
      for (const catalyst of model.catalysts) catalystRow.appendChild(catalystNodes.get(catalyst.id)!);

      moveBtn.textContent = `Move (${model.move.budget})`;
      moveBtn.classList.toggle('sel', model.move.drawing && !model.move.sprinting);
      sprintBtn.classList.toggle('sel', model.move.sprinting);
      sprintBtn.disabled = model.move.sprintDisabled;

      // A chase names its quarry (CHASE1): the order's subject is a unit, not a
      // square, so the label is the only place on screen that says whom.
      chaseBtn.textContent = model.chase.targetName === undefined ? 'Chase' : `Chase ${model.chase.targetName}`;
      chaseBtn.classList.toggle('sel', model.chase.armed);
      chaseBtn.disabled = model.chase.disabled;

      lockBtn.textContent = model.lock.label;
      projBtn.textContent = model.view.projection;
      orbitBtn.textContent = model.view.orbit ? 'Free orbit' : 'Auto camera';
      orbitBtn.classList.toggle('sel', model.view.orbit);
    },

    showPlayback(onSkip) {
      setOrdering(false);
      skipBtn.onclick = onSkip;
    },

    clear() {
      for (const node of [left, centre, right, playback]) node.style.display = 'none';
      inspectPanel.style.display = 'none';
    },
  };
}
