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

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(rows.join('\n'));
console.log(`total ${kb(total)} gzipped · budget ${kb(BUDGET)}`);

if (total > BUDGET) {
  console.error(
    `::error::Client bundle is ${kb(total)} gzipped, over the ${kb(BUDGET)} budget.\n` +
    'Code-split the renderer (dynamic import of renderer3d.ts) rather than raising the budget.',
  );
  process.exit(1);
}
