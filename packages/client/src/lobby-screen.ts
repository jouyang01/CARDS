/**
 * The lobby screen — the DOM half of M3-LOBBY-UI.
 *
 * Presentation only, on the same terms as `hud.ts`: it is handed a catalogue and
 * a `RoomClient`, it renders whatever `lobby.ts` computes from the socket's last
 * message, and it decides nothing. Every rule it appears to enforce — R3's greyed
 * characters, the owed slot count, whether Start is live — is a value the server
 * sent, forwarded through the pure view-model.
 *
 * **Rebuilt on each update, not updated in place.** The opposite of the HUD's
 * choice, and for the opposite reason: the HUD's hover state is load-bearing
 * (UI1 paints the board from it) and a lobby's is not, so the simpler thing is
 * also the correct one here. A pick screen redrawn between clicks loses nothing.
 */

import { CATALYST_PHASES, type AbilityPhase, type CharacterDef } from '@cards/engine';
import type { RoomClient } from './net.js';
import {
  canStart,
  characterOptions,
  chooseCatalyst,
  chooseCharacter,
  draftPicks,
  emptyDraft,
  characterDetail,
  enemyProgress,
  isCreator,
  isReady,
  lobbyStatus,
  resizeDraft,
  seatRows,
  type Draft,
} from './lobby.js';
import { AWAY_LABEL, AWAY_MARK } from './presence.js';
import { inspectCharacter } from './inspect.js';
import { renderInspectPanel } from './inspect-panel.js';
import { createTooltip } from './tooltip.js';

/** One catalyst, as the screen offers it. Named so the pool's shape stays out. */
export interface CatalystOption {
  id: string;
  name: string;
  phase: AbilityPhase;
  description: string;
}

export interface LobbyScreenUI {
  root: HTMLElement;
}

export interface LobbyScreen {
  /** Repaint from the client's current state. Safe to call on every message. */
  update(): void;
  /** Stop listening. Called when the match starts and the board takes over. */
  destroy(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * Mount the pick screen over a connected `RoomClient`.
 *
 * The draft lives here rather than in the client, because it is the one piece of
 * lobby state that is **not** shared: what you have clicked is yours until you
 * send it. It is re-sized on every update, since a join or a leave re-prices
 * what this seat owes.
 */
export function createLobbyScreen(
  ui: LobbyScreenUI,
  client: RoomClient,
  catalog: readonly CharacterDef[],
  catalysts: readonly CatalystOption[],
): LobbyScreen {
  let draft: Draft = emptyDraft(0);
  /** Which slot the character grid is filling. Reset when the draft re-sizes. */
  let active = 0;

  /**
   * LOBBY-INSPECT (Dev Note #2) — the same panel the board shows, over the
   * character your pointer is on.
   *
   * Built once and re-filled, exactly as the HUD's is, and for exactly the same
   * reason: the screen below it is rebuilt on every update, and a panel rebuilt
   * with it would vanish from under the pointer that summoned it. It hangs off
   * `document.body` rather than off the lobby, so it is not clipped by the
   * panel it is describing (LOBBY-BOUNDS put a boundary there on purpose).
   */
  const hoverPanel = el('div', 'inspect');
  hoverPanel.style.display = 'none';
  document.body.appendChild(hoverPanel);

  /**
   * CATALYST-TIP-FAST (owner Dev Note) — *"Catalyst descriptions on mouseover
   * appear very slowly, can we speed up how soon they show up?"*
   *
   * The catalyst buttons carried their description as a `title`, and the delay
   * before a native tooltip appears belongs to the browser: about half a second
   * to a second, with nothing to configure. Nine catalysts is nine waits.
   *
   * So it becomes an element, like the character hover beside it — which has
   * never had a delay, because there was never a timer to have one. Built once
   * and re-shown, for the same reason `hoverPanel` is: the screen underneath is
   * rebuilt on every message, and a tip rebuilt with it would vanish from under
   * the pointer that summoned it.
   */
  const tip = createTooltip();

  /**
   * LOBBY-DETAIL-PANEL (owner Dev Note) — *"it should also expand into a bigger
   * window on the side that shows a description of all the skills. There is
   * space on the left."*
   *
   * Which character the side panel is describing. **Sticky**: set by pointing at
   * a character or by picking one, and it stays until another is chosen, which
   * is the difference between this and the hover tooltip beside it. A panel that
   * emptied when the pointer left would be the tooltip again, with more pixels.
   */
  let detailId: string | undefined;
  const detailPanel = el('aside', 'lobby-detail');
  detailPanel.style.display = 'none';
  document.body.appendChild(detailPanel);

  /** Repaint the side panel for `detailId`, or hide it when nothing is chosen. */
  const renderDetail = (): void => {
    const character = catalog.find((c) => c.id === detailId);
    if (character === undefined) {
      detailPanel.style.display = 'none';
      return;
    }
    const detail = characterDetail(character);
    detailPanel.replaceChildren();
    detailPanel.dataset['character'] = detail.id;

    const head = el('div', 'lobby-detail-head');
    head.append(el('h2', 'lobby-detail-name', detail.name));
    head.append(el('p', 'lobby-detail-role', `${detail.archetype} · ${detail.maxHp} HP`));
    detailPanel.append(head);

    const list = el('div', 'lobby-detail-skills');
    for (const skill of detail.skills) {
      const row = el('div', `lobby-detail-skill${skill.isUlt ? ' is-ult' : ''}`);
      row.dataset['skill'] = skill.id;
      const title = el('div', 'lobby-detail-skill-name');
      title.append(el('span', 'lobby-detail-skill-title', skill.name));
      // The phase is the half of "when" a description usually leaves out, and
      // the ult's price is the half of "what it costs" — both beside the name
      // rather than buried in the sentence.
      title.append(el('span', 'lobby-detail-skill-meta',
        skill.isUlt ? `ultimate · ${detail.ultCost} energy` : skill.phase));
      row.append(title);
      if (skill.tell !== '') row.append(el('div', 'lobby-detail-skill-tell', skill.tell));
      row.append(el('p', 'lobby-detail-skill-text', skill.description));
      list.append(row);
    }
    detailPanel.append(list);
    detailPanel.style.display = '';
  };

  /** Point at or pick a character: the side panel follows, and stays. */
  const showDetail = (characterId: string): void => {
    if (detailId === characterId) return;
    detailId = characterId;
    renderDetail();
  };

  const send = (): void => {
    const picks = draftPicks(draft);
    if (picks !== undefined) client.pick(picks);
  };

  const render = (): void => {
    const net = client.net;
    const rows = seatRows(net, catalog);
    const mine = rows.find((r) => r.isMine);
    const owed = mine?.owed ?? 0;

    const resized = resizeDraft(draft, owed);
    if (resized !== draft) {
      draft = resized;
      active = Math.min(active, Math.max(0, draft.slots.length - 1));
    }

    ui.root.replaceChildren();
    ui.root.append(el('p', 'lobby-status', lobbyStatus(net)));
    if (net.error !== undefined) ui.root.append(el('p', 'lobby-error', net.error.message));

    // ── your team ──────────────────────────────────────────────────────────
    const team = el('section', 'lobby-team');
    team.append(el('h2', undefined, 'Your team'));
    for (const row of rows) {
      const away = !row.connected;
      const line = el('div', `lobby-seat${row.isMine ? ' is-mine' : ''}`
        + `${row.ready ? ' is-ready' : ''}${away ? ' is-away' : ''}`);
      line.dataset['seat'] = row.seatId;
      if (away) line.dataset['away'] = 'true';
      // NET-PRESENCE-UI: what a held seat is waiting for replaces what a present
      // one is choosing. "choosing 2…" over a player who is not there is the
      // sentence that made a dropped connection look like a slow one.
      const picked = away
        ? AWAY_LABEL
        : (row.picked.length > 0 ? row.picked.join(', ') : `choosing ${row.owed}…`);
      const name = row.isMine ? `${row.name} (you)` : row.name;
      line.append(el('span', 'lobby-seat-name', away ? `${AWAY_MARK} ${name}` : name));
      line.append(el('span', 'lobby-seat-picks', picked));
      team.append(line);
    }
    ui.root.append(team);

    // ── the other side: a count, and never a name (BLIND-PICK) ─────────────
    const enemy = enemyProgress(net);
    const other = el('section', 'lobby-enemy');
    other.append(el('h2', undefined, 'The other side'));
    other.append(el('p', 'lobby-enemy-count', `${enemy.ready} of ${enemy.of} ready`));
    // NET-PRESENCE-ENEMY: only when somebody is actually missing. "2 of 2
    // present" on a healthy lobby is reassurance nobody asked for, and it would
    // train the eye to skip the line that matters. Still a bare count — which of
    // them dropped stays on their side of the table (BLIND-PICK).
    if (enemy.present < enemy.of) {
      const line = el('p', 'lobby-enemy-present', `${enemy.present} of ${enemy.of} present`);
      line.dataset['present'] = String(enemy.present);
      other.append(line);
    }
    ui.root.append(other);

    // ── your slots ─────────────────────────────────────────────────────────
    if (draft.slots.length > 0) {
      const slots = el('section', 'lobby-slots');
      slots.append(el('h2', undefined, owed > 1 ? `Your ${owed} characters` : 'Your character'));
      draft.slots.forEach((slot, i) => {
        const name = catalog.find((c) => c.id === slot.characterId)?.name ?? 'empty';
        const tab = el('button', `lobby-slot${i === active ? ' is-active' : ''}`, `${i + 1}. ${name}`);
        tab.dataset['slot'] = String(i);
        tab.addEventListener('click', () => { active = i; render(); });
        slots.append(tab);
      });
      ui.root.append(slots);

      // Characters for the active slot.
      const grid = el('section', 'lobby-characters');
      for (const option of characterOptions(catalog, net, draft, active)) {
        const button = el('button', 'lobby-character', `${option.name} · ${option.archetype}`);
        button.dataset['character'] = option.id;
        // Greyed because R3 would refuse it, not because the screen decided to:
        // `taken` is read off the server's own record of accepted picks.
        button.disabled = option.taken;
        if (option.chosen) button.classList.add('is-chosen');
        if (option.taken) button.classList.add('is-taken');
        // LOBBY-INSPECT: kit, health and archetype, from the same builder the
        // board uses. A **disabled** button still answers — "what does the
        // character my teammate took do" is exactly the question a greyed row
        // provokes, and `mouseenter` fires on a disabled button where `click`
        // does not.
        const def = catalog.find((c) => c.id === option.id);
        if (def !== undefined) {
          const team = client.net.seat?.team ?? 0;
          button.addEventListener('mouseenter', (event) => {
            const at = event as MouseEvent;
            renderInspectPanel(hoverPanel, inspectCharacter(def, team), { x: at.clientX, y: at.clientY });
            // LOBBY-DETAIL-PANEL: the hover fills the side panel too, and unlike
            // the tooltip it does not empty on the way out.
            showDetail(option.id);
          });
          button.addEventListener('mouseleave', () => { renderInspectPanel(hoverPanel, undefined); });
        }
        button.addEventListener('click', () => {
          draft = chooseCharacter(draft, active, option.id);
          showDetail(option.id); // the panel follows the pick, not just the pointer
          send();
          render();
        });
        grid.append(button);
      }
      ui.root.append(grid);

      // The active slot's triad, one row per phase.
      const loadout = el('section', 'lobby-catalysts');
      loadout.append(el('h3', undefined, 'Catalysts (optional — one per phase)'));
      for (const phase of CATALYST_PHASES) {
        const row = el('div', 'lobby-catalyst-row');
        row.dataset['phase'] = phase;
        row.append(el('span', 'lobby-phase', phase));
        for (const cat of catalysts.filter((c) => c.phase === phase)) {
          const button = el('button', 'lobby-catalyst', cat.name);
          button.dataset['catalyst'] = cat.id;
          // CATALYST-TIP-FAST: on `mouseenter`, which is *now*. No `title` —
          // one description in two places would be one the browser still
          // delays, over the top of the one that does not.
          button.addEventListener('mouseenter', (event) => {
            const at = event as MouseEvent;
            tip.show(cat.description, { x: at.clientX, y: at.clientY });
          });
          button.addEventListener('mouseleave', () => { tip.hide(); });
          if (draft.slots[active]?.catalysts[phase] === cat.id) button.classList.add('is-chosen');
          button.addEventListener('click', () => {
            draft = chooseCatalyst(draft, active, phase, cat.id);
            send();
            render();
          });
          row.append(button);
        }
        loadout.append(row);
      }
      ui.root.append(loadout);
    }

    // ── ready / start (LOBBY-READY, Dev Note #4) ───────────────────────────
    //
    // Two controls, and a seat gets exactly one of them. The room's creator
    // holds Start; everybody else holds Ready and waits. That is the whole
    // mechanic: a lobby where any seat can start is a lobby where the last
    // person to finish picking decides for everyone.
    if (isCreator(net)) {
      const start = el('button', 'lobby-start', 'Start match');
      start.dataset['action'] = 'start';
      // Live only when the *server* says so — this client cannot see the other
      // side's picks or readiness, so it is structurally unable to answer.
      start.disabled = !canStart(net);
      start.addEventListener('click', () => { client.start(); });
      ui.root.append(start);
      // Named so the wait is a fact rather than a guess about a greyed button.
      if (!canStart(net)) {
        ui.root.append(el('p', 'lobby-wait', 'Waiting for the room to be ready…'));
      }
    } else {
      const ready = isReady(net);
      const button = el('button', 'lobby-ready', ready ? 'Ready ✓' : 'Ready up');
      button.dataset['action'] = 'ready';
      button.dataset['ready'] = String(ready);
      if (ready) button.classList.add('is-ready');
      // Revocable until the match starts: a player who readies and then sees a
      // teammate pick the wrong character has to be able to say so, and this is
      // the only signal they have.
      button.addEventListener('click', () => { client.ready(!ready); });
      ui.root.append(button);
      ui.root.append(el(
        'p',
        'lobby-wait',
        ready ? 'Waiting for the host to start…' : 'Tell the host you are ready.',
      ));
    }
  };

  const unsubscribe = client.subscribe(() => { render(); });
  render();

  return {
    update: render,
    destroy: () => {
      unsubscribe();
      ui.root.replaceChildren();
      detailPanel.remove();
      // The hover panel lives outside the lobby's root, so tearing the lobby
      // down does not take it with it. Removed explicitly, or it would hang
      // over the board the match starts on.
      hoverPanel.remove();
      tip.destroy();
    },
  };
}
