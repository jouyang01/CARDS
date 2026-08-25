import { describe, expect, it } from 'vitest';
import wispArt from '../../../data/art/wisp.json';
import vfx from '../../../data/vfx.json';

/**
 * WISP-DECOY-SAFETY — the one non-obvious rule that art can silently break.
 *
 * Veil & Decoy leaves a decoy that renders TO THE ENEMY TEAM AS WISP: the same
 * model playing the same idle clip. The deception is the whole ability. The
 * decoy's HP is frozen at cast time and it has no energy — so if Wisp's model or
 * materials carried any STATE-DRIVEN visual (a wound overlay, an HP tint, an
 * ultimate-charge glow), the real Wisp and her decoy would diverge the instant
 * she took a hit or charged her ult, and the decoy would give itself away.
 *
 * The standing rule (docs/design/wisp.md §8): all state feedback lives in the
 * HUD and the ground ring — layers the decoy mimics — never in the model. Her
 * ambient smoke is the one effect baked to her identity, and it is safe only
 * because it is CONSTANT rather than state-driven. These specs are the guard
 * that keeps a future edit from quietly reintroducing the divergence.
 */

/** Keys that would make a visual depend on a unit's live state. */
const STATE_DRIVEN_KEYS = [
  'damageStates', 'damageState', 'woundOverlay', 'wounds',
  'hpTint', 'hpColor', 'lowHp', 'lowHpVfx', 'bloodied',
  'energyGlow', 'chargeGlow', 'ultGlow', 'ultimateGlow', 'chargeTint',
];

/** Every key name that appears anywhere in a nested object/array. */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe('WISP-DECOY-SAFETY: nothing on her model may depend on live state', () => {
  it('DECOY-NO-STATE-VISUALS: her art spec declares no HP/energy/charge-driven visual', () => {
    const keys = new Set(allKeys(wispArt));
    for (const forbidden of STATE_DRIVEN_KEYS) {
      expect(keys.has(forbidden),
        `data/art/wisp.json carries "${forbidden}" — a state-driven visual the decoy cannot mimic (docs/design/wisp.md §8)`,
      ).toBe(false);
    }
  });

  it('DECOY-SMOKE-IS-CONSTANT: her one baked identity effect is ambient, not state-driven', () => {
    // The ambient smoke is safe precisely because it is constant. Marking it so
    // in data is what lets a maintainer tell it apart from a state effect.
    const lang = (wispArt as unknown as { vfxLanguage: Record<string, unknown> }).vfxLanguage;
    expect(lang.primitive).toBe('smoke');
    expect(lang.shared, 'one language across the whole kit').toBe(true);
    // Cold and weightless: a drifting constant, never a plume that reacts.
    expect(lang.cold).toBe(true);
    expect(lang.buoyancy).toBe(0);
  });

  it('DECOY-ABILITY-VFX-IS-EVENT-DRIVEN: her ability effects key off abilities, never unit state', () => {
    // Ability VFX fire on cues (an ability was cast, a hit landed) — the same
    // for a real cast whoever's HP. A field keyed on state here would be as
    // unsafe as one on the model.
    const entry = (vfx as Record<string, unknown>)['wisp'];
    const keys = new Set(allKeys(entry));
    for (const forbidden of STATE_DRIVEN_KEYS) {
      expect(keys.has(forbidden), `wisp VFX carries "${forbidden}"`).toBe(false);
    }
  });
});
