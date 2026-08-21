import { describe, expect, it } from 'vitest';
import { auditClips, modelUrl, postureRotations, type PostureSpec } from '../src/character-model.js';
import type { ClipSet } from '../src/character-clips.js';

/**
 * Posture is the pure, testable part of the Three.js half.
 *
 * Mixamo's auto-rigger requires a symmetric T-pose, so a character's hunch and
 * dropped shoulder cannot be baked into the mesh. Applying them as bone offsets
 * on top of the mixer is better anyway: the posture then survives idle, run,
 * dash *and* death, instead of being one pose every clip overwrites.
 */
describe('postureRotations', () => {
  const deg = (rad: number): number => (rad * 180) / Math.PI;

  it('is empty when a character declares no posture', () => {
    expect(postureRotations(undefined).size).toBe(0);
    expect(postureRotations({}).size).toBe(0);
  });

  it('spreads the hunch across the spine chain rather than creasing one joint', () => {
    const r = postureRotations({ hunchDeg: 20 });
    expect([...r.keys()]).toEqual(['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2']);
    // Each vertebra takes a share, and the shares sum to the requested angle.
    const total = [...r.values()].reduce((a, b) => a + b, 0);
    expect(deg(total)).toBeCloseTo(20);
    // Lower spine bends most — a curve, not a kink.
    expect(r.get('mixamorigSpine')!).toBeGreaterThan(r.get('mixamorigSpine2')!);
  });

  it('drops the shoulder the character actually names', () => {
    expect([...postureRotations({ dropShoulder: 'left', dropShoulderDeg: 9 }).keys()])
      .toEqual(['mixamorigLeftShoulder']);
    expect([...postureRotations({ dropShoulder: 'right', dropShoulderDeg: 9 }).keys()])
      .toEqual(['mixamorigRightShoulder']);
  });

  it('defaults to the left shoulder when a side is not given', () => {
    expect([...postureRotations({ dropShoulderDeg: 5 }).keys()]).toEqual(['mixamorigLeftShoulder']);
  });

  it('converts degrees to radians', () => {
    expect(deg(postureRotations({ headForwardDeg: 7 }).get('mixamorigNeck')!)).toBeCloseTo(7);
  });

  it('omits any part the character left at zero', () => {
    const r = postureRotations({ hunchDeg: 0, headForwardDeg: 0, dropShoulderDeg: 0 });
    expect(r.size).toBe(0);
  });

  it("builds Aegis's full posture", () => {
    const aegis: PostureSpec = {
      dropShoulder: 'left', dropShoulderDeg: 9, hunchDeg: 13, headForwardDeg: 7,
    };
    const r = postureRotations(aegis);
    expect([...r.keys()].sort()).toEqual([
      'mixamorigLeftShoulder', 'mixamorigNeck',
      'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
    ]);
    for (const v of r.values()) expect(v).toBeGreaterThan(0);
  });
});

/**
 * MODEL-CACHE — the mesh URL carries the manifest's version.
 *
 * Vite fingerprints `dist/assets/`. It does not fingerprint `public/`, and the
 * models live there, so `aegis.glb` ships under that exact name every build. A
 * browser holding the previous rig will happily keep serving it while the
 * manifest beside it — a different, freshly-revalidated file — updates. The two
 * then disagree about which clips exist, which is the worst kind of stale: the
 * model loads, and the clip the manifest names is not in it.
 */
describe('modelUrl', () => {
  it('is the plain path when the manifest carries no version', () => {
    expect(modelUrl('models', 'aegis')).toBe('models/aegis.glb');
    expect(modelUrl('models', 'aegis', '')).toBe('models/aegis.glb');
  });

  it('changes whenever the bytes do', () => {
    const before = modelUrl('models', 'aegis', 'a1b2c3d4e5f6');
    const after = modelUrl('models', 'aegis', '0f9e8d7c6b5a');
    expect(before).toBe('models/aegis.glb?v=a1b2c3d4e5f6');
    expect(before).not.toBe(after);
  });

  it('escapes the version rather than trusting it to be hex', () => {
    expect(modelUrl('models', 'aegis', 'a b&c')).toBe('models/aegis.glb?v=a%20b%26c');
  });

  it('respects a base path, because Pages serves the app under /CARDS/', () => {
    expect(modelUrl('/CARDS/models', 'aegis', 'abc')).toBe('/CARDS/models/aegis.glb?v=abc');
  });
});

/**
 * MODEL-AUDIT — a manifest promise the .glb did not keep.
 *
 * The asymmetry here is the whole point. A model with no IDLE clip has nothing
 * to play when nothing is happening, so it stands in its bind pose: a literal
 * T-pose on the board, which reads far more broken than the box it replaced.
 * Any other missing clip costs exactly one animation.
 */
describe('auditClips', () => {
  const map: ClipSet = {
    idle: 'aegis_idle',
    run: 'sword_and_shield_run',
    hit: 'sword_and_shield_impact',
    death: 'sword_and_shield_death',
    knockback: 'knocked_down',
    abilities: { shield_bash: 'aegis_smash', barrier_pulse: 'aegis_ultimate' },
  };
  const all = [
    'aegis_idle', 'sword_and_shield_run', 'sword_and_shield_impact',
    'sword_and_shield_death', 'knocked_down', 'aegis_smash', 'aegis_ultimate',
  ];

  it('passes a .glb that shipped everything the manifest names', () => {
    expect(auditClips(map, all)).toEqual({ usable: true, missing: [] });
  });

  it('names what is missing, including ability clips', () => {
    const audit = auditClips(map, all.filter((n) => n !== 'aegis_ultimate' && n !== 'knocked_down'));
    expect(audit.usable, 'idle is there, so the model is still worth drawing').toBe(true);
    expect(audit.missing.sort()).toEqual(['aegis_ultimate', 'knocked_down']);
  });

  it('rejects the model outright when idle is the missing one', () => {
    // The T-pose case. Everything else is present and it still is not usable.
    expect(auditClips(map, all.filter((n) => n !== 'aegis_idle')).usable).toBe(false);
  });

  it('rejects a .glb that exported no animations at all', () => {
    // Blender 4.4+ can write a file with zero animations SILENTLY when it
    // cannot bind a slotted action. The mesh loads; nothing moves.
    expect(auditClips(map, [])).toMatchObject({ usable: false });
    expect(auditClips(map, []).missing.length).toBe(7);
  });

  it('reports each missing clip once even when two cues share it', () => {
    const shared: ClipSet = { ...map, hit: 'reaction', knockback: 'reaction' };
    expect(auditClips(shared, all).missing).toEqual(['reaction']);
  });
});
