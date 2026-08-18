/**
 * The build-time configuration this client reads (M3-DEPLOY-PREP).
 *
 * Declared by hand rather than by pulling in `vite/client`, which would also
 * declare ambient modules for every asset type the bundler understands — a much
 * larger surface than one string, and one that would quietly make `import
 * './thing.png'` typecheck in a codebase that has no images.
 *
 * Exactly one variable, and it is read in exactly one place (`main.ts`): the
 * modules that *use* it take it as an argument, so nothing but the shell knows a
 * build environment exists.
 */
interface ImportMetaEnv {
  /**
   * Where the Worker is, when it is not where the page is.
   *
   * A host (`cards-rooms.lockstepcards.workers.dev`) or a full origin. Absent or
   * empty means same-origin, which is the development setup: `vite dev` proxies
   * `/rooms` to a local `wrangler dev`. Set at build time by the deploy workflow.
   */
  readonly VITE_WORKER_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
