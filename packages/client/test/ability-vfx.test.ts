import { describe, expect, it } from 'vitest';
import {
  AURA_PEAK_OPACITY, NO_VFX, aurasAt, blinks, discOutline, hexColour, isWarm, RING_THICKNESS, ringOutline, vfxFor,
  type VfxTable,
} from '../src/ability-vfx.js';
import type { Cue } from '../src/choreograph.js';
import type { Vec2 } from '@cards/engine';
import table from '../../../data/vfx.json';
import aegisArt from '../../../data/art/aegis.json';
import aegis from '../../../data/characters/aegis.json';
import wispArt from '../../../data/art/wisp.json';
import wisp from '../../../data/characters/wisp.json';

const VFX = table as unknown as VfxTable;
const BEAT = 1;

const ability = (t: number, unitId: string, abilityId: string): Cue =>
  ({ kind: 'ability', phase: 'blast', t, dur: BEAT, unitId, abilityId, area: [] }) as Cue;
const impact = (t: number, unitId: string, sourceUnitId: string, abilityId: string): Cue =>
  ({ kind: 'impact', t, dur: BEAT, unitId, amount: 20, absorbed: 0, sourceUnitId, abilityId }) as Cue;

const asAegis = (): string => 'aegis';
const at = (positions: Record<string, Vec2>) => (id: string): Vec2 | undefined => positions[id];

describe('the table agrees with the art it was copied from', () => {
  /**
   * `data/vfx.json` duplicates each character's `magic` palette rather than
   * importing it, because `data/art/<id>.json` is an art SOURCE — thesis, build,
   * garment, face — and has no business in the browser bundle. A copy can drift;
   * this is what stops it.
   */
  it('VFX-PALETTE-MATCHES-ART: Aegis draws in the colours his art data specifies', () => {
    const magic = (aegisArt as unknown as { magic: Record<string, string> }).magic;
    expect(VFX['aegis']!.palette.core).toBe(magic['core']);
    expect(VFX['aegis']!.palette.edge).toBe(magic['edge']);
    expect(VFX['aegis']!.palette.deep).toBe(magic['deep']);
  });

  it('VFX-NEVER-WARM: the one design constraint his art data states is enforced', () => {
    // "Never warm. A paladin's light is given to him; Aegis forces his. Pale,
    // sickly, effortful." Written when the character was authored and, until
    // this test, unenforceable — the sort of intent that erodes the first time
    // somebody picks a colour by eye.
    expect(VFX['aegis']!.warmthForbidden).toBe(true);
    for (const [shade, hex] of Object.entries(VFX['aegis']!.palette)) {
      expect(isWarm(hex), `${shade} (${hex}) is warm, and Aegis's light may not be`).toBe(false);
    }
  });

  it('VFX-COVERS-THE-KIT: every ability Aegis actually has is styled', () => {
    // A missing entry is silent by design, so nothing else would catch one.
    const ids = (aegis as unknown as { abilities: { id: string }[] }).abilities.map((a) => a.id);
    for (const id of ids) {
      expect(Object.keys(VFX['aegis']!.abilities), `no VFX for aegis/${id}`).toContain(id);
    }
  });
});

describe("Wisp's smoke reads as one cold language", () => {
  it('VFX-PALETTE-MATCHES-ART: Wisp draws in the colours her art data specifies', () => {
    // Same drift guard as Aegis: data/vfx.json copies her `magic` block rather
    // than importing the art source, so this is what stops the copy rotting.
    const magic = (wispArt as unknown as { magic: Record<string, string> }).magic;
    expect(VFX['wisp']!.palette.core).toBe(magic['core']);
    expect(VFX['wisp']!.palette.edge).toBe(magic['edge']);
    expect(VFX['wisp']!.palette.deep).toBe(magic['deep']);
  });

  it('VFX-NEVER-WARM: her smoke is cold plum and may not drift warm', () => {
    // "Cold and weightless — not fire, not steam." Plum is a violet hue, so the
    // constraint holds; this pins it against a future eyeball recolour.
    expect(VFX['wisp']!.warmthForbidden).toBe(true);
    for (const [shade, hex] of Object.entries(VFX['wisp']!.palette)) {
      expect(isWarm(hex), `${shade} (${hex}) is warm, and her smoke is cold`).toBe(false);
    }
  });

  it('VFX-COVERS-THE-KIT: every ability she has, and the ultimate, is styled', () => {
    const ids = [
      ...(wisp as unknown as { abilities: { id: string }[] }).abilities.map((a) => a.id),
      (wisp as unknown as { ultimate: { id: string } }).ultimate.id,
    ];
    for (const id of ids) {
      expect(Object.keys(VFX['wisp']!.abilities), `no VFX for wisp/${id}`).toContain(id);
    }
  });

  it('VFX-TELEPORTS-BLINK: both her teleports blink the caster; her melee and throw do not', () => {
    // A blink draws a ring at the square she leaves and the one she arrives at,
    // so the eye follows a unit that never crossed between — the whole read of a
    // phantom. Dagger Flurry and Bola travel normally.
    expect(blinks(VFX, 'wisp', 'blink')).toBe(true);
    expect(blinks(VFX, 'wisp', 'shadowstep_strike')).toBe(true);
    for (const id of ['dagger_flurry', 'bola', 'veil_decoy']) {
      expect(blinks(VFX, 'wisp', id), id).toBe(false);
    }
  });

  it('VFX-ONLY-THE-BOLA-FLIES: the one thing that crosses the board keeps its tracer', () => {
    expect(vfxFor(VFX, 'wisp', 'bola').tracer).toBe('streak');
    expect(vfxFor(VFX, 'wisp', 'dagger_flurry').tracer).toBe('none');
  });
});

describe('isWarm', () => {
  it('WARM-REDS: reds, oranges and yellows are warm', () => {
    for (const hex of ['#ff0000', '#ff8000', '#ffd166', '#c0392b']) {
      expect(isWarm(hex), hex).toBe(true);
    }
  });

  it('WARM-NOT-COLD: greens, cyans, blues and violets are not', () => {
    for (const hex of ['#00ff00', '#00ffff', '#0000ff', '#8000ff', '#8d9c88']) {
      expect(isWarm(hex), hex).toBe(false);
    }
  });

  it('WARM-GREY-IS-NOT: a near-grey has a hue the maths reports and the eye cannot see', () => {
    for (const hex of ['#808080', '#c9d2c4', '#4a5058', '#ffffff', '#000000']) {
      expect(isWarm(hex), hex).toBe(false);
    }
  });
});

describe('hexColour', () => {
  it('HEX-PARSES: with and without the hash', () => {
    expect(hexColour('#c9d2c4')).toBe(0xc9d2c4);
    expect(hexColour('c9d2c4')).toBe(0xc9d2c4);
  });

  it('HEX-BAD-IS-LOUD: an unparseable colour is magenta, not black or a crash', () => {
    // Black would blend into the board and read as "no effect"; magenta is the
    // traditional "somebody typoed a colour" and gets noticed.
    expect(hexColour('not a colour')).toBe(0xff00ff);
  });
});

describe('vfxFor', () => {
  it('VFX-UNKNOWN-CHARACTER: falls back to the default rather than throwing', () => {
    expect(vfxFor(VFX, 'nobody', 'whatever')).toEqual(NO_VFX);
  });

  it('VFX-DEFAULT-KEEPS-TRACERS: an unstyled ability still draws its streak', () => {
    // Defaulting this off would have deleted a shipped feature from eight
    // characters as the price of styling one.
    expect(NO_VFX.tracer).toBe('streak');
    expect(vfxFor(VFX, 'vex', 'rail_shot').tracer).toBe('streak');
  });

  it('VFX-DEFAULT-NO-AURA: but an unstyled ability gets no aura, so absence shows', () => {
    expect(vfxFor(VFX, 'vex', 'rail_shot').cast.kind).toBe('none');
    expect(vfxFor(VFX, 'vex', 'rail_shot').impact.kind).toBe('none');
  });

  it('VFX-CONE-HAS-NO-PROJECTILE: Shield Bash declares it, rather than being filtered by distance', () => {
    expect(vfxFor(VFX, 'aegis', 'shield_bash').tracer).toBe('none');
  });

  it('VFX-INTERCEPT-BLINKS: and nothing else does', () => {
    expect(blinks(VFX, 'aegis', 'intercept')).toBe(true);
    for (const id of ['shield_bash', 'barrier_pulse', 'warding_wall', 'warding_halo']) {
      expect(blinks(VFX, 'aegis', id), id).toBe(false);
    }
  });
});

describe('ringOutline', () => {
  it('RING-HAS-A-HOLE: it is a band, not a disc', () => {
    // A filled circle reads as a wash under the unit; a band reads as something
    // leaving them, and does not grey out the character it is drawing attention
    // to. Folding the hole into one outline was tried first and came out a
    // disc — ear clipping fills a keyhole straight in.
    const { outline, hole } = ringOutline({ x: 0, y: 0 }, 2);
    expect(Math.max(...outline.map((p) => Math.hypot(p.x, p.y)))).toBeCloseTo(2, 6);
    expect(hole.length).toBeGreaterThanOrEqual(12);
    const inner = Math.max(...hole.map((p) => Math.hypot(p.x, p.y)));
    expect(inner).toBeCloseTo(2 * (1 - RING_THICKNESS), 6);
    expect(inner).toBeLessThan(2);
  });

  it('RING-DEGENERATE: no radius, no ring', () => {
    expect(ringOutline({ x: 0, y: 0 }, 0).outline).toEqual([]);
  });
});

describe('discOutline', () => {
  it('DISC-CLOSED: enough sides to read as round', () => {
    expect(discOutline({ x: 0, y: 0 }, 1).length).toBeGreaterThanOrEqual(12);
  });

  it('DISC-RADIUS: every point sits on the circle', () => {
    for (const p of discOutline({ x: 3, y: 4 }, 2)) {
      expect(Math.hypot(p.x - 3, p.y - 4)).toBeCloseTo(2, 9);
    }
  });

  it('DISC-DEGENERATE: a zero or negative radius draws nothing, not a spike', () => {
    expect(discOutline({ x: 0, y: 0 }, 0)).toEqual([]);
    expect(discOutline({ x: 0, y: 0 }, -1)).toEqual([]);
    expect(discOutline({ x: Number.NaN, y: 0 }, 1)).toEqual([]);
  });
});

describe('aurasAt', () => {
  const cues = [ability(0, 'a', 'warding_halo')];
  const positions = at({ a: { x: 5, y: 5 } });

  it('AURA-BORN: a cast ring exists just after the ability fires', () => {
    expect(aurasAt(cues, 0.1, VFX, asAegis, positions)).toHaveLength(1);
  });

  it('AURA-EXPANDS: the ring grows over its life', () => {
    const early = aurasAt(cues, 0.2, VFX, asAegis, positions)[0]!;
    const late = aurasAt(cues, 1.0, VFX, asAegis, positions)[0]!;
    const spread = (a: typeof early): number =>
      Math.max(...a.outline.map((p) => Math.hypot(p.x - 5, p.y - 5)));
    expect(spread(late)).toBeGreaterThan(spread(early));
  });

  it('AURA-FADES: and thins out as it goes', () => {
    const early = aurasAt(cues, 0.2, VFX, asAegis, positions)[0]!;
    const late = aurasAt(cues, 1.0, VFX, asAegis, positions)[0]!;
    expect(late.opacity).toBeLessThan(early.opacity);
    expect(early.opacity).toBeLessThanOrEqual(AURA_PEAK_OPACITY);
  });

  it('AURA-DIES: it is gone once its beats are spent', () => {
    // warding_halo's cast runs 1.4 beats.
    expect(aurasAt(cues, 1.39, VFX, asAegis, positions)).toHaveLength(1);
    expect(aurasAt(cues, 1.41, VFX, asAegis, positions)).toEqual([]);
  });

  it('AURA-NOT-BEFORE: nothing before the cast', () => {
    expect(aurasAt(cues, -0.1, VFX, asAegis, positions)).toEqual([]);
  });

  it('AURA-IN-THE-PALETTE: it is drawn in one of that character\'s own tones', () => {
    const tones = Object.values(VFX['aegis']!.palette).map(hexColour);
    expect(tones).toContain(aurasAt(cues, 0.3, VFX, asAegis, positions)[0]!.color);
  });

  it('AURA-ON-THE-VICTIM: an impact ring is drawn where the hit landed', () => {
    const hit = [impact(0, 'v', 'a', 'shield_bash')];
    const auras = aurasAt(hit, 0.2, VFX, asAegis, at({ a: { x: 1, y: 1 }, v: { x: 7, y: 7 } }));
    expect(auras).toHaveLength(1);
    // Centred on the victim, not the caster. Measured from the bounding box
    // rather than the centroid: a ring's outline repeats its seam points, which
    // drags a mean average a fraction off centre.
    const xs = auras[0]!.outline.map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(7, 6);
  });

  it('AURA-BY-THE-CASTER: styled by whoever fired it, wherever it lands', () => {
    // A heal from Aegis is Aegis's colour even on somebody else's unit.
    const hit = [impact(0, 'v', 'a', 'shield_bash')];
    const characterOf = (id: string): string | undefined => (id === 'a' ? 'aegis' : 'vex');
    expect(aurasAt(hit, 0.2, VFX, characterOf, at({ a: { x: 1, y: 1 }, v: { x: 7, y: 7 } }))).toHaveLength(1);
  });

  it('AURA-UNSTYLED-IS-SILENT: a character with no entry draws none', () => {
    const asVex = (): string => 'vex';
    expect(aurasAt([ability(0, 'a', 'rail_shot')], 0.2, VFX, asVex, positions)).toEqual([]);
  });

  it('AURA-NEEDS-A-PLACE: a unit that cannot be located contributes nothing', () => {
    expect(aurasAt(cues, 0.2, VFX, asAegis, () => undefined)).toEqual([]);
  });
});
