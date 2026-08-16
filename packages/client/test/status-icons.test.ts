import { describe, expect, it } from 'vitest';
import type { EffectKind } from '@cards/engine';
import {
  GLYPH_BOX, OWNER_ONLY_PIPS, PIP_COLORS, PIP_ORDER, STATUS_GLYPHS,
  glyphSvg, statusChips, statusGlyph, statusPips, viewableStatuses,
} from '../src/status-pips.js';

/**
 * STATUS-ICONS (ar-parity §4.2) — the pips become drawn glyphs.
 *
 * Two things are worth pinning and one is not. Worth pinning: that the
 * vocabulary is **total** (a status with no glyph is a blank square floating
 * over a unit, which is the bug the colour pips already had in a different
 * form), and that **one source feeds both consumers** — the texture over the
 * unit and the `<svg>` in the HUD strip must be the same mark or the player is
 * learning two alphabets.
 *
 * Not worth pinning: whether the eye *looks like* an eye. That is a drawing,
 * and a test asserting on path coordinates would fail every time somebody
 * improved one. What the tests check is that the paths exist, parse as the
 * shape of path data, and reach both consumers.
 */

const ALL: EffectKind[] = [...PIP_ORDER];

describe('STATUS-ICONS: the vocabulary is total', () => {
  it('every drawable status has at least one glyph part', () => {
    for (const kind of ALL) {
      expect(statusGlyph(kind).length, `${kind} has no glyph`).toBeGreaterThan(0);
    }
  });

  it('and nothing outside PIP_ORDER carries one', () => {
    // The table is the whitelist too — an entry for a kind the row never draws
    // is a mark nobody will ever see, and a sign the two drifted.
    expect([...Object.keys(STATUS_GLYPHS)].sort()).toEqual([...ALL].sort());
  });

  it('a kind with no glyph draws nothing rather than a fallback square', () => {
    // A generic shape would be the colour pip again with extra steps: it looks
    // deliberate, so nobody notices the glyph is missing.
    expect(statusGlyph('teleport' as EffectKind)).toEqual([]);
  });

  it('every part is path data, not an asset reference', () => {
    // No external assets (ar-parity §4.2): the marks have to survive a build
    // with no network and no image pipeline.
    for (const kind of ALL) {
      for (const part of statusGlyph(kind)) {
        expect(part.d, `${kind}`).toMatch(/^[Mm]/);
        expect(part.d, `${kind} references a file`).not.toMatch(/url\(|http|\.svg|\.png/);
      }
    }
  });

  it('the owner\'s two named glyphs are the ones they named', () => {
    // "Might is a sword; Revealed is an eye." Weaken is the same sword broken —
    // three parts to Might's two, because the break is the third piece.
    expect(statusGlyph('might')).toHaveLength(2);
    expect(statusGlyph('weaken').length).toBeGreaterThan(statusGlyph('might').length);
    // The eye is an outline plus a filled pupil; the pupil is what makes it an
    // eye rather than a leaf.
    expect(statusGlyph('reveal').some((p) => p.fill === true)).toBe(true);
  });
});

describe('STATUS-ICONS: one source, two consumers', () => {
  it('glyphSvg emits a viewBox matching the glyph box', () => {
    expect(glyphSvg('might', '#ff6b4a')).toContain(`viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}"`);
  });

  it('and one <path> per part, in order', () => {
    const svg = glyphSvg('weaken', '#6b5fa8');
    const parts = statusGlyph('weaken');
    expect(svg.match(/<path /g)).toHaveLength(parts.length);
    for (const part of parts) expect(svg).toContain(part.d);
  });

  it('filled parts fill and stroked parts stroke, both in the status colour', () => {
    const svg = glyphSvg('reveal', '#ff7fbf');
    expect(svg).toContain('fill="#ff7fbf"');          // the pupil
    expect(svg).toContain('stroke="#ff7fbf"');        // the outline
    expect(svg).toContain('fill="none"');             // …which is not also filled
  });

  it('the HUD strip carries the same glyph the board does', () => {
    // The whole point of the shared table: a player who learns the sword over a
    // unit has learned the sword in the panel.
    const chip = statusChips([{ kind: 'might', remaining: 2 }])[0]!;
    expect(chip.glyph).toBe(glyphSvg('might', `#${PIP_COLORS['might']!.toString(16)}`));
  });

  it('is inert markup — no script, no event handlers', () => {
    for (const kind of ALL) {
      const svg = glyphSvg(kind, '#ffffff');
      expect(svg).not.toMatch(/<script|on[a-z]+=/i);
    }
  });
});

describe('STATUS-ICONS: the numeral on the glyph', () => {
  it('a timed status stamps its turns left', () => {
    expect(statusPips([{ kind: 'slow', remaining: 3 }])[0]!.numeral).toBe(3);
  });

  it('a shield stamps the absorption remaining, not its duration', () => {
    // "Twenty more damage of shield" and "two more turns of Slow" are the two
    // different questions, and the shield's answer is the pool.
    const pip = statusPips([{ kind: 'shield', remaining: 2, amount: 20 }])[0]!;
    expect(pip.numeral).toBe(20);
  });

  it('two shields stamp the summed pool', () => {
    const pip = statusPips([
      { kind: 'shield', remaining: 1, amount: 15 },
      { kind: 'shield', remaining: 3, amount: 20 },
    ])[0]!;
    expect(pip.numeral).toBe(35);
  });

  it('a status with the longest duration wins when a kind repeats', () => {
    const pip = statusPips([{ kind: 'might', remaining: 1 }, { kind: 'might', remaining: 4 }])[0]!;
    expect(pip.numeral).toBe(4);
  });

  it('playback stamps nothing — the event log carries no durations', () => {
    // Inventing a number here would be worse than leaving it off: a "1t" on a
    // status that actually has three turns left is a lie a player will plan on.
    expect(statusPips([{ kind: 'root' }])[0]!.numeral).toBeUndefined();
  });

  it('the icons still order by PIP_ORDER, numerals or not', () => {
    const pips = statusPips([{ kind: 'might', remaining: 1 }, { kind: 'root', remaining: 1 }]);
    expect(pips.map((p) => p.kind)).toEqual(['root', 'might']);
  });
});

describe('STATUS-ICONS: Stealth is drawn to its owner only', () => {
  it('the owning team sees the mask', () => {
    const mine = viewableStatuses([{ kind: 'stealth' as EffectKind, remaining: 2 }], true);
    expect(mine.map((s) => s.kind)).toEqual(['stealth']);
  });

  it('an enemy viewer does not', () => {
    // A Stealth marker an enemy can see is a contradiction: the icon would
    // announce "this one is trying to hide", which is the whole thing Stealth
    // is buying. Reachable — a stealthed unit can be visible after a reveal.
    const theirs = viewableStatuses([{ kind: 'stealth' as EffectKind, remaining: 2 }], false);
    expect(theirs).toEqual([]);
  });

  it('and everything else about a visible unit stays public', () => {
    // If you can see them, you can see that they are Rooted — the gate is a
    // named exception, not a general enemy blackout.
    const theirs = viewableStatuses(
      ([{ kind: 'root' }, { kind: 'stealth' }, { kind: 'might' }] as { kind: EffectKind }[]),
      false,
    );
    expect(theirs.map((s) => s.kind)).toEqual(['root', 'might']);
    expect([...OWNER_ONLY_PIPS]).toEqual(['stealth']);
  });

  it('the gate composes with the row builder in the order the client uses it', () => {
    const statuses = [{ kind: 'stealth' as EffectKind, remaining: 1 }, { kind: 'slow' as EffectKind, remaining: 2 }];
    expect(statusPips(viewableStatuses(statuses, false)).map((p) => p.kind)).toEqual(['slow']);
    expect(statusPips(viewableStatuses(statuses, true)).map((p) => p.kind)).toEqual(['slow', 'stealth']);
  });
});
