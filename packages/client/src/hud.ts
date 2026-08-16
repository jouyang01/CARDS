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

import type { AbilityDef } from '@cards/engine';
import type { CatalystCost } from './targeting.js';
import type { StatusChip } from './status-pips.js';

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
   * Everything currently on this character (BUFF-UI), in pip order. The
   * floating pips say *something* is on you; this strip is the only place that
   * says what it is and how long it lasts.
   */
  statuses: StatusChip[];
}

export interface HudModel {
  /** The character being ordered; absent during playback/game-over. */
  active?: HudCharacter;
  /** Every character this seat controls, in seat order (the switcher). */
  roster: HudCharacter[];
  abilities: HudAbility[];
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
  hold(): void;
  lock(): void;
  toggleProjection(): void;
  toggleOrbit(): void;
}

export interface Hud {
  /** Show the decision HUD for this model, reusing every node it can. */
  update(model: HudModel): void;
  /** Swap to the resolution HUD: one Skip control, no ordering. */
  showPlayback(onSkip: () => void): void;
  /** Hide everything (game over). */
  clear(): void;
}

const ULT_MARK = '★';

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
  left.append(portrait, identity, bars, statusStrip, switcher);

  // ── bottom-centre: the hotbar ─────────────────────────────────────────────
  const centre = el('div', 'hud-centre');
  const hotbar = el('div', 'hud-hotbar');
  // The catalyst row sits above the hotbar: three slots, once per match, so they
  // read as a resource rather than as four more abilities.
  const catalystRow = el('div', 'hud-catalysts');
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
  centre.append(catalystRow, hotbar, moveRow);

  moveBtn.onclick = () => handlers.selectMove(false);
  sprintBtn.onclick = () => handlers.selectMove(true);
  chaseBtn.onclick = () => handlers.selectChase();
  holdBtn.onclick = () => handlers.hold();
  for (const [btn, kind] of [[moveBtn, 'move'], [sprintBtn, 'sprint']] as const) {
    btn.addEventListener('mouseenter', () => handlers.hoverMove(kind));
    btn.addEventListener('mouseleave', () => handlers.hoverMove(undefined));
  }

  // ── bottom-right: Lock In, immediately right of the hotbar ────────────────
  const right = el('div', 'hud-right');
  const lockBtn = el('button', 'hud-lock');
  lockBtn.onclick = () => handlers.lock();
  const viewRow = el('div', 'hud-view');
  const projBtn = el('button', 'hud-small');
  projBtn.onclick = () => handlers.toggleProjection();
  const orbitBtn = el('button', 'hud-small');
  orbitBtn.onclick = () => handlers.toggleOrbit();
  viewRow.append(projBtn, orbitBtn);
  right.append(viewRow, lockBtn);

  // ── playback: one Skip, replacing the ordering controls ───────────────────
  const playback = el('div', 'hud-playback');
  const skipBtn = el('button', 'hud-lock');
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

  return {
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
        const dot = el('span', 'hud-status-dot');
        dot.style.background = status.colour;
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
        node.title = `${status.label} — ${status.blurb} ${status.remaining} turn${status.remaining === 1 ? '' : 's'} left.`;
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
    },
  };
}
