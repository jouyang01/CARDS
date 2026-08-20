import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRoster, createMatch, resolveTurn,
  type CharacterDef, type MapDef, type Roster, type Vec2,
} from '@cards/engine';
import {
  PIP_COLORS, PIP_ORDER, STATUS_LABELS, overTimeBlurb, statusChips, statusGlyph, statusPips,
} from '../src/status-pips.js';

/**
 * BURN-VISIBLE — *"Cinder burn should be a debuff that players can see."*
 *
 * The burn was never broken. DOT-HOT put it on `unit.statuses` as a proper timed
 * instance carrying its per-turn amount, and `tickOverTime` has been taking HP
 * off at end of turn ever since. What it had was **no mark**: `PIP_ORDER` was
 * written before over-time effects existed and nobody added them, so a burning
 * unit looked exactly like a healthy one and the only way to learn you were on
 * fire was to watch your HP fall for no visible reason.
 *
 * That is the same shape of report as STATUS-AUDIT's *"Stealth and Slow are not
 * working"* — a player concluding a mechanic does nothing because nothing on
 * screen says it is happening — and it deserved the same answer: put it in the
 * vocabulary, and let the pip row, the HUD strip and the nameplate all pick it
 * up from there without knowing it is new.
 *
 * `healOverTime` rides along. The backlog calls it out of scope *"unless cheap"*,
 * and it is exactly one row in each table: the two kinds are the same mechanic
 * pointed in opposite directions, and shipping one of them would leave the
 * asymmetry as a thing to explain later.
 *
 * The tests run the real burn — Cinder's Solar Flare, resolved — rather than a
 * hand-built status, so what is asserted is the pip a player would actually see
 * after being hit by the ability the Dev Note names.
 */

const load = (name: string): CharacterDef => JSON.parse(
  readFileSync(join(import.meta.dirname, '../../..', `data/characters/${name}.json`), 'utf8'),
) as CharacterDef;

const CINDER = load('cinder');
const VEX = load('vex');
const LUMEN = load('lumen');
const FLARE = CINDER.ultimate;

const OPEN: MapDef = {
  id: 't', name: 't', width: 21, height: 21, walls: [], cover: [], brush: [],
  spawns: [[{ x: 2, y: 10 }], [{ x: 18, y: 10 }]],
};
const roster: Roster = buildRoster([CINDER, VEX, LUMEN]);

/** Cinder burns the enemy for real, and hands back the enemy's statuses. */
const burned = () => {
  const state = createMatch(OPEN, '1v1', [[CINDER], [VEX]]);
  const me = state.units.find((u) => u.owner === 0)!;
  const foe = state.units.find((u) => u.owner === 1)!;
  me.pos = { x: 10, y: 10 };
  foe.pos = { x: 13, y: 10 };
  me.energy = 100;
  const at: Vec2 = { ...foe.pos };
  const after = resolveTurn(state, OPEN, [
    { team: 0, units: [{ unitId: me.unitId, ability: { abilityId: FLARE.id, target: [at] } }] },
    { team: 1, units: [] },
  ], roster).state;
  return after.units.find((u) => u.unitId === foe.unitId)!;
};

describe('BURN-VISIBLE: a burning unit shows it', () => {
  it('the ability really does leave a damageOverTime status', () => {
    // The fixture, asserted before anything is concluded from it: a Solar Flare
    // that stopped burning would make every claim below pass for free.
    const victim = burned();
    const dot = victim.statuses.find((s) => s.kind === 'damageOverTime');
    expect(dot, 'burning').toBeDefined();
    expect(dot!.remaining, 'with turns left on it').toBeGreaterThan(0);
    expect(dot!.amount, 'and a per-turn amount').toBeGreaterThan(0);
  });

  it('renders a pip, with its remaining turns stamped on it', () => {
    const victim = burned();
    const burn = statusPips(victim.statuses).find((p) => p.kind === 'damageOverTime');
    expect(burn, 'the pip a player sees').toBeDefined();
    expect(burn!.numeral, 'turns left, like root/slow/reveal')
      .toBe(victim.statuses.find((s) => s.kind === 'damageOverTime')!.remaining);
  });

  it('and it is drawn, not an empty slot where a glyph should be', () => {
    // `statusGlyph` returns `[]` for a kind with no artwork — deliberately, so a
    // missing mark looks missing. That is precisely what a half-done BURN
    // -VISIBLE would leave behind: a pip in the row that draws nothing.
    expect(statusGlyph('damageOverTime').length, 'the flame exists').toBeGreaterThan(0);
    expect(statusGlyph('healOverTime').length).toBeGreaterThan(0);
    expect(PIP_COLORS['damageOverTime'], 'and has a colour of its own').toBeDefined();
  });

  it('reads as a debuff, on the same side as Slow and Root', () => {
    // Compared against another debuff rather than against a literal: the tint is
    // derived from the engine's FF1 polarity table, and the claim worth pinning
    // is that burn lands in the same half as the debuffs a player already knows,
    // not that it is one particular hex value.
    const burn = statusPips(burned().statuses).find((p) => p.kind === 'damageOverTime')!;
    expect(burn.tint).toBe(statusPips([{ kind: 'slow' }])[0]!.tint);
    expect(burn.tint, 'and not the buffs\' side')
      .not.toBe(statusPips([{ kind: 'might' }])[0]!.tint);
  });
});

describe('BURN-VISIBLE: hovering it names the per-turn amount', () => {
  it('the chip says how much it takes each turn', () => {
    const victim = burned();
    const chip = statusChips(victim.statuses).find((c) => c.kind === 'damageOverTime')!;
    const amount = victim.statuses.find((s) => s.kind === 'damageOverTime')!.amount!;
    expect(chip.label).toBe('Burning');
    expect(chip.blurb, 'the number is in the words').toContain(String(amount));
    expect(chip.amount, 'and beside them').toBe(amount);
    expect(chip.remaining).toBeGreaterThan(0);
  });

  it('the number comes off the status, not out of a table in the client', () => {
    // The rule the other blurbs follow is "describe the effect, never restate a
    // magnitude", because a restated constant survives a balance pass as a lie.
    // This blurb may carry a figure only because the figure is the engine's own
    // instance amount — so a different burn says a different number.
    expect(overTimeBlurb('damageOverTime', 8)).toContain('8');
    expect(overTimeBlurb('damageOverTime', 3)).toContain('3');
    expect(overTimeBlurb('damageOverTime', 3), 'and it is not the 8').not.toContain('8');
  });

  it('and falls back to the wordless version when there is no amount to name', () => {
    // Playback folds the event log, which carries the kind and not the instance.
    // A tooltip reading "Takes 0 damage" would be worse than the general one.
    expect(overTimeBlurb('damageOverTime', 0)).toBeUndefined();
    const folded = statusChips([{ kind: 'damageOverTime', remaining: 2 }]);
    expect(folded[0]!.blurb, 'still says what it does').toMatch(/damage at the end of each turn/);
    expect(folded[0]!.blurb).not.toMatch(/\d/);
  });

  it('says nothing over-time about a status that is neither', () => {
    expect(overTimeBlurb('slow', 4)).toBeUndefined();
    expect(overTimeBlurb('shield', 40)).toBeUndefined();
  });
});

describe('BURN-VISIBLE: regen gets the same treatment', () => {
  it('a healOverTime unit shows a buff pip that names its per-turn heal', () => {
    const chip = statusChips([{ kind: 'healOverTime', remaining: 3, amount: 6 }])[0]!;
    expect(chip.label).toBe('Regenerating');
    expect(chip.harmful, 'the other side of the same mechanic').toBe(false);
    expect(chip.blurb).toContain('6');
  });

  it('both sit on their own side of the row', () => {
    // Debuffs lead (`PIP_ORDER`'s standing rule), so burn is ahead of regen and
    // ahead of every buff. Asserted through the table rather than by index, so
    // it survives a kind being inserted between them.
    expect(PIP_ORDER.indexOf('damageOverTime'))
      .toBeLessThan(PIP_ORDER.indexOf('healOverTime'));
    expect(STATUS_LABELS['damageOverTime']).toBe('Burning');
    expect(STATUS_LABELS['healOverTime']).toBe('Regenerating');
  });
});
