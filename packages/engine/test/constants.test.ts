import { describe, expect, it } from 'vitest';
import {
  DECISION_SECONDS,
  TIMEBANK_CHARGES,
  TIMEBANK_SECONDS,
} from '../src/constants.js';

/**
 * TIMER-40 — the decision timer, and the two Time Bank numbers beside it.
 *
 * A tuning constant is exactly the kind of value that gets nudged in passing and
 * noticed three playtests later, so the ones the owner has actually ruled on get
 * pinned. This is a *ratification* test, not a behaviour test: it says "someone
 * decided this", so changing it is a deliberate act with a failing test attached.
 */
describe('TIMER-40: the decision timer is the ruled 40 seconds', () => {
  it('gives a player 40 seconds to plan (ar-parity §7.4, was 30)', () => {
    expect(DECISION_SECONDS).toBe(40);
  });

  it('leaves the Time Bank exactly as it was — one charge, ten seconds', () => {
    // The ruling moved the base timer and explicitly nothing else; a Time Bank
    // that drifted alongside it would change the pressure curve the 40 was
    // chosen against.
    expect(TIMEBANK_CHARGES).toBe(1);
    expect(TIMEBANK_SECONDS).toBe(10);
  });
});
