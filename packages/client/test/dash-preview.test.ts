import { describe, expect, it } from 'vitest';
import { buildBoard, circleSquares, createMatch, type AbilityDef, type CharacterDef, type MapDef } from '@cards/engine';
import { abilityPreview, aimFor, impactPreview } from '../src/targeting.js';
import { previewAim } from '../src/order-mode.js';
import { emptyDraft } from '../src/targeting.js';
import wisp from '../../../data/characters/wisp.json';
import ravok from '../../../data/characters/ravok.json';
import bastion from '../../../data/characters/bastion.json';

/**
 * DASH-PREVIEW — "Shadowstep Strike needs to show what boxes are being hit, not
 * just the box of arrival."
 *
 * DASH-IMPACT shipped the mechanic and no way to see it: a dash whose arrival
 * detonates looked identical, while aiming, to one that only moves you. These
 * tests are about the *separation* as much as the disc — the impact must not be
 * folded into the aimed area, because the aimed area is a plan-time claim about
 * where the dash goes and the engine detonates from wherever it actually stops.
 */

const WISP = wisp as unknown as CharacterDef;
const RAVOK = ravok as unknown as CharacterDef;
const BASTION = bastion as unknown as CharacterDef;
const OPEN: MapDef = {
  id: 't', name: 't', width: 15, height: 15, walls: [], cover: [], brush: [],
  spawns: [[{ x: 1, y: 7 }], [{ x: 13, y: 7 }]],
};

const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;
const sorted = (ps: readonly { x: number; y: number }[]): string[] => ps.map(key).sort();

const match = (a: CharacterDef, b: CharacterDef = BASTION) => createMatch(OPEN, '1v1', [[a], [b]]);
const unitOf = (s: ReturnType<typeof match>, id: string) => s.units.find((u) => u.characterId === id)!;
const abilityOf = (c: CharacterDef, id: string): AbilityDef =>
  [...c.abilities, c.ultimate].find((a) => a.id === id)!;

describe('a dash with an impact previews the disc it will detonate', () => {
  it("Shadowstep Strike paints a radius-1 disc at the AIMED landing square", () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    const strike = abilityOf(WISP, 'shadowstep_strike');
    const landing = { x: u.pos.x + 5, y: u.pos.y };

    const { destination, origin } = impactPreview(OPEN, u, strike, [landing]);
    expect(sorted(destination)).toEqual(sorted(circleSquares(buildBoard(OPEN), landing, 1)));
    expect(origin).toEqual([]); // it declares no takeoff blast
  });

  it('…centred on where it LANDS, not on where it started', () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    const landing = { x: u.pos.x + 5, y: u.pos.y };
    const { destination } = impactPreview(OPEN, u, abilityOf(WISP, 'shadowstep_strike'), [landing]);
    expect(destination.map(key)).toContain(key(landing));
    expect(destination.map(key)).not.toContain(key(u.pos));
  });

  it('follows the aim — re-aiming moves the disc with it', () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    const strike = abilityOf(WISP, 'shadowstep_strike');
    const a = impactPreview(OPEN, u, strike, [{ x: u.pos.x + 4, y: u.pos.y }]);
    const b = impactPreview(OPEN, u, strike, [{ x: u.pos.x + 4, y: u.pos.y + 3 }]);
    expect(sorted(a.destination)).not.toEqual(sorted(b.destination));
    expect(a.destination).toHaveLength(b.destination.length); // same shape, moved
  });

  it("Bullrush is a CHARGE, so the disc lands at the end of its walked route", () => {
    const s = match(RAVOK);
    const u = unitOf(s, 'ravok');
    const rush = abilityOf(RAVOK, 'bullrush');
    // A `path` dash's aim IS the route, so `aimFor` walks it for us.
    const { aim } = aimFor(OPEN, s, u, rush, { x: u.pos.x + 4, y: u.pos.y });
    const end = aim[aim.length - 1]!;
    const { destination } = impactPreview(OPEN, u, rush, aim);
    expect(sorted(destination)).toEqual(sorted(circleSquares(buildBoard(OPEN), end, 2)));
  });

  it('clips to the board rather than painting squares that do not exist', () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    u.pos = { x: 1, y: 1 };
    const { destination } = impactPreview(OPEN, u, abilityOf(WISP, 'shadowstep_strike'), [{ x: 0, y: 0 }]);
    expect(destination.every((p) => p.x >= 0 && p.y >= 0 && p.x < OPEN.width && p.y < OPEN.height)).toBe(true);
    expect(destination.length).toBeGreaterThan(0);
  });
});

describe('and previews nothing when there is nothing to preview', () => {
  it('a dash with no `impact` is unchanged', () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    const roll = [...WISP.abilities].find((a) => a.phase === 'dash' && a.impact === undefined);
    if (roll !== undefined) {
      expect(impactPreview(OPEN, u, roll, [{ x: u.pos.x + 2, y: u.pos.y }])).toEqual({ origin: [], destination: [] });
    }
    // …and the same holds for a hand-built one, so this does not depend on the
    // roster happening to contain a plain dash.
    const plain: AbilityDef = { ...abilityOf(WISP, 'shadowstep_strike') };
    delete (plain as { impact?: unknown }).impact;
    expect(impactPreview(OPEN, u, plain, [{ x: u.pos.x + 3, y: u.pos.y }])).toEqual({ origin: [], destination: [] });
  });

  it('a Blast ability with an impact-shaped radius is not a dash and previews nothing', () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    const notADash: AbilityDef = { ...abilityOf(WISP, 'shadowstep_strike'), phase: 'blast' };
    expect(impactPreview(OPEN, u, notADash, [{ x: u.pos.x + 3, y: u.pos.y }]).destination).toEqual([]);
  });

  it('nothing selected previews nothing', () => {
    const s = match(WISP);
    expect(impactPreview(OPEN, unitOf(s, 'wisp'), undefined, [])).toEqual({ origin: [], destination: [] });
  });

  it('an illegal aim previews nothing — out of range is not a landing square', () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    const strike = abilityOf(WISP, 'shadowstep_strike');
    const far = { x: u.pos.x + strike.range + 4, y: u.pos.y };
    expect(impactPreview(OPEN, u, strike, [far]).destination).toEqual([]);
  });

  it('a dash aimed at your own square is a hold, so no disc', () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    expect(impactPreview(OPEN, u, abilityOf(WISP, 'shadowstep_strike'), [{ ...u.pos }]).destination).toEqual([]);
  });
});

describe('the impact is its own layer, not more tiles in the aimed area', () => {
  it("does not widen `abilityPreview` — the aimed area still means 'where it goes'", () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    const strike = abilityOf(WISP, 'shadowstep_strike');
    const landing = { x: u.pos.x + 5, y: u.pos.y };
    const aimed = abilityPreview(OPEN, u, strike, [landing]);
    const { destination } = impactPreview(OPEN, u, strike, [landing]);
    // The disc genuinely covers ground the aimed area does not — which is the
    // whole complaint ("not just the box of arrival") — and the aimed area was
    // not quietly grown to match. Overloading them would make the aim lie about
    // where a charge stopped short actually detonates.
    expect(destination.length).toBeGreaterThan(aimed.length);
    expect(destination.some((p) => !aimed.some((q) => key(q) === key(p)))).toBe(true);
  });

  it('previews from the HOVERED aim, so the disc tracks the pointer pre-commit', () => {
    const s = match(WISP);
    const u = unitOf(s, 'wisp');
    const strike = abilityOf(WISP, 'shadowstep_strike');
    const draft = { ...emptyDraft(u.unitId), abilityId: strike.id };
    const hovered = { x: u.pos.x + 4, y: u.pos.y + 2 };
    const preview = previewAim(OPEN, s, u, strike, draft, { mode: 'aim', hover: { square: hovered } });
    const { destination } = impactPreview(OPEN, u, strike, preview.aim, preview.aimStep);
    expect(destination.map(key)).toContain(key(hovered));
  });
});
