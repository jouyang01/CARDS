/**
 * Types for `asset-budget.mjs`, so its test can import it under the workspace's
 * `noImplicitAny`. The script itself stays plain ESM, matching its sibling
 * `bundle-budget.mjs` — build tooling that runs before (and without) a compile
 * step has no business needing one.
 */

export interface AssetFile {
  /** Path relative to the scanned directory, with `/` separators. */
  name: string;
  path: string;
  bytes: number;
}

export interface CharacterWeight {
  id: string;
  bytes: number;
}

export interface AssetReport {
  /** Human-readable output, one entry per line. */
  lines: string[];
  /** One message per budget that was blown. Empty means the check passed. */
  errors: string[];
  total: number;
  characters: CharacterWeight[];
  /** True when the directory held no files at all — a broken path, not a pass. */
  empty: boolean;
}

/** Which character a file belongs to: the token before the first `.` or `_`. */
export function characterOf(name: string): string;
export function walk(dir: string, prefix?: string): AssetFile[];
export function weigh(dir: string): { files: AssetFile[]; characters: CharacterWeight[]; total: number };
export function report(dir: string): AssetReport;
