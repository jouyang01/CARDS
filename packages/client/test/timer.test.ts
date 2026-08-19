// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DECISION_SECONDS, TIMEBANK_CHARGES, TIMEBANK_SECONDS, type AbilityDef, type CharacterDef } from '@cards/engine';
import {
  DECISION_MS, EXTEND_FLASH_MS, TIMEBANK_MS, URGENT_SECONDS,
  countdownText, freshTimer, spendBank, timerView,
} from '../src/timer.js';
import { createHud, type HudCharacter, type HudModel } from '../src/hud.js';
import vex from '../../../data/characters/vex.json';

/**
 * UI-TIMER (ar-parity §4.5) — the decision countdown and the Time Bank.
 *
 * The model is pure and clock-free: it takes a remaining-milliseconds number
 * and returns what to draw, so the only thing that reads a wall clock is the
 * interval in `app.ts` feeding it. That is what makes the interesting rules
 * testable at all — the switch to tenths, the urgency threshold, and the bank
 * *extending* rather than resetting.
 *
 * Nothing here ends a turn. Enforcement is server-authoritative and belongs to
 * M3-TIMER; a hot-seat clock that resolved the turn by itself would be a second
 * rule to keep in step with the real one.
 */

describe('UI-TIMER: the countdown reads differently when it matters', () => {
  it('whole seconds while there is time to think', () => {
    expect(countdownText(38_400)).toBe('39');
    expect(countdownText(11_000)).toBe('11');
  });

  it('rounds up above the threshold, so "1" is not shown as 0 for a second', () => {
    expect(countdownText(10_400)).toBe('11');
  });

  it('tenths once there is not', () => {
    // Tenths at 38 seconds is noise you learn to ignore; at 6 seconds it is the
    // only thing on screen you are looking at.
    expect(countdownText(9_400)).toBe('9.4');
    expect(countdownText(600)).toBe('0.6');
  });

  it('the switch happens exactly at the urgency threshold', () => {
    expect(countdownText(URGENT_SECONDS * 1000)).toBe('10.0');
    expect(countdownText(URGENT_SECONDS * 1000 + 1)).toBe('11');
  });

  it('never shows a negative clock', () => {
    expect(countdownText(-5_000)).toBe('0.0');
    expect(timerView(-5_000, 1).fraction).toBe(0);
  });

  it('tenths and the colour shift are one flag, not two', () => {
    // A precise number in a calm colour is worse than either alone — they are
    // one signal, so they cannot get out of step.
    const calm = timerView(11_000, 1);
    const urgent = timerView(9_000, 1);
    expect(calm.urgent).toBe(false);
    expect(calm.text).not.toContain('.');
    expect(urgent.urgent).toBe(true);
    expect(urgent.text).toContain('.');
  });
});

describe('UI-TIMER: it counts from the engine\'s constant', () => {
  it('a fresh window is DECISION_SECONDS, not a number written here', () => {
    expect(DECISION_MS).toBe(DECISION_SECONDS * 1000);
    expect(freshTimer().remainingMs).toBe(DECISION_MS);
  });

  it('and a fresh window carries the format\'s Time Bank charges', () => {
    expect(freshTimer().charges).toBe(TIMEBANK_CHARGES);
  });

  it('the fraction is the window, so a bar or ring can read it directly', () => {
    expect(timerView(DECISION_MS, 1).fraction).toBe(1);
    expect(timerView(DECISION_MS / 2, 1).fraction).toBeCloseTo(0.5, 5);
  });

  it('a banked clock over the full window clamps rather than overflowing', () => {
    expect(timerView(DECISION_MS + TIMEBANK_MS, 0).fraction).toBe(1);
  });
});

describe('UI-TIMER: the Time Bank extends, it does not reset', () => {
  it('adds its seconds to what is left', () => {
    // A player who banks at 8 seconds should end up at 18, not at 40. The bank
    // buys a reprieve; it does not undo the turn's thinking.
    const after = spendBank(8_000, 1);
    expect(after).toMatchObject({ remainingMs: 8_000 + TIMEBANK_MS, charges: 0, spent: true });
    expect(TIMEBANK_MS).toBe(TIMEBANK_SECONDS * 1000);
  });

  it('refuses when the charge is gone, and says so', () => {
    // Returned rather than thrown or silently no-oped: the caller has to know,
    // because a spend that took starts the flash and one that did not must not.
    expect(spendBank(8_000, 0)).toMatchObject({ remainingMs: 8_000, charges: 0, spent: false });
  });

  it('can still be spent on an expired clock? no — the deadline has passed', () => {
    expect(timerView(0, 1).canExtend).toBe(false);
    expect(timerView(1_000, 1).canExtend).toBe(true);
  });

  it('and cannot be spent twice', () => {
    const once = spendBank(DECISION_MS, TIMEBANK_CHARGES);
    expect(once.spent).toBe(true);
    expect(spendBank(once.remainingMs, once.charges).spent).toBe(false);
  });

  it('the extension is visible for a beat, then stops being', () => {
    // A +10 s that silently changed the number reads as a miscount, and "did my
    // bank actually fire?" is the one question the control must not leave open.
    expect(timerView(20_000, 0, 0).extending).toBe(true);
    expect(timerView(20_000, 0, EXTEND_FLASH_MS - 1).extending).toBe(true);
    expect(timerView(20_000, 0, EXTEND_FLASH_MS).extending).toBe(false);
    expect(timerView(20_000, 0, undefined).extending).toBe(false);
  });

  it('reports expiry without acting on it — M3-TIMER enforces', () => {
    expect(timerView(0, 1).expired).toBe(true);
    expect(timerView(1, 1).expired).toBe(false);
  });
});

describe('UI-TIMER: the HUD readout', () => {
  const VEX = vex as unknown as CharacterDef;
  const def = (id: string): AbilityDef => [...VEX.abilities, VEX.ultimate].find((a) => a.id === id)!;
  const character = (): HudCharacter => ({
    unitId: 'vex-t0-0', name: 'Vex', archetype: 'firepower', colour: '#4f8cff',
    hp: 95, maxHp: 95, energy: 0, shield: 0, locked: false, hasOrder: false, statuses: [],
  });
  const model = (): HudModel => ({
    active: character(),
    roster: [character()],
    modes: [],
    abilities: [{
      id: VEX.abilities[0]!.id, name: 'Shot', isUlt: false, available: true, cooldown: 0,
      selected: false, free: false, def: def(VEX.abilities[0]!.id),
    }],
    catalysts: [],
    move: { budget: 4, drawing: false, sprinting: false, sprintDisabled: false },
    chase: { armed: false, disabled: false },
    lock: { label: 'Lock In' },
    view: { projection: 'Ortho', orbit: false },
  });

  let root: HTMLElement;
  const extendTime = vi.fn();
  const handlers = {
    selectCharacter: vi.fn(), selectAbility: vi.fn(), selectCatalyst: vi.fn(),
    hoverAbility: vi.fn(), selectMove: vi.fn(), selectChase: vi.fn(), hoverMove: vi.fn(),
    hold: vi.fn(), lock: vi.fn(), toggleProjection: vi.fn(), toggleOrbit: vi.fn(), extendTime,
    selectMode: vi.fn(),
  };

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
    extendTime.mockClear();
  });

  const text = () => root.querySelector<HTMLElement>('.hud-timer-text')!;
  const bank = () => root.querySelector<HTMLButtonElement>('.hud-bank')!;

  it('shows the countdown beside Lock In', () => {
    const hud = createHud(root, handlers);
    hud.update(model());
    hud.setTimer(timerView(23_000, 1));
    expect(text().textContent).toBe('23');
    expect(text().classList.contains('urgent')).toBe(false);
  });

  it('turns urgent, in tenths, under ten seconds', () => {
    const hud = createHud(root, handlers);
    hud.update(model());
    hud.setTimer(timerView(4_200, 1));
    expect(text().textContent).toBe('4.2');
    expect(text().classList.contains('urgent')).toBe(true);
  });

  it('draws one pip per charge, and an empty socket once spent', () => {
    // Spent reads as an empty socket rather than as nothing, so the resource
    // stays legible after it is gone.
    const hud = createHud(root, handlers);
    hud.update(model());
    hud.setTimer(timerView(20_000, 1));
    expect(bank().textContent).toBe('●');
    expect(bank().disabled).toBe(false);

    hud.setTimer(timerView(30_000, 0));
    expect(bank().textContent).toBe('○');
    expect(bank().disabled).toBe(true);
    expect(bank().classList.contains('spent')).toBe(true);
  });

  it('the pip is the control — pressing it asks for the extension', () => {
    const hud = createHud(root, handlers);
    hud.update(model());
    hud.setTimer(timerView(20_000, 1));
    bank().click();
    expect(extendTime).toHaveBeenCalledOnce();
  });

  it('flags the extension so it animates rather than passing silently', () => {
    const hud = createHud(root, handlers);
    hud.update(model());
    hud.setTimer(timerView(30_000, 0, 10));
    expect(root.querySelector('.hud-timer')!.classList.contains('extending')).toBe(true);
  });

  it('hides entirely once there is no decision to time', () => {
    // A clock still ticking over a resolving turn is a lie about what the
    // player can still do.
    const hud = createHud(root, handlers);
    hud.update(model());
    hud.setTimer(timerView(20_000, 1));
    hud.setTimer(undefined);
    expect(root.querySelector<HTMLElement>('.hud-timer')!.style.display).toBe('none');
  });

/**
 * TIMER-BAR (Dev Notes #6+#7) — the countdown becomes a draining bar across the
 * hotbar, running into an enlarged Lock In at its right end.
 *
 * The number, the tenths, the colour shift and the Time Bank pip are all
 * carried over unchanged — the tests above still pass and are the proof. What
 * is new is the bar, and the one thing that can go wrong with a bar is that it
 * does not track the thing it is a bar for.
 */
describe('TIMER-BAR: the bar drains with the clock', () => {
  const built = () => {
    const hud = createHud(root, handlers);
    hud.update(model());
    return hud;
  };
  const fill = () => root.querySelector<HTMLElement>('.hud-timer-fill')!;
  const width = () => Number.parseFloat(fill().style.width);

  it('is full at the top of the window and empty at the bottom', () => {
    const hud = built();
    hud.setTimer(timerView(DECISION_MS, 1));
    expect(width()).toBe(100);
    hud.setTimer(timerView(0, 1));
    expect(width()).toBe(0);
  });

  it('and drains monotonically in between, tracking the fraction', () => {
    const hud = built();
    const widths = [DECISION_MS, DECISION_MS * 0.75, DECISION_MS / 2, 4_000, 0].map((ms) => {
      hud.setTimer(timerView(ms, 1));
      return width();
    });
    expect([...widths].sort((a, b) => b - a), 'never goes back up').toEqual(widths);
    expect(widths[2], 'half a window is half a bar').toBeCloseTo(50, 1);
  });

  it('takes the urgency cue the number takes, so the read works peripherally', () => {
    const hud = built();
    hud.setTimer(timerView(20_000, 1));
    expect(fill().classList.contains('urgent')).toBe(false);
    hud.setTimer(timerView(4_000, 1));
    expect(fill().classList.contains('urgent')).toBe(true);
    hud.setTimer(timerView(0, 1));
    expect(fill().classList.contains('expired')).toBe(true);
  });

  it('the bar hides with the timer, and Lock In does NOT', () => {
    // The reason the button is a sibling of the bar rather than a child of it:
    // playback has no deadline, and a HUD that hid Lock In with the clock would
    // be unusable the moment the timer went away.
    const hud = built();
    hud.setTimer(timerView(20_000, 1));
    hud.setTimer(undefined);
    expect(root.querySelector<HTMLElement>('.hud-timer')!.style.display).toBe('none');
    const lock = root.querySelector<HTMLElement>('.hud-lockrow .hud-lock')!;
    expect(lock, 'still there').toBeTruthy();
    expect(lock.style.display).not.toBe('none');
  });
});
});
