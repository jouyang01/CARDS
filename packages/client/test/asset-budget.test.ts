import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ASSET-WEIGHT-BUDGET — the art gets its own number.
 *
 * Builder session-13 (art) OQ #2: `bundle-budget.mjs` counts `.js` in
 * `dist/assets/` and **nothing in `public/`**, which is where the models live.
 * One rigged character already outweighs the entire gzipped client bundle, so
 * the thing being watched was the small half — and `public/models/` is a real,
 * growing directory now.
 *
 * A budget script nobody has run against a failing directory is a script that
 * has never been proved to fail, which is the only behaviour that matters: on a
 * green checkout it prints numbers and exits 0 whether or not the comparison
 * works. So these build directories that are deliberately over each cap and
 * assert that it says so.
 *
 * The script is `.mjs` because that is what the sibling budget is; it is
 * imported dynamically here for the same reason.
 */

const load = async () => import('../scripts/asset-budget.mjs');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory of files with exactly the sizes named, in MiB. */
const models = (files: Record<string, number>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cards-assets-'));
  dirs.push(dir);
  for (const [name, mib] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, Buffer.alloc(Math.round(mib * 1024 * 1024)));
  }
  return dir;
};

describe('ASSET-WEIGHT-BUDGET: what it counts', () => {
  it('every file under the directory, including nested ones', async () => {
    // Recursive because nothing stops the art pipeline growing a subdirectory,
    // and a budget that silently skipped one would be worse than none.
    const { report } = await load();
    const out = report(models({ 'aegis.glb': 1, 'props/aegis_door.glb': 0.25 }));
    expect(out.total).toBe(Math.round(1.25 * 1024 * 1024));
    expect(out.empty).toBe(false);
  });

  it('and groups them by character, so the per-character number is a load', async () => {
    // `aegis.glb`, `aegis_door.glb` and `aegis.clips.json` are one download
    // between them. Reporting the biggest file instead would understate what a
    // character actually costs by whatever the props weigh.
    const { report } = await load();
    const out = report(models({ 'aegis.glb': 1, 'aegis_door.glb': 0.2, 'aegis.clips.json': 0, 'vex.glb': 0.5 }));
    expect(out.characters.map((c) => c.id), 'sorted, so the output is stable')
      .toEqual(['aegis', 'vex']);
    expect(out.characters[0]!.bytes).toBe(Math.round(1.2 * 1024 * 1024));
  });

  it('a file belonging to nobody is its own entry, held to the same cap', async () => {
    // §18's proposed `shared.glb` is the case: everybody downloads it, so it is
    // at least as load-bearing as one character's mesh.
    const { characterOf } = await load();
    expect(characterOf('shared.glb')).toBe('shared');
    expect(characterOf('aegis_door.glb')).toBe('aegis');
    expect(characterOf('aegis.clips.json')).toBe('aegis');
  });
});

describe('ASSET-WEIGHT-BUDGET: it actually fails', () => {
  it('one character over its own cap is an error, naming the character', async () => {
    // The cap that goes off in practice: the roster is *expected* to grow, so a
    // total-only guard could not tell "one more character" from "one character
    // got twice as heavy".
    const { report } = await load();
    const out = report(models({ 'aegis.glb': 4.4 }));
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('aegis');
    expect(out.errors[0], 'and points at where the fix lives').toContain('ART_PIPELINE.md §18');
  });

  it('and a roster that fits its per-character caps can still blow the total', async () => {
    // The other cap earning its place. Fourteen characters at a legal 2.4 MB
    // each is 33.6 MB of art with nothing individually wrong with it — which is
    // exactly the download §18 exists to prevent.
    const { report } = await load();
    const files: Record<string, number> = {};
    for (let i = 0; i < 14; i++) files[`char${i}.glb`] = 2.4;
    const out = report(models(files));
    expect(out.characters.every((c) => c.bytes < 4 * 1024 * 1024), 'each one is legal').toBe(true);
    expect(out.errors, 'and the total is not').toHaveLength(1);
    expect(out.errors[0]).toContain('public/models/');
  });

  it('today’s real directory passes, with the numbers in the output', async () => {
    // The green case, asserted so a script that could only ever fail would be
    // caught too — and so the report is proved to say something readable.
    const { report } = await load();
    const out = report(new URL('../public/models/', import.meta.url).pathname);
    expect(out.errors, 'the checked-in art is inside both budgets').toEqual([]);
    expect(out.characters.map((c) => c.id), 'the rigged characters shipped so far').toEqual(['aegis', 'vex', 'wisp']);
    expect(out.lines.join('\n')).toContain('budget');
  });

  it('counts terrain props apart from characters, but still toward the total', async () => {
    // Props under `props/` are a bucket of their own — a stone pillar is not a
    // rigged character and must not pollute the roster list or its cap — while
    // still being bytes a player downloads, so they count toward the grand total.
    const { report } = await load();
    const out = report(new URL('../public/models/', import.meta.url).pathname);
    expect(out.characters.map((c) => c.id), 'props are not in the character list').toEqual(['aegis', 'vex', 'wisp']);
    expect(out.props, 'the Proving Floor props are weighed').toBeGreaterThan(0);
    expect(out.props, 'and are well under the per-character cap').toBeLessThan(2 * 1024 * 1024);
    expect(out.total, 'the total includes them').toBeGreaterThan(
      out.characters.reduce((n, c) => n + c.bytes, 0));
    expect(out.lines.join('\n')).toContain('props total');
  });
});
