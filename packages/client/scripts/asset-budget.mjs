/**
 * ASSET-WEIGHT-BUDGET — a budget on the **art**, kept separate from the JS one.
 *
 * `bundle-budget.mjs` counts `.js` in `dist/assets/` and nothing in `public/`,
 * which is where the models live — so the whole of `public/models/` was growing
 * with no number on it at all. One rigged character is already larger than the
 * entire gzipped client bundle, which is the shape of the problem: the thing
 * being watched was the small half.
 *
 * **Two numbers, not one, and deliberately.** They fail for different reasons
 * and have different fixes. Over the JS budget means an accidental import or a
 * duplicated library, and the fix is to code-split. Over the asset budget means
 * an export got heavier or the roster grew, and the fix is in `build_glb.py` and
 * `ART_PIPELINE.md` §18. Adding them together would give one number that could
 * only ever say "something got bigger".
 *
 * **Raw bytes, not gzipped.** A `.glb` is a binary container whose bulk is
 * float keyframes and a texture atlas; both compress poorly (§18 measures the
 * keyframes at ~30 kB/s *over the wire*), and the byte a player waits for is the
 * one on disk. Gzipping here would report a number smaller than the download.
 *
 * Run locally: `npm run size:assets -w @cards/client`, optionally with a
 * directory argument.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Per-character ceiling, in bytes.
 *
 * **This is the cap that actually goes off.** Aegis, the first rig, weighs
 * ~1.16 MB (mesh + atlas + every clip), so the headroom here is about a quarter
 * — enough that a legitimately more detailed character passes, and not enough
 * that a doubled texture or an unbudgeted second prop slips through unnoticed.
 * Per character rather than only in total because the total is *expected* to
 * grow as the roster is rigged, and a guard that cannot tell "one more
 * character" from "one character got twice as heavy" is not a guard.
 */
const PER_CHARACTER = Math.round(1.5 * 1024 * 1024);

/**
 * Whole-directory ceiling, in bytes: what a player's browser can be asked to
 * hold for the full roster.
 *
 * Nine characters at today's weight is ~10.5 MB, which is the number
 * `ART_PIPELINE.md` §18 is a decision about — every character currently ships
 * its own copy of the four generic Mixamo clips. The cap sits above that and
 * **below** nine-at-the-per-character-cap (13.5 MB), so the roster fits as it
 * stands today but nine simultaneously heavier characters do not. If this trips,
 * the answer is §18's Option A (a shared clip `.glb`) or Option C (meshopt), not
 * a bigger number here.
 */
const TOTAL = 12 * 1024 * 1024;

/**
 * Which character a file belongs to: the leading token before the first `.` or
 * `_`. `aegis.glb`, `aegis_door.glb` and `aegis.clips.json` are all his, which
 * is what makes the per-character number mean "everything this character costs
 * to load" rather than "his biggest file".
 *
 * A file that belongs to nobody — §18's proposed `shared.glb`, say — groups
 * under its own name and is checked against the same per-character cap. That is
 * the right treatment: a shared file everyone downloads is at least as
 * load-bearing as one character's.
 */
export const characterOf = (name) => (/^[^._]+/.exec(name)?.[0] ?? name);

/** Every file under `dir`, recursively, as `{ name, path, bytes }`. */
export function walk(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, `${prefix}${entry.name}/`));
    else if (entry.isFile()) out.push({ name: `${prefix}${entry.name}`, path, bytes: statSync(path).size });
  }
  return out;
}

/** The report: per-character subtotals and the grand total, sorted by name. */
export function weigh(dir) {
  const files = walk(dir);
  const byCharacter = new Map();
  for (const file of files) {
    const id = characterOf(file.name.split('/').pop() ?? file.name);
    byCharacter.set(id, (byCharacter.get(id) ?? 0) + file.bytes);
  }
  return {
    files,
    characters: [...byCharacter.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, bytes]) => ({ id, bytes })),
    total: files.reduce((n, f) => n + f.bytes, 0),
  };
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

/** The whole check, as a pure function of a directory, so it is testable. */
export function report(dir) {
  const { files, characters, total } = weigh(dir);
  const lines = files.map((f) => `  ${f.name}  ${mb(f.bytes)}`);
  for (const c of characters) lines.push(`  ${c.id} total  ${mb(c.bytes)}`);
  lines.push(`total ${mb(total)} · budget ${mb(TOTAL)} (${mb(PER_CHARACTER)} per character)`);

  const errors = [];
  for (const c of characters) {
    if (c.bytes > PER_CHARACTER) {
      errors.push(
        `${c.id} is ${mb(c.bytes)}, over the ${mb(PER_CHARACTER)} per-character budget. ` +
        'Look at the texture atlas and the clip list before raising this — see docs/ART_PIPELINE.md §18.',
      );
    }
  }
  if (total > TOTAL) {
    errors.push(
      `public/models/ is ${mb(total)}, over the ${mb(TOTAL)} budget. ` +
      'The fix is docs/ART_PIPELINE.md §18 — a shared clip .glb (Option A) or meshopt (Option C) — ' +
      'not a bigger number here.',
    );
  }
  return { lines, errors, total, characters, empty: files.length === 0 };
}

// Only when run as a script, so the helpers above stay importable by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? new URL('../public/models/', import.meta.url).pathname;
  const { lines, errors, empty } = report(dir);
  if (empty) {
    console.error(`No asset files found in ${dir}.`);
    process.exit(1);
  }
  console.log(lines.join('\n'));
  for (const message of errors) console.error(`::error::${message}`);
  if (errors.length > 0) process.exit(1);
}
