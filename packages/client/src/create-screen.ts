/**
 * M3-ROOM-CREATE — the create-room form, DOM half.
 *
 * Presentation only, like `lobby-screen.ts`: what a map supports, what the
 * Worker accepts and where the browser goes next all live in `room-create.ts`,
 * and this file turns them into two selects and a button.
 *
 * The format list is **narrowed by the chosen map** rather than offered flat: a
 * two-spawn map cannot seat a 4v4, and letting a host pick that combination
 * would mint a room that throws the moment somebody pressed start.
 */

import { FORMATS, type FormatId, type MapDef } from '@cards/engine';
import {
  defaultRequest,
  formatsFor,
  mapOptions,
  requestRoom,
  roomLinkFor,
  type RoomRequest,
} from './room-create.js';

export interface CreateScreenUI {
  root: HTMLElement;
}

export interface CreateScreenDeps {
  /** `POST`s the path and returns the response. Injected so a test needs no network. */
  post: (path: string) => Promise<Response>;
  /** Where to send the browser once a code comes back. */
  navigate: (href: string) => void;
}

export interface CreateScreen {
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

/** Mount the create form. Returns once the DOM is in place; the rest is clicks. */
export function createCreateScreen(
  ui: CreateScreenUI,
  maps: readonly MapDef[],
  deps: CreateScreenDeps,
): CreateScreen {
  const options = mapOptions(maps);
  let request: RoomRequest = defaultRequest(options);
  let pending = false;
  let error: string | undefined;

  const render = (): void => {
    ui.root.replaceChildren();
    ui.root.append(el('h2', undefined, 'Create a room'));
    ui.root.append(el('p', 'create-hint',
      'Map and format belong to the room. Characters and catalysts are picked per seat, after you are in.'));

    const mapRow = el('div', 'create-row');
    mapRow.append(el('label', 'create-label', 'Map'));
    const mapSelect = el('select', 'create-map');
    mapSelect.dataset['field'] = 'map';
    for (const option of options) {
      const item = el('option', undefined, option.name);
      item.value = option.id;
      item.selected = option.id === request.mapId;
      mapSelect.append(item);
    }
    mapSelect.addEventListener('change', () => {
      const mapId = mapSelect.value;
      const allowed = formatsFor(options, mapId);
      // Keep the format if the new map can seat it, otherwise take its first —
      // never leave a pair selected that the map cannot play.
      const format = allowed.includes(request.format) ? request.format : allowed[0] ?? request.format;
      request = { format, mapId };
      render();
    });
    mapRow.append(mapSelect);
    ui.root.append(mapRow);

    const formatRow = el('div', 'create-row');
    formatRow.append(el('label', 'create-label', 'Format'));
    const formatSelect = el('select', 'create-format');
    formatSelect.dataset['field'] = 'format';
    for (const id of formatsFor(options, request.mapId ?? '')) {
      const format = FORMATS[id];
      const item = el('option', undefined, `${id} — ${format.charactersPerTeam} characters a side`);
      item.value = id;
      item.selected = id === request.format;
      formatSelect.append(item);
    }
    formatSelect.addEventListener('change', () => {
      request = { ...request, format: formatSelect.value as FormatId };
    });
    formatRow.append(formatSelect);
    ui.root.append(formatRow);

    if (error !== undefined) ui.root.append(el('p', 'create-error', error));

    const button = el('button', 'create-submit', pending ? 'Creating…' : 'Create room');
    button.dataset['action'] = 'create';
    button.disabled = pending;
    button.addEventListener('click', () => { void submit(); });
    ui.root.append(button);
  };

  /**
   * One create, and never two: the button disables itself while the request is
   * in flight. A double-click that minted two rooms would leave the host in the
   * second and the link they shared pointing at the first.
   */
  const submit = async (): Promise<void> => {
    if (pending) return;
    pending = true;
    error = undefined;
    render();
    const result = await requestRoom(deps.post, request);
    pending = false;
    if ('error' in result) {
      error = result.error;
      render();
      return;
    }
    deps.navigate(roomLinkFor(result.code));
  };

  render();
  return { destroy: () => { ui.root.replaceChildren(); } };
}
