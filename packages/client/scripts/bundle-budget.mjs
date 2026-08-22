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
 * passes is a warning nobody reads. The headroom (roughly 2x today) is what
 * makes failing safe — you have to double the bundle to trip it, and the fix
 * when you do is to code-split the renderer, not to raise the number.
 *
 * Run locally with `npm run size -w @cards/client` after a build.
 */

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Budget in bytes of gzipped JS. */
const BUDGET = 300 * 1024;
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
