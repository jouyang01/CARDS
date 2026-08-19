/**
 * CATALYST-TIP-FAST — an instant tooltip, and the one place that decides where a
 * floating panel goes.
 *
 * Owner Dev Note: *"Catalyst descriptions on mouseover appear very slowly, can
 * we speed up how soon they show up?"*
 *
 * They were `title` attributes. The delay before a native tooltip appears is the
 * **browser's**, not ours — roughly half a second to a second, unconfigurable,
 * and long enough that reading nine catalyst descriptions in a lobby is nine
 * separate waits. The fix is the mechanism LOBBY-INSPECT already uses for
 * characters, which has no delay at all because it is just an element: a node on
 * `document.body`, filled on `mouseenter`, hidden on `mouseleave`.
 *
 * `placeBeside` is lifted out of `inspect-panel.ts` rather than copied, because
 * "stay inside the viewport, flip left at the right edge" is a rule and two
 * copies of a rule is one copy that is wrong. Both callers now share it.
 */

/**
 * Put `node` beside the pointer, kept inside the viewport.
 *
 * Flipped to the pointer's left when it would otherwise run off the right edge,
 * and clamped vertically — a tooltip that opens off-screen is a tooltip that
 * did not open.
 */
export function placeBeside(node: HTMLElement, at: { x: number; y: number }): void {
  const box = node.getBoundingClientRect();
  const left = at.x + 18 + box.width > globalThis.innerWidth ? at.x - 18 - box.width : at.x + 18;
  const top = Math.min(at.y + 12, Math.max(8, globalThis.innerHeight - box.height - 8));
  node.style.left = `${Math.round(Math.max(8, left))}px`;
  node.style.top = `${Math.round(Math.max(8, top))}px`;
}

/** A tooltip that is shown and hidden by its owner. Text only, by design. */
export interface Tooltip {
  /** Show `text` beside `at`. Immediate — there is no delay to configure. */
  show(text: string, at: { x: number; y: number }): void;
  hide(): void;
  /** The node, so a caller can attach it somewhere other than the body. */
  readonly node: HTMLElement;
  /** Take it off the page. A tooltip outliving its screen would hang over the next. */
  destroy(): void;
}

/**
 * TOOLTIP-SWEEP — the attribute a delegated tooltip reads.
 *
 * `data-tip` rather than `title`, which is the whole item: `title` hands the
 * reveal to the browser, and the browser waits about a second.
 */
export const TIP_ATTR = 'data-tip';

/**
 * Show `tip` for any `[data-tip]` under `root`, instantly, for as long as the
 * pointer is on it. Returns a teardown.
 *
 * **Delegated**, which is not an optimisation — it is what makes this usable on
 * the HUD at all. Those nodes are keyed and reconciled (UI3): a status chip is
 * created once and re-filled on every update, so a listener attached at build
 * time would have to read the text at hover time anyway, and one attached on
 * each update would stack. One listener on the region, and the text is an
 * attribute the update already writes — so "what does this say" and "when does
 * it appear" stop being two separate pieces of bookkeeping.
 *
 * `mouseover`/`mouseout` rather than `mouseenter`/`mouseleave`, because only the
 * first pair bubbles and delegation is the point.
 */
export function delegateTooltips(root: HTMLElement, tip: Tooltip): () => void {
  const target = (event: Event): HTMLElement | null => {
    const node = event.target;
    return node instanceof Element ? node.closest<HTMLElement>(`[${TIP_ATTR}]`) : null;
  };
  const over = (event: MouseEvent): void => {
    const node = target(event);
    const text = node?.dataset['tip'];
    // An empty `data-tip` is "nothing to say", not an empty box: a chip whose
    // text is conditional sets it to '' rather than juggling the attribute.
    if (node === null || text === undefined || text === '') return tip.hide();
    tip.show(text, { x: event.clientX, y: event.clientY });
  };
  const out = (event: MouseEvent): void => {
    // Moving *within* the same tipped node fires mouseout for its children;
    // only leaving the node itself should close the tip.
    const to = (event as MouseEvent & { relatedTarget: EventTarget | null }).relatedTarget;
    const from = target(event);
    if (from !== null && to instanceof Node && from.contains(to)) return;
    tip.hide();
  };
  root.addEventListener('mouseover', over);
  root.addEventListener('mouseout', out);
  return () => {
    root.removeEventListener('mouseover', over);
    root.removeEventListener('mouseout', out);
  };
}

/**
 * Build a tooltip and attach it to `document.body`.
 *
 * On the body rather than inside the panel it describes, exactly as the inspect
 * panel is and for the same reason: LOBBY-BOUNDS put a clipping boundary around
 * the lobby on purpose, and a tooltip clipped by the thing it is explaining is
 * worse than none.
 *
 * **Text, not markup.** A catalyst description is a Designer's sentence out of
 * `data/`, and `textContent` is what keeps it a sentence rather than a place
 * where one could ship a tag.
 */
export function createTooltip(className = 'tip'): Tooltip {
  const node = document.createElement('div');
  node.className = className;
  node.style.display = 'none';
  document.body.appendChild(node);
  return {
    node,
    show(text, at) {
      node.textContent = text;
      node.style.display = 'block';
      placeBeside(node, at);
    },
    hide() {
      node.style.display = 'none';
    },
    destroy() {
      node.remove();
    },
  };
}
