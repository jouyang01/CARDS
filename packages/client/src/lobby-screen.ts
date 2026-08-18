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
  enemyProgress,
  lobbyStatus,
  resizeDraft,
  seatRows,
  type Draft,
} from './lobby.js';
import { AWAY_LABEL, AWAY_MARK } from './presence.js';

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
        button.addEventListener('click', () => {
          draft = chooseCharacter(draft, active, option.id);
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
          button.title = cat.description;
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

    // ── start ──────────────────────────────────────────────────────────────
    const start = el('button', 'lobby-start', 'Start match');
    start.dataset['action'] = 'start';
    // Live only when the *server* says the whole room is ready — this client
    // cannot see the other side's picks and so cannot answer that itself.
    start.disabled = !canStart(net);
    start.addEventListener('click', () => { client.start(); });
    ui.root.append(start);
  };

  const unsubscribe = client.subscribe(() => { render(); });
  render();

  return {
    update: render,
    destroy: () => {
      unsubscribe();
      ui.root.replaceChildren();
    },
  };
}
