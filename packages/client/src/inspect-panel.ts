/**
 * UI-INSPECT's panel, as DOM — shared by the board and the lobby.
 *
 * Extracted from `hud.ts` for LOBBY-INSPECT (Dev Note #2: *hover a character in
 * the lobby → details*). The lobby wants the same panel the board shows, and
 * the honest way to have the same panel twice is to have it once: a second
 * renderer built from the same `InspectPanel` would drift the moment either
 * side gained a row, and "the lobby says something different about this
 * character" is precisely the confusion the hover is meant to remove.
 *
 * Presentation only. Everything it draws is decided in `inspect.ts`, which is
 * where the vision gate and the decoy rules live; this file has no opinions and
 * asks no questions.
 */

import { ULT_MARK } from './hud-marks.js';
import { placeBeside } from './tooltip.js';
import type { InspectPanel } from './inspect.js';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
};

/**
 * Fill `node` with `panel`, or hide it when there is nothing to show.
 *
 * `at` positions it beside the pointer, kept inside the viewport. Omitted, the
 * caller owns the placement — the lobby anchors its panel with CSS rather than
 * chasing the mouse across a form.
 */
export function renderInspectPanel(
  node: HTMLElement,
  panel: InspectPanel | undefined,
  at?: { x: number; y: number },
): void {
  if (panel === undefined) {
    node.style.display = 'none';
    return;
  }
  node.replaceChildren();
  node.classList.toggle('t1', panel.team === 1);

  const head = el('div', 'inspect-head');
  const title = el('div', 'inspect-name');
  title.textContent = panel.name;
  const role = el('div', 'inspect-role');
  // A frozen panel is a decoy's. The player is never told that — the label
  // is the archetype either way — but the flag rides along so nothing
  // downstream mistakes a snapshot for live data.
  role.textContent = panel.archetype;
  head.append(title, role);

  const vitals = el('div', 'inspect-vitals');
  const hp = el('span', 'inspect-hp');
  hp.textContent = panel.shield > 0
    ? `${panel.hp}/${panel.maxHp} +${panel.shield}`
    : `${panel.hp}/${panel.maxHp}`;
  const energy = el('span', 'inspect-energy');
  energy.textContent = panel.ult ? `${panel.energy} ULT` : String(panel.energy);
  energy.classList.toggle('ult', panel.ult);
  vitals.append(hp, energy);

  const slots = el('div', 'inspect-slots');
  for (const ability of panel.abilities) {
    const row = el('div', 'inspect-slot');
    row.classList.toggle('ult', ability.isUlt);
    row.classList.toggle('down', !ability.ready);
    const name = el('span', 'inspect-slot-name');
    name.textContent = ability.name + (ability.isUlt ? ` ${ULT_MARK}` : '');
    const note = el('span', 'inspect-slot-note');
    // The owner's actual question is "can that character do the thing to me
    // this turn", so a charged ult reads "ready" and an uncharged one reads
    // its energy gap rather than a bare 0.
    note.textContent = ability.cooldown > 0
      ? `${ability.cooldown}t`
      : ability.ready ? 'ready' : 'energy';
    row.append(name, note);
    slots.appendChild(row);
  }

  node.append(head, vitals, slots);

  if (panel.catalysts.length > 0) {
    const cats = el('div', 'inspect-catalysts');
    for (const catalyst of panel.catalysts) {
      const chip = el('span', 'inspect-catalyst');
      chip.classList.toggle('spent', catalyst.spent);
      chip.textContent = catalyst.name;
      chip.title = catalyst.spent ? `${catalyst.name} — spent` : `${catalyst.name} — ${catalyst.phase}`;
      cats.appendChild(chip);
    }
    node.appendChild(cats);
  }

  if (panel.statuses.length > 0) {
    const row = el('div', 'inspect-statuses');
    for (const status of panel.statuses) {
      const chip = el('span', 'hud-status');
      chip.classList.toggle('harm', status.harmful);
      const dot = el('span', 'hud-status-dot');
      dot.innerHTML = status.glyph;
      const name = el('span', 'hud-status-name');
      name.textContent = status.label;
      const turns = el('span', 'hud-status-turns');
      turns.textContent = `${status.remaining}t`;
      chip.append(dot, name, turns);
      row.appendChild(chip);
    }
    node.appendChild(row);
  }

  node.style.display = 'block';
  // Kept inside the viewport, and flipped to the pointer's left when it would
  // otherwise run off the right edge. CATALYST-TIP-FAST lifted the arithmetic
  // into `tooltip.ts`, so the catalyst tip and this panel place themselves by
  // one rule rather than by two copies of one.
  if (at !== undefined) placeBeside(node, at);
}
