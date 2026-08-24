/**
 * BUNDLE1 — a budget on the shipped client bundle.
 *
 * Three.js put the bundle at ~145 kB gzipped when this was written; it has since
 * grown with the client. Measure rather than trust that number — `npm run size`
 * on a clean checkout is the only current figure.
 * The risk is not today's number, it is a regression nobody notices: an
 * accidental deep import, a second copy of a library, a dev-only module pulled
 * into the graph. The budget exists to make that loud.
 *
 * Deliberately a FAILURE, not a warning: a warning in a CI log that already
 * passes is a warning nobody reads.
 *
 * **Raised 300 kB -> 350 kB, on the owner's call, and the number is chosen
 * rather than rounded up.** The original was 300 against a 145 kB bundle —
 * "roughly 2x today", with the stated fix on breach being to code-split rather
 * than to raise. The client has since grown to 235 kB honestly (the renderer,
 * themes, grain, the sky, the camera), so that 2x margin had quietly become
 * 1.27x and the budget was closer to a tripwire under the pedals than a guard.
 *
 * 350 keeps it a real guard, because the failure it exists to catch has a
 * **size**. The likeliest accident here is a second copy of `three` — a deep
 * import that defeats deduplication — and three is ~145 kB gzipped. From 235
 * that lands at ~380, which is over 350 and under 400: the budget still fails
 * loudly on the one mistake it was built for, while leaving 115 kB (about 49%)
 * for the client to keep growing on purpose. A round 400 or a doubled 470 would
 * both have stopped catching it.
 *
 * The corollary is that this cannot be raised twice by the same reasoning. At
 * ~280 kB of honest growth there is no number that both clears the code and
 * catches a duplicated three, and the answer then is the one the original note
 * gave: split the renderer out of the main chunk.
 *
 * Run locally with `npm run size -w @cards/client` after a build.
 */

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Budget in bytes of gzipped JS. */
const BUDGET = 350 * 1024;
const DIST = new URL('../dist/assets/', import.meta.url).pathname;

let total = 0;
const rows = [];
for (const name of readdirSync(DIST)) {
  if (!name.endsWith('.js')) continue;
  const path = join(DIST, name);
  if (!statSync(path).isFile()) continue;
  const gzipped = gzipSync(readFileSync(path)).byteLength;
  total += gzipped;
  rows.push(`  ${name}  ${(gzipped / 1024).toFixed(1)} kB gz`);
}

if (rows.length === 0) {
  console.error(`No JS found in ${DIST} — run the client build first.`);
  process.exit(1);
}

/**
 * ASSET-WEIGHT-BUDGET's other half: the **loader stays split**.
 *
 * `GLTFLoader` and its friends are only needed by a match that has rigged
 * characters, and `character-model.ts` is imported dynamically so they land in
 * their own chunks. That is easy to lose by accident — one static import
 * anywhere pulls the whole loader into the entry chunk — and the total above
 * would barely move when it happened, because the bytes are the same bytes.
 * They are just paid by everybody, on every first load, instead of by the
 * matches that use them.
 *
 * Checked by the chunk's existence rather than by measuring the entry: if the
 * loader were statically imported, Vite would have no reason to emit a chunk
 * named after it. The budget total is unchanged and still counts every chunk.
 */
const split = readdirSync(DIST).filter((n) => /^GLTFLoader-.*\.js$/.test(n));

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(rows.join('\n'));
console.log(`total ${kb(total)} gzipped · budget ${kb(BUDGET)}`);
console.log(`code-split: ${split.length > 0 ? split.join(', ') : 'NONE'}`);

if (split.length === 0) {
  console.error(
    '::error::GLTFLoader is no longer a separate chunk — something imports it statically.\n' +
    'Keep `character-model.ts` behind a dynamic import so a match without rigged art never fetches it.',
  );
  process.exit(1);
}

if (total > BUDGET) {
  console.error(
    `::error::Client bundle is ${kb(total)} gzipped, over the ${kb(BUDGET)} budget.\n` +
    'Code-split the renderer (dynamic import of renderer3d.ts) rather than raising the budget.',
  );
  process.exit(1);
}
