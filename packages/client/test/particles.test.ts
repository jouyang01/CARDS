import { describe, expect, it } from 'vitest';
import {
  BURST_LIFT, DEFAULT_PARTICLES, NEUTRAL_DEBRIS, NO_PARTICLES, burstAt, particlesAt, particlesFor,
  weightOf, type ParticleSpec,
} from '../src/particles.js';
import { type VfxTable } from '../src/ability-vfx.js';
import type { Cue } from '../src/choreograph.js';
import type { Vec2 } from '@cards/engine';
import table from '../../../data/vfx.json';

const VFX = table as unknown as VfxTable;
const AT: Vec2 = { x: 6, y: 6 };
const SPEC: ParticleSpec = { count: 12, beats: 0.8, speedTiles: 2, size: 0.09, shade: 'core' };
const SEED = 123456;

describe('burstAt', () => {
  it('BURST-EXISTS: a struck unit throws fragments', () => {
    expect(burstAt(SPEC, AT, SEED, 0.1, 1, 0xffffff).length).toBeGreaterThan(0);
  });

  it('BURST-DIES: and they are gone once the burst is spent', () => {
    expect(burstAt(SPEC, AT, SEED, 0.79, 1, 0xffffff).length).toBeGreaterThan(0);
    expect(burstAt(SPEC, AT, SEED, 0.81, 1, 0xffffff)).toEqual([]);
  });

  it('BURST-NOT-BEFORE: nothing in the air before the hit', () => {
    expect(burstAt(SPEC, AT, SEED, -0.1, 1, 0xffffff)).toEqual([]);
  });

  it('BURST-SPREADS: fragments fly apart rather than travelling as one', () => {
    // A burst where every piece moves at the same rate in the same direction is
    // a ring expanding, which is what the aura already does.
    const later = burstAt(SPEC, AT, SEED, 0.4, 1, 0xffffff);
    const spread = new Set(later.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(spread.size).toBe(later.length);
    // …and outward from the point of impact, not clustered on it.
    expect(Math.max(...later.map((p) => Math.hypot(p.x - 6, p.y - 6)))).toBeGreaterThan(0.2);
  });

  it('BURST-DETERMINISTIC: the same hit throws the same debris every time', () => {
    // No Math.random anywhere near presentation — this is what lets a replay
    // look identical on two machines, and what lets the harness photograph it.
    expect(burstAt(SPEC, AT, SEED, 0.3, 1, 0xffffff))
      .toEqual(burstAt(SPEC, AT, SEED, 0.3, 1, 0xffffff));
  });

  it('BURST-SEEDED: a different hit throws different debris', () => {
    const a = burstAt(SPEC, AT, SEED, 0.3, 1, 0xffffff);
    const b = burstAt(SPEC, AT, SEED + 1, 0.3, 1, 0xffffff);
    expect(a).not.toEqual(b);
  });

  it('BURST-NOT-A-COMB: neighbouring fragments do not launch at the same angle', () => {
    // Reusing the seed's low bits directly leaves consecutive indices differing
    // in one bit, and the spray comes out as a comb of near-parallel streaks.
    const out = burstAt({ ...SPEC, count: 16 }, AT, SEED, 0.5, 1, 0xffffff);
    const angles = out.map((p) => Math.atan2(p.y - 6, p.x - 6)).sort((m, n) => m - n);
    const gaps = angles.slice(1).map((a, i) => a - angles[i]!);
    // No two adjacent directions within a degree of each other.
    expect(Math.min(...gaps)).toBeGreaterThan(0.017);
  });

  it('BURST-ARCS: fragments rise and then fall', () => {
    const height = (age: number): number =>
      Math.max(...burstAt(SPEC, AT, SEED, age, 1, 0xffffff).map((p) => p.lift));
    expect(height(0.2)).toBeGreaterThan(height(0.01));
    expect(height(0.75)).toBeLessThan(height(0.3));
  });

  it('BURST-STARTS-ON-THE-BODY: not out of the floor', () => {
    // Fragments launched from the feet read as something coming up out of the
    // ground rather than off the unit that was hit.
    for (const p of burstAt(SPEC, AT, SEED, 0.001, 1, 0xffffff)) {
      expect(p.lift).toBeGreaterThan(BURST_LIFT * 0.9);
    }
  });

  it('BURST-LANDS: nothing sinks through the floor', () => {
    for (let age = 0; age < SPEC.beats; age += 0.02) {
      for (const p of burstAt(SPEC, AT, SEED, age, 1, 0xffffff)) {
        expect(p.lift).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('BURST-FADES-AND-SHRINKS: debris thins out as it goes', () => {
    const early = burstAt(SPEC, AT, SEED, 0.1, 1, 0xffffff)[0]!;
    const late = burstAt(SPEC, AT, SEED, 0.7, 1, 0xffffff)[0]!;
    expect(late.opacity).toBeLessThan(early.opacity);
    expect(late.size).toBeLessThan(early.size);
  });

  it('BURST-SCALES: a heavy hit throws more, and further, than a graze', () => {
    const graze = burstAt(SPEC, AT, SEED, 0.4, weightOf(4), 0xffffff);
    const heavy = burstAt(SPEC, AT, SEED, 0.4, weightOf(30), 0xffffff);
    expect(heavy.length).toBeGreaterThan(graze.length);
    const reach = (ps: typeof graze): number => Math.max(...ps.map((p) => Math.hypot(p.x - 6, p.y - 6)));
    expect(reach(heavy)).toBeGreaterThan(reach(graze));
  });

  it('BURST-ALWAYS-SOMETHING: a hit fully eaten by a shield still throws a fragment', () => {
    // It is the shield doing its job, not nothing happening.
    expect(burstAt(SPEC, AT, SEED, 0.2, weightOf(0), 0xffffff).length).toBeGreaterThan(0);
  });

  it('BURST-NONE-CONFIGURED: no spec, no debris', () => {
    expect(burstAt(NO_PARTICLES, AT, SEED, 0.1, 1, 0xffffff)).toEqual([]);
  });
});

describe('particlesFor', () => {
  it('PARTICLES-FROM-DATA: Shield Bash throws debris, and it is content', () => {
    expect(particlesFor(VFX, 'aegis', 'shield_bash').count).toBeGreaterThan(0);
  });

  it('PARTICLES-UNSTYLED-STILL-THROWS: debris exists because something got hit', () => {
    // Not because of WHO hit it. Defaulting this off meant Vex railgunning
    // somebody produced a flash, a shake, hitstop and a tracer — and no debris —
    // while Aegis hitting the same target for the same damage threw fragments.
    expect(particlesFor(VFX, 'vex', 'rail_shot')).toEqual(DEFAULT_PARTICLES);
    expect(particlesFor(VFX, 'nobody', 'nothing').count).toBeGreaterThan(0);
  });

  it('PARTICLES-OVERRIDE: the table raises the default rather than enabling it', () => {
    expect(particlesFor(VFX, 'aegis', 'shield_bash').count)
      .toBeGreaterThan(DEFAULT_PARTICLES.count);
  });

  it('PARTICLES-EXPLICIT-NONE: an ability CAN say it throws nothing', () => {
    // "This one deals damage and deliberately shows no debris" is a real design
    // position and has to stay sayable now that the default is on.
    const table = { x: { palette: VFX['aegis']!.palette, warmthForbidden: true,
      abilities: { quiet: { particles: { count: 0 } } } } } as unknown as VfxTable;
    expect(particlesFor(table, 'x', 'quiet').count).toBe(0);
  });
});

describe('particlesAt', () => {
  const impact = (t: number, unitId: string, source: string, abilityId: string, amount = 20): Cue =>
    ({ kind: 'impact', t, dur: 1, unitId, amount, absorbed: 0, sourceUnitId: source, abilityId }) as Cue;
  const benefit = (t: number, unitId: string, source: string, abilityId: string): Cue =>
    ({ kind: 'benefit', t, dur: 1, unitId, amount: 12, benefit: 'shield', sourceUnitId: source, abilityId }) as Cue;
  const asAegis = (): string => 'aegis';
  const at = (p: Record<string, Vec2>) => (id: string): Vec2 | undefined => p[id];
  const places = at({ a: { x: 1, y: 1 }, v: { x: 6, y: 6 } });

  it('AT-IMPACT: a landed hit throws debris where it landed', () => {
    const out = particlesAt([impact(0, 'v', 'a', 'shield_bash')], 0.2, VFX, asAegis, places);
    expect(out.length).toBeGreaterThan(0);
    // Around the victim, not the attacker.
    expect(Math.min(...out.map((p) => Math.hypot(p.x - 6, p.y - 6)))).toBeLessThan(1.5);
  });

  it('AT-NOT-A-HEAL: a shield landing breaks nothing, so it throws nothing', () => {
    // Debris is the language of damage; the aura's ring is the right vocabulary
    // for something beneficial arriving.
    expect(particlesAt([benefit(0, 'v', 'a', 'barrier_pulse')], 0.2, VFX, asAegis, places)).toEqual([]);
  });

  it('AT-ANY-ATTACKER: a hit from an unstyled character throws debris too', () => {
    const asVex = (): string => 'vex';
    expect(particlesAt([impact(0, 'v', 'a', 'rail_shot')], 0.2, VFX, asVex, places).length)
      .toBeGreaterThan(0);
  });

  it('AT-NEUTRAL-TINT: and in a neutral grit, since they have no palette yet', () => {
    const asVex = (): string => 'vex';
    for (const p of particlesAt([impact(0, 'v', 'a', 'rail_shot')], 0.2, VFX, asVex, places)) {
      expect(p.color).toBe(NEUTRAL_DEBRIS);
    }
  });

  it('AT-UNKNOWN-ATTACKER: a hit from a unit nothing is known about still broke something', () => {
    expect(particlesAt([impact(0, 'v', 'a', 'whatever')], 0.2, VFX, () => undefined, places).length)
      .toBeGreaterThan(0);
  });

  it('AT-EXPLICIT-NONE: an ability that opts out throws nothing', () => {
    const table = { aegis: { palette: VFX['aegis']!.palette, warmthForbidden: true,
      abilities: { quiet: { particles: { count: 0 } } } } } as unknown as VfxTable;
    expect(particlesAt([impact(0, 'v', 'a', 'quiet')], 0.2, table, asAegis, places)).toEqual([]);
  });

  it('AT-NEEDS-A-PLACE: a victim that cannot be located contributes nothing', () => {
    expect(particlesAt([impact(0, 'v', 'a', 'shield_bash')], 0.2, VFX, asAegis, () => undefined)).toEqual([]);
  });

  it('AT-IN-THE-PALETTE: debris is in the caster\'s own tones', () => {
    const tones = Object.values(VFX['aegis']!.palette)
      .map((hex) => Number.parseInt(hex.replace('#', ''), 16));
    for (const p of particlesAt([impact(0, 'v', 'a', 'shield_bash')], 0.2, VFX, asAegis, places)) {
      expect(tones).toContain(p.color);
    }
  });
});
