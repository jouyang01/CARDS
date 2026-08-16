// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { AbilityDef, CharacterDef } from '@cards/engine';
import { createHud, type HudCharacter, type HudModel } from '../src/hud.js';
import {
  PIP_COLORS, PIP_ORDER, STATUS_BLURBS, STATUS_LABELS, statusChips, statusPips,
} from '../src/status-pips.js';
import vex from '../../../data/characters/vex.json';

/**
 * BUFF-UI — "UI for buffs needs to be more clear" (owner dev note).
 *
 * The floating pips were the whole of the buff UI: eleven small coloured
 * squares over a model. Enough to notice a status; not enough to play around
 * one. "Am I slowed, and does it wear off before I commit to this move?" had no
 * answer on screen, and a colour-blind player had nothing at all.
 *
 * What these pin is that the strip **names** the status, **counts it down**,
 * and **explains it**, and that it stays in lockstep with the pips it
 * annotates — one vocabulary, spelled out, not a second one to keep in step.
 */

const VEX = vex as unknown as CharacterDef;
const def = (id: string): AbilityDef => [...VEX.abilities, VEX.ultimate].find((a) => a.id === id)!;

const character = (over: Partial<HudCharacter> = {}): HudCharacter => ({
  unitId: 'vex-t0-0', name: 'Vex', archetype: 'firepower', colour: '#4f8cff',
  hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false, statuses: [], ...over,
});

const model = (active: HudCharacter): HudModel => ({
  active,
  roster: [active],
  abilities: [{
    id: 'shot', name: 'Shot', isUlt: false, available: true, cooldown: 0,
    selected: false, free: false, def: def(VEX.abilities[0]!.id),
  }],
  catalysts: [],
  move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
  chase: { armed: false, disabled: false },
  lock: { label: 'Lock In' },
  view: { projection: 'Ortho', orbit: false },
});

const noop = (): void => {};
const handlers = {
  selectCharacter: noop, selectAbility: noop, selectCatalyst: noop, hoverAbility: noop,
  selectMove: noop, selectChase: noop, hoverMove: noop, hold: noop, lock: noop,
  toggleProjection: noop, toggleOrbit: noop, extendTime: noop,
};

let root: HTMLElement;
const hud = () => createHud(root, handlers);
const strip = (): HTMLElement => root.querySelector('.hud-statuses')!;
const chipsOnScreen = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.hud-status')];

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.appendChild(root);
});

describe('BUFF-UI: the vocabulary is complete', () => {
  it('every drawable status has a name and a line saying what it does', () => {
    // A pip with no label is the bug this note is about, so the tables have to
    // be total over `PIP_ORDER` rather than merely mostly filled in.
    for (const kind of PIP_ORDER) {
      expect(STATUS_LABELS[kind], `${kind} has no label`).toBeTruthy();
      expect(STATUS_BLURBS[kind], `${kind} has no blurb`).toBeTruthy();
    }
  });

  it('no two statuses share a name', () => {
    const labels = PIP_ORDER.map((k) => STATUS_LABELS[k]);
    expect(new Set(labels).size).toBe(PIP_ORDER.length);
  });

  it('a blurb says what it does, not what the numbers are', () => {
    // Magnitudes are the engine's constants; a UI restating them is a second
    // place to get a balance pass wrong.
    for (const kind of PIP_ORDER) {
      expect(STATUS_BLURBS[kind], `${kind} quotes a number`).not.toMatch(/\d/);
    }
  });
});

describe('BUFF-UI: statusChips agrees with the pips it annotates', () => {
  const live = [
    { kind: 'might' as const, remaining: 2 },
    { kind: 'slow' as const, remaining: 1 },
    { kind: 'shield' as const, remaining: 3, amount: 20 },
  ];

  it('the same kinds, in the same order, as statusPips', () => {
    expect(statusChips(live).map((c) => c.kind)).toEqual(statusPips(live).map((p) => p.kind));
  });

  it('and the same colour, as CSS rather than as a Three.js int', () => {
    for (const chip of statusChips(live)) {
      expect(chip.colour).toBe(`#${PIP_COLORS[chip.kind]!.toString(16).padStart(6, '0')}`);
    }
  });

  it('drops an expired instance, exactly as the pips do', () => {
    const chips = statusChips([{ kind: 'might', remaining: 0 }, { kind: 'slow', remaining: 1 }]);
    expect(chips.map((c) => c.kind)).toEqual(['slow']);
  });

  it('marks the debuffs apart', () => {
    const chips = statusChips(live);
    expect(chips.find((c) => c.kind === 'slow')!.harmful).toBe(true);
    expect(chips.find((c) => c.kind === 'might')!.harmful).toBe(false);
  });

  it('two shields read as one pool: longest remaining, summed amount', () => {
    // Two casters, two instances, one absorbing pool — which is what the HP bar
    // already shows, so the strip must not say something different.
    const chips = statusChips([
      { kind: 'shield', remaining: 1, amount: 15 },
      { kind: 'shield', remaining: 3, amount: 20 },
    ]);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'shield', remaining: 3, amount: 35 });
  });

  it('a status with no magnitude carries no amount at all', () => {
    expect(statusChips([{ kind: 'root', remaining: 1 }])[0]!.amount).toBeUndefined();
  });
});

describe('BUFF-UI: the HUD strip', () => {
  it('names each status and counts it down', () => {
    hud().update(model(character({
      statuses: statusChips([{ kind: 'slow', remaining: 1 }, { kind: 'might', remaining: 2 }]),
    })));
    const text = chipsOnScreen().map((n) => n.textContent);
    expect(text).toEqual(['Slowed1t', 'Might2t']);
  });

  it('explains what each one does, on hover', () => {
    hud().update(model(character({ statuses: statusChips([{ kind: 'root', remaining: 1 }]) })));
    const title = chipsOnScreen()[0]!.title;
    expect(title).toContain('Rooted');
    expect(title).toContain(STATUS_BLURBS['root']!);
    expect(title, 'singular for the last turn').toContain('1 turn left');
  });

  it('pluralises honestly', () => {
    hud().update(model(character({ statuses: statusChips([{ kind: 'root', remaining: 3 }]) })));
    expect(chipsOnScreen()[0]!.title).toContain('3 turns left');
  });

  it('shows a shield\'s remaining absorption as well as its duration', () => {
    hud().update(model(character({
      statuses: statusChips([{ kind: 'shield', remaining: 2, amount: 20 }]),
    })));
    expect(chipsOnScreen()[0]!.textContent).toBe('Shielded202t');
  });

  it('draws the STATUS-ICONS glyph, inked in the pip colour', () => {
    // Post-STATUS-ICONS the mark is the same glyph that floats over the unit,
    // so the colour arrives as the glyph's ink rather than as a filled dot —
    // and the strip and the board still agree, which was always the point.
    hud().update(model(character({ statuses: statusChips([{ kind: 'might', remaining: 1 }]) })));
    const dot = root.querySelector<HTMLElement>('.hud-status-dot')!;
    expect(dot.querySelector('svg'), 'the chip carries a drawn glyph').not.toBeNull();
    expect(dot.innerHTML).toContain('#ff6b4a');
  });

  it('gives debuffs a class of their own — colour is not the only cue', () => {
    // Eleven colours is more than a player should have to memorise, and a
    // colour-blind player gets nothing from any of them.
    hud().update(model(character({
      statuses: statusChips([{ kind: 'slow', remaining: 1 }, { kind: 'might', remaining: 1 }]),
    })));
    const [slow, might] = chipsOnScreen();
    expect(slow!.classList.contains('harm')).toBe(true);
    expect(might!.classList.contains('harm')).toBe(false);
  });

  it('is hidden entirely when nothing is on the character', () => {
    // Not an empty row: a reserved blank strip reads as broken, not as quiet.
    hud().update(model(character()));
    expect(strip().style.display).toBe('none');
    expect(chipsOnScreen()).toHaveLength(0);
  });

  it('appears the moment a status lands and goes again when it wears off', () => {
    const h = hud();
    h.update(model(character()));
    h.update(model(character({ statuses: statusChips([{ kind: 'haste', remaining: 1 }]) })));
    expect(strip().style.display).not.toBe('none');
    expect(chipsOnScreen()).toHaveLength(1);

    h.update(model(character()));
    expect(strip().style.display).toBe('none');
    expect(chipsOnScreen(), 'the stale chip is removed, not just hidden').toHaveLength(0);
  });

  it('reuses a chip across updates rather than rebuilding it', () => {
    // Same reason the hotbar is keyed (UI3): a node replaced under the pointer
    // loses the hover that is showing its tooltip.
    const h = hud();
    h.update(model(character({ statuses: statusChips([{ kind: 'might', remaining: 3 }]) })));
    const first = chipsOnScreen()[0]!;
    h.update(model(character({ statuses: statusChips([{ kind: 'might', remaining: 2 }]) })));
    expect(chipsOnScreen()[0], 'same node').toBe(first);
    expect(first.textContent, 'with the countdown advanced').toBe('Might2t');
  });

  it('keeps the strip in pip order however the statuses arrive', () => {
    const h = hud();
    h.update(model(character({ statuses: statusChips([{ kind: 'might', remaining: 1 }]) })));
    h.update(model(character({
      statuses: statusChips([{ kind: 'might', remaining: 1 }, { kind: 'slow', remaining: 1 }]),
    })));
    // Debuffs lead, as in PIP_ORDER — a strip that appended in arrival order
    // would put Might first here and shuffle between turns.
    expect(chipsOnScreen().map((n) => n.textContent)).toEqual(['Slowed1t', 'Might1t']);
  });
});
