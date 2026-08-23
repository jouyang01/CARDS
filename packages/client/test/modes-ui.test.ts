// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { abilityProfile, type CharacterDef, type MapDef, type UnitState } from '@cards/engine';
import {
  DEFAULT_MODE, abilityPreview, draftAbility, emptyDraft, modeOptions, nextDraft, toUnitOrders,
} from '../src/targeting.js';
import { createHud, type HudCharacter, type HudModel } from '../src/hud.js';
import kestrel from '../../../data/characters/kestrel.json';

/**
 * BASIC-MODES, client side — aiming the mode you picked.
 *
 * The engine's half is one funnel (`abilityProfile` in `planAbility`); this is
 * its mirror (`abilityProfile` in `draftAbility`). Using the **engine's own**
 * function on both sides is the whole safety argument: a client that merged the
 * profile its own way could draw a cone the server resolves as a line, and a
 * preview that lies about the footprint is worse than no preview.
 *
 * So the claims are: the draft resolves through the same overlay, the preview
 * follows the mode, the order carries the index, and flipping the toggle clears
 * an aim that the new profile may not accept.
 */

const KESTREL = kestrel as unknown as CharacterDef;
const TWIN = KESTREL.abilities.find((a) => a.id === 'twin_bolts')!;
const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 3, y: 10 }], [{ x: 17, y: 10 }]],
};

const unit = (): UnitState => ({
  unitId: 'kestrel-t0-0', characterId: 'kestrel', owner: 0, pos: { x: 10, y: 10 },
  hp: 90, maxHp: 90, energy: 0, alive: true, respawnIn: 0,
  cooldowns: {}, statuses: [], catalysts: [], catalystsUsed: [],
});

const armed = (mode?: number) => {
  const base = { ...emptyDraft('kestrel-t0-0'), abilityId: 'twin_bolts' };
  return mode === undefined ? base : { ...base, mode };
};

describe('BASIC-MODES: the draft resolves through the engine\'s own overlay', () => {
  it('an armed mode changes the shape the client thinks it has', () => {
    expect(draftAbility(KESTREL, armed(1))?.shape).toBe('cone');
    expect(draftAbility(KESTREL, armed(1))?.range).toBe(2);
    expect(draftAbility(KESTREL, armed(0))?.shape).toBe('line');
    expect(draftAbility(KESTREL, armed(0))?.range).toBe(6);
  });

  it('and it is byte-for-byte what the engine will resolve', () => {
    // The claim that matters: not "the client also applies a mode" but "the
    // client applies *the same function*". If these ever diverge, the preview
    // and the resolution disagree about the footprint.
    for (const mode of [undefined, 0, 1, 9]) {
      expect(draftAbility(KESTREL, armed(mode)), `mode ${mode}`)
        .toEqual(abilityProfile(TWIN, mode));
    }
  });

  it('no mode is the ability as it has always been', () => {
    expect(draftAbility(KESTREL, armed())).toBe(TWIN);
  });
});

describe('BASIC-MODES: the preview follows the mode', () => {
  const covered = (mode: number | undefined, at: { x: number; y: number }) => {
    const ability = draftAbility(KESTREL, armed(mode))!;
    return abilityPreview(OPEN, unit(), ability, [at]);
  };
  const reaches = (mode: number | undefined, at: { x: number; y: number }): boolean =>
    covered(mode, at).some((p) => p.x === at.x && p.y === at.y);

  it('the long mode covers a square the short mode cannot reach', () => {
    // Asserted as **coverage of that square**, not as "draws nothing": a cone's
    // target is a *direction*, so aiming at a distant square is legal for both
    // and the range bounds the depth rather than the click. Spread still draws
    // its eight tiles near the caster — it just does not arrive.
    const far = { x: 15, y: 10 };
    expect(reaches(0, far), 'Focus arrives').toBe(true);
    expect(reaches(1, far), 'Spread does not').toBe(false);
    expect(covered(1, far).length, 'though it still draws its own footprint').toBeGreaterThan(0);
  });

  it('the short mode draws a wider footprint where both reach', () => {
    // A cone at 2 covers more squares than a line at 6 does *near* the caster,
    // which is the trade the toggle is for.
    expect(covered(1, { x: 12, y: 10 }).length)
      .toBeGreaterThan(covered(0, { x: 12, y: 10 }).length);
  });

  it('and an unarmed mode previews the default profile — which is mode 0', () => {
    // MODE-BASE-INVARIANT makes this an engine-enforced fact rather than a
    // convention the data happened to follow: `modes[0]` must equal the base
    // profile, so the client can show mode 0 as live before anyone chooses.
    expect(covered(undefined, { x: 15, y: 10 })).toEqual(covered(0, { x: 15, y: 10 }));
  });
});

describe('BASIC-MODES: the order carries the index', () => {
  it('a chosen mode goes out with the ability', () => {
    const draft = { ...armed(0), aim: [{ x: 11, y: 10 }] };
    expect(toUnitOrders(KESTREL, draft).ability).toMatchObject({ abilityId: 'twin_bolts', mode: 0 });
  });

  it('an unchosen mode sends no field, so an ordinary order is unchanged', () => {
    const draft = { ...armed(), aim: [{ x: 11, y: 10 }] };
    expect(toUnitOrders(KESTREL, draft).ability).not.toHaveProperty('mode');
  });

  it('and an ability with no modes never sends one, whatever the draft says', () => {
    // Defensive: a stale `mode` left on a draft after switching abilities must
    // not ride out on an ability that has no profiles to index.
    const draft = { ...emptyDraft('kestrel-t0-0'), abilityId: 'kite_shot', mode: 1, aim: [{ x: 11, y: 10 }] };
    expect(toUnitOrders(KESTREL, draft).ability).not.toHaveProperty('mode');
  });
});

describe('BASIC-MODES: flipping the toggle re-aims', () => {
  it('the aim is cleared, because the new profile may not accept it', () => {
    // The failure this closes: keeping a square that was legal for a line 6 and
    // is not legal for a cone 2 leaves a preview drawn for an order the server
    // refuses — which looks exactly like it worked.
    const aimed = { ...armed(1), aim: [{ x: 15, y: 10 }], aimStep: 3 };
    const flipped = nextDraft(aimed, { type: 'selectMode', mode: 0 }, false);
    expect(flipped.mode).toBe(0);
    expect(flipped.aim).toEqual([]);
    expect(flipped.aimStep).toBeUndefined();
  });

  it('but the move is kept — a mode is a targeting choice, not a turn', () => {
    const walking = { ...armed(1), movePath: [{ x: 11, y: 10 }] };
    expect(nextDraft(walking, { type: 'selectMode', mode: 0 }, false).movePath)
      .toEqual([{ x: 11, y: 10 }]);
  });

  it('arming a different ability drops the mode with it', () => {
    // Otherwise mode 1 of an ability the player has never seen a toggle for
    // would be armed for them.
    const after = nextDraft(armed(0), { type: 'selectAbility', abilityId: 'kite_shot', isDash: false }, false);
    expect(after.mode).toBeUndefined();
  });
});

describe('BASIC-MODES: the toggle', () => {
  it('offers both profiles, labelled, with the armed one selected', () => {
    const options = modeOptions(draftAbility(KESTREL, armed(0)), 0);
    expect(options.map((o) => o.label)).toEqual(['Focus', 'Spread']);
    expect(options.map((o) => o.selected)).toEqual([true, false]);
    expect(modeOptions(draftAbility(KESTREL, armed(1)), 1).map((o) => o.selected))
      .toEqual([false, true]);
  });

  it('shows mode 0 as live when the draft has not chosen', () => {
    expect(modeOptions(TWIN, undefined)[DEFAULT_MODE]?.selected).toBe(true);
  });

  it('is empty for an ability with no modes, which is the signal to draw none', () => {
    expect(modeOptions(KESTREL.abilities.find((a) => a.id === 'kite_shot'), 0)).toEqual([]);
    expect(modeOptions(undefined, 0), 'and for no ability at all').toEqual([]);
  });
});

const character: HudCharacter = {
  unitId: 'kestrel-t0-0', name: 'Kestrel', archetype: 'firepower', colour: '#4f8cff',
  hp: 90, maxHp: 90, energy: 0, shield: 0, locked: false, hasOrder: false, statuses: [],
};
const noop = (): void => {};

describe('BASIC-MODES: the HUD row', () => {
  let root: HTMLElement;
  let selectMode: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
    selectMode = vi.fn();
  });

  const model = (modes: HudModel['modes']): HudModel => ({
    active: character,
    roster: [character],
    abilities: [],
    modes,
    rotations: [],
    catalysts: [],
    move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
    chase: { armed: false, disabled: false },
    lock: { label: 'Lock In' },
    view: { projection: 'Ortho', orbit: false },
  });

  const hud = () => createHud(root, {
    selectCharacter: noop, selectAbility: noop, selectCatalyst: noop, hoverAbility: noop,
    selectMove: noop, selectChase: noop, hoverMove: noop, hold: noop, lock: noop,
    toggleProjection: noop, toggleOrbit: noop, recentre: noop, extendTime: noop, selectMode,
    selectRotation: noop,
  });

  it('draws a button per profile, marking the armed one', () => {
    hud().update(model(modeOptions(TWIN, 0)));
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.hud-mode')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Focus', 'Spread']);
    expect(buttons.map((b) => b.classList.contains('sel'))).toEqual([true, false]);
    expect(buttons.map((b) => b.dataset['mode'])).toEqual(['0', '1']);
  });

  it('stays hidden for an ability with no modes — which is almost every turn', () => {
    hud().update(model([]));
    expect(root.querySelector<HTMLElement>('.hud-modes')?.style.display).toBe('none');
    expect(root.querySelectorAll('.hud-mode')).toHaveLength(0);
  });

  it('clicking one asks for that index, and only that one', () => {
    hud().update(model(modeOptions(TWIN, 0)));
    root.querySelectorAll<HTMLButtonElement>('.hud-mode')[1]!.click();
    expect(selectMode).toHaveBeenCalledTimes(1);
    expect(selectMode).toHaveBeenCalledWith(1);
  });

  it('appears and disappears as abilities are armed and cleared', () => {
    // The row is rebuilt wholesale, so the thing worth pinning is that it does
    // not leave stale buttons behind for an ability the player has switched off.
    const view = hud();
    view.update(model(modeOptions(TWIN, 0)));
    expect(root.querySelectorAll('.hud-mode')).toHaveLength(2);
    view.update(model([]));
    expect(root.querySelectorAll('.hud-mode')).toHaveLength(0);
    view.update(model(modeOptions(TWIN, 1)));
    expect(root.querySelectorAll('.hud-mode')).toHaveLength(2);
    expect([...root.querySelectorAll<HTMLButtonElement>('.hud-mode')].map((b) => b.classList.contains('sel')))
      .toEqual([false, true]);
  });
});
