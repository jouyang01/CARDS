import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import type { MeshBasicMaterial } from 'three';
import { MODEL_HEIGHT_TILES, PLATE_ORDER, buildBars } from '../src/renderer3d.js';

/**
 * NAMEPLATE-DEPTH — *"Nameplate still is hidden by Aegis' character model."*
 *
 * The plate hangs a fixed distance above the thing it labels, which clears a
 * BOX and does not clear a rigged character: Aegis's shield and shoulders reach
 * into that band, and because the plate is a camera-facing quad *inside* the
 * scene, whatever mesh is in front of it wins the depth test and eats the name.
 *
 * Raising it further would only move the problem to the next taller model and
 * the next steeper camera angle. The plate is UI drawn in world space, so it
 * opts out of depth and composites after the scene instead.
 *
 * **Why this is testable at all.** The renderer needs a WebGL context and cannot
 * be built headlessly; the object graph it hangs over a unit needs nothing but
 * Three's geometry and material classes, so `buildBars` is exported and the
 * policy is asserted on the real meshes. What that leaves to the eye is only
 * whether the result *looks* right — not whether the depth flags are set, which
 * is the half that regressed.
 */

const meshNamed = (bars: ReturnType<typeof buildBars>, name: string): Mesh => {
  const found = bars.getObjectByName(name);
  if (!(found instanceof Mesh)) throw new Error(`no ${name} mesh in the bars group`);
  return found;
};
const material = (mesh: Mesh): MeshBasicMaterial => mesh.material as MeshBasicMaterial;

describe('NAMEPLATE-DEPTH: the plate is drawn over the scene, not inside it', () => {
  it('THE BUG: the nameplate does not take part in the depth test', () => {
    // The one line that fixes the report. With `depthTest` on, a plate sitting
    // inside a tall model's silhouette is discarded fragment by fragment — which
    // is exactly "hidden by Aegis' character model".
    const bars = buildBars(MODEL_HEIGHT_TILES);
    expect(material(meshNamed(bars, 'plate')).depthTest, 'depth is off for the plate')
      .toBe(false);
  });

  it('and it sorts last, so nothing transparent lands on top of it', () => {
    // Depth off is only half: the transparent pass still sorts, and a plate that
    // lost that sort to a highlight quad would be the same bug wearing a
    // different costume.
    const bars = buildBars(MODEL_HEIGHT_TILES);
    expect(meshNamed(bars, 'plate').renderOrder).toBe(PLATE_ORDER);
    expect(PLATE_ORDER, 'well clear of the renderer’s default 0').toBeGreaterThan(0);
  });

  it('the intent tile rides the same pass, one step above the plate', () => {
    // They are two pieces of one label. Half of it clipping behind a shoulder
    // while the other half floats free reads worse than either alone.
    const bars = buildBars(MODEL_HEIGHT_TILES);
    const intent = meshNamed(bars, 'intent');
    expect(material(intent).depthTest).toBe(false);
    expect(intent.renderOrder, 'above the plate it sits on').toBeGreaterThan(PLATE_ORDER);
  });

  it('a rigged model and a box get the same treatment, at their own heights', () => {
    // "For rigged models and boxes alike." The height differs — that is what
    // `topY` is for — but the depth policy must not, or the fix would hold for
    // Aegis today and fail for the next character to get a model.
    const tall = buildBars(MODEL_HEIGHT_TILES);
    const box = buildBars(1);
    expect(tall.position.y, 'the plate follows the height of what it labels')
      .toBeGreaterThan(box.position.y);
    for (const bars of [tall, box]) {
      for (const name of ['plate', 'intent']) {
        expect(material(meshNamed(bars, name)).depthTest, `${name} at y=${bars.position.y}`)
          .toBe(false);
      }
    }
  });

  it('and the plate still hangs ABOVE the unit, rather than relying on the fix', () => {
    // The guard against the lazy version of this change. Turning depth off makes
    // a plate drawn at the unit's feet visible too — and wrong. The offset is
    // still the thing that puts it overhead; depth is what keeps it there.
    expect(buildBars(MODEL_HEIGHT_TILES).position.y).toBeGreaterThan(MODEL_HEIGHT_TILES);
  });
});
