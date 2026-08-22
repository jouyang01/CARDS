/**
 * RENDER-FLAGS — the switches that keep a frame reproducible and cheap.
 *
 * Two of them now, and they exist for the same underlying reason: the browser
 * suite is the only thing that can see what the renderer actually draws
 * (`gl.readPixels` and `toDataURL()` both come back black off this canvas), and
 * it can only do that by comparing whole frames and counting pixels. Anything
 * that makes a frame vary — motion, or an asset arriving mid-test — takes that
 * instrument away.
 *
 * ---
 *
 * AMBIENT-FREEZE — the switch that has to exist *before* anything moves.
 *
 * Phase 5 of `docs/MAP_PIPELINE.md` is where a map gets life: ships crossing
 * overhead, fans turning, steam, a flickering sign. None of that exists yet, and
 * this module is deliberately shipping ahead of it, because the moment the first
 * moving thing lands it breaks the browser suite and the break is not obvious
 * from the failure.
 *
 * `e2e/render.spec.ts` asserts frames are **byte-identical**:
 *
 * ```ts
 * expect(same(await frame(page), committed),
 *   `pointer at ${fx},${fy} must not move a committed aim`).toBe(true);
 * ```
 *
 * That is a real assertion about a real bug — a committed aim used to follow the
 * mouse — and the only way it can be checked is by comparing whole frames. One
 * rotating fan makes it fail forever, and the failure reads as "the aim is
 * moving" rather than "the scenery is". Retrofitting a freeze *after* that
 * happens means debugging a false accusation first. Shipping it first costs
 * nothing and removes the trap.
 *
 * Three ways to be still, and all three are honoured:
 *
 * 1. `?ambient=off` — what the browser tests use. Explicit, greppable, and does
 *    not depend on the runner's environment.
 * 2. `prefers-reduced-motion: reduce` — the OS-level accessibility setting.
 *    Ambient motion is decoration by definition, so it is exactly the category
 *    that setting exists to suppress. Free to honour, and rude not to.
 * 3. A caller passing it explicitly, for a screenshot or a scenario.
 *
 * **No `three` import and no renderer state**, so the decision is a pure
 * function of the environment and can be tested without a GL context — the same
 * reason `sky.ts`, `themes.ts` and `grain.ts` stay dependency-free.
 */

export interface RenderFlagEnvironment {
  /** The query string, with or without its leading `?`. */
  search?: string;
  /** Whether the viewer asked the OS to reduce motion. */
  reducedMotion?: boolean;
}

/** The values of `?ambient=` that mean "hold still". */
const OFF = new Set(['off', 'none', '0', 'false']);

/**
 * Whether ambient motion should run.
 *
 * Defaults to **on**: a fresh page with no query and no accessibility
 * preference is an ordinary player, and the whole point of phase 5 is that they
 * see a living map. Only an explicit request turns it off.
 */
export function ambientEnabled(env: RenderFlagEnvironment = {}): boolean {
  if (env.reducedMotion === true) return false;
  const search = env.search ?? '';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const asked = params.get('ambient');
  if (asked === null) return true;
  return !OFF.has(asked.trim().toLowerCase());
}

/**
 * Read the environment from the live browser.
 *
 * Split from the decision so the decision stays testable. `matchMedia` is
 * guarded because it is absent in some embedded contexts and a missing
 * accessibility API should mean "no preference expressed", never a crash on
 * boot.
 */
export function browserAmbient(): boolean {
  const reduced = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return ambientEnabled({
    search: globalThis.location?.search ?? '',
    reducedMotion: reduced,
  });
}

// ── MODEL-FREEZE ────────────────────────────────────────────────────────────

/**
 * Whether rigged character models may load and render.
 *
 * **Measured, not guessed.** After the character pipeline landed, the browser
 * suite went from 3 failures to 14 — and every one of the 14 was a *timeout*,
 * not a failed assertion. The whole suite had slowed by roughly 3× (one test
 * 6.5s → 17.8s), so the long ones crossed the 60s limit while the short ones
 * survived; the tests that never render a board stayed fast, which locates the
 * cost in per-frame rendering of a `SkinnedMesh` under SwiftShader rather than
 * in fetching the `.glb`.
 *
 * Two things follow, and only one of them is about speed:
 *
 * 1. **Determinism.** `app.ts` fires `preloadCharacters` unawaited — it must,
 *    because the opening paint is synchronous or the enemy team flashes
 *    unfogged (VISION1) — so a model lands at an arbitrary moment and
 *    `staleUnitGroups` rebuilds the unit *mid-test*. A unit's pixels change
 *    from flat team colour to a textured atlas partway through a frame
 *    comparison. That is the same hazard `ambientEnabled` guards against,
 *    arriving from a direction nobody had guarded.
 * 2. **Speed.** A 32-minute suite that sits a few seconds under its own timeout
 *    is not a suite anyone will trust, even on the days it passes.
 *
 * So the board suite runs against the box renderer its predicates were written
 * for, and character-model rendering gets its own dedicated test with a budget
 * of its own. That is *better* coverage than thirty-two tests each incidentally
 * depending on whether a fetch had landed yet.
 */
export function modelsEnabled(env: RenderFlagEnvironment = {}): boolean {
  const search = env.search ?? '';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const asked = params.get('models');
  if (asked === null) return true;
  return !OFF.has(asked.trim().toLowerCase());
}

/** `modelsEnabled` read from the live browser. */
export function browserModels(): boolean {
  return modelsEnabled({ search: globalThis.location?.search ?? '' });
}
