/**
 * RIM — the edge light that separates a unit from the ground it stands on.
 *
 * A figure darker than its floor reads as a hole. Measured on Proving Grounds
 * before VALUE-BUDGET: floor 163, Aegis 112, a team-blue box 90 — every unit on
 * the board sat *under* the surface it was standing on. Lowering the terrain
 * (see `value-budget.ts`) fixes the hierarchy, but it does not by itself give a
 * silhouette an edge, and an edge is what says "this is an object in front of
 * that" rather than "this is a darker patch of that".
 *
 * ## Why this is not a light
 *
 * The obvious implementation is a back light on a layer only units belong to.
 * **Three.js cannot do that.** `WebGLRenderer.projectObject` collects a light
 * when `light.layers.test( camera.layers )` — the test is against the *camera*,
 * not against each mesh — so once a light is in the scene it lights everything
 * in it. A rim light added that way would climb all over the terrain too, and
 * because a rim has to follow the viewer it would swing across the map on every
 * orbit.
 *
 * So the rim is a Fresnel term on the unit material instead: brightest where the
 * surface turns away from the eye, absent where it faces the eye. That is
 * unit-scoped by construction, needs no extra light, and tracks the camera for
 * free because it is computed from the view vector.
 *
 * ## Why it is achromatic, and must stay that way
 *
 * **The rim carries no hue, and this is a hard constraint rather than a taste.**
 * `docs/BACKLOG.md` FOF-UNITS gives colour on a unit a specific job: viewer-
 * relative friend-or-foe — **self blue, ally green, foe red** — carried on a
 * foot ring, an outline and the nameplate, so that a mirror matchup is still
 * readable. Hue on a unit is about to mean *whose side they are on*.
 *
 * A tinted rim would be a fourth colour competing for that channel, and worse,
 * it would sit exactly where the FoF outline sits — along the silhouette. So the
 * rim is pure value: it says *there is an edge here*, and leaves *whose edge it
 * is* entirely to FoF. `rim.test.ts` asserts the achromaticity so a later tuning
 * pass cannot quietly reintroduce a tint.
 */

/**
 * The rim's colour. White — see the header: hue on a unit belongs to FoF.
 *
 * Kept as a number rather than inlined so the constraint has something to be
 * asserted about.
 */
export const RIM_COLOUR = 0xffffff;

/**
 * How far the grazing edge is lifted, in emissive units.
 *
 * Small on purpose. The rim's job is to make a silhouette findable, not to
 * outline it — a strong Fresnel on a low-poly character reads as a plastic
 * shell, and on a *box* unit it reads as four glowing strips. At 0.34 a unit
 * separates from the floor and nothing announces that a shader is involved.
 */
export const RIM_STRENGTH = 0.34;

/**
 * The Fresnel exponent — how tightly the lift hugs the edge.
 *
 * The whole point is that it stays *off* across the body: at 2.8, a surface
 * facing the viewer within about 40° is lifted by under 8% of `RIM_STRENGTH`,
 * so the front of a character is untouched and only the turning edge catches it.
 * Lower exponents wash the entire model and take the flat, unlit look this is
 * meant to cure and replace it with a flat, *glowing* one.
 */
export const RIM_POWER = 2.8;

/** True when a colour has no hue at all — the FoF constraint, as a predicate. */
export function isAchromatic(hex: number): boolean {
  const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  return r === g && g === b;
}

/**
 * The rim's contribution at a given angle, as the shader computes it.
 *
 * `nDotV` is the dot product of the surface normal and the direction to the
 * eye: 1 facing the viewer, 0 at a grazing edge. Duplicated here in TypeScript
 * so the *curve* — the thing that decides whether this reads as an edge or as a
 * glow — is pinned by a Node test rather than by looking at a screenshot. The
 * GLSL in `renderer3d.ts` is the same expression; `rim.test.ts` fixes the values
 * it must produce.
 */
export function rimFactor(nDotV: number): number {
  const facing = Math.min(1, Math.max(0, nDotV));
  return Math.pow(1 - facing, RIM_POWER) * RIM_STRENGTH;
}
