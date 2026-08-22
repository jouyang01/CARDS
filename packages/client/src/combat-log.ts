/**
 * The combat log (UI6) — turn a resolved turn's `TurnEvent[]` into readable
 * lines naming **both ends** of each exchange.
 *
 * **Pure, and a pure consumer.** Same contract as `playback.ts`: this reads what
 * events state and never recomputes an outcome. It cannot say "that would have
 * killed them" or "that shot missed" — only what the log already carries.
 *
 * Statuses are logged at **both** ends (LOG-STATUS): `statusApplied` says a
 * debuff landed, `statusRemoved` says it broke or wore off. Only the first half
 * existed, so a Slow appeared to last forever and a Stealth that an attack broke
 * left no trace of breaking.
 *
 * Naming both ends is only possible because A0 put `sourceUnitId`/`abilityId` on
 * `damage` and A0-heal extended it to `heal` and `statusApplied`. Without those
 * a support's whole contribution reads as "Lumen gained 30 shield" — an effect
 * with no author.
 *
 * Entries are emitted in **log order and never re-sorted**: the log's order is
 * the engine's own resolution order, and re-sorting it (by team, by unit, by
 * magnitude) would quietly invent a causality the turn did not have.
 */

import type { TurnEvent, Vec2 } from '@cards/engine';

/** How an entry reads, so the panel can colour it without parsing text. */
export type LogTone = 'damage' | 'heal' | 'shield' | 'status' | 'death' | 'respawn' | 'neutral';

export interface LogEntry {
  /** Turn number, so the panel can group and separate. */
  turn: number;
  tone: LogTone;
  text: string;
  /** Who caused it, where the event names a source. */
  sourceUnitId?: string;
  /** Who it happened to. */
  unitId?: string;
}

/** Display names by unitId. Anything missing falls back to the raw id. */
export type NameLookup = (unitId: string) => string;

/** Ability display names by id, for the same reason. */
export type AbilityLookup = (abilityId: string) => string;

export interface LogNames {
  unit: NameLookup;
  ability: AbilityLookup;
}

/** Statuses worth a line of their own. The rest are animation cues, not news. */
const NOTABLE_STATUSES = new Set(['slow', 'root', 'weaken', 'might', 'haste', 'energized', 'unstoppable', 'untargetable', 'stealth']);

/**
 * Build the log lines for ONE resolved turn. `turn` is the turn the events
 * belong to; the caller accumulates across turns and inserts separators.
 */
export function logEntriesForTurn(turn: number, events: readonly TurnEvent[], names: LogNames): LogEntry[] {
  const out: LogEntry[] = [];
  const who = (id: string): string => names.unit(id);
  const via = (abilityId: string): string => names.ability(abilityId);
  const at = (p: Vec2): string => `(${p.x},${p.y})`;

  for (const e of events) {
    switch (e.type) {
      case 'damage': {
        // The absorbed portion is stated separately: a shield that ate 18 of 26
        // is the most interesting thing that happened, and the log carries it.
        const absorbed = e.absorbed > 0 ? ` (${e.absorbed} absorbed)` : '';
        out.push({
          turn, tone: 'damage', sourceUnitId: e.sourceUnitId, unitId: e.unitId,
          text: `${who(e.sourceUnitId)} hit ${who(e.unitId)} for ${e.amount}${absorbed} — ${via(e.abilityId)}`,
        });
        break;
      }
      case 'heal': {
        // Self-heals read as "X healed themselves", not "X healed X".
        const self = e.sourceUnitId === e.unitId;
        out.push({
          turn, tone: 'heal', sourceUnitId: e.sourceUnitId, unitId: e.unitId,
          text: self
            ? `${who(e.unitId)} healed for ${e.amount} — ${via(e.abilityId)}`
            : `${who(e.sourceUnitId)} healed ${who(e.unitId)} for ${e.amount} — ${via(e.abilityId)}`,
        });
        break;
      }
      case 'statusApplied': {
        if (e.status === 'shield') {
          const self = e.sourceUnitId === e.unitId;
          out.push({
            turn, tone: 'shield', sourceUnitId: e.sourceUnitId, unitId: e.unitId,
            text: self
              ? `${who(e.unitId)} shielded for ${e.amount ?? 0} — ${via(e.abilityId)}`
              : `${who(e.sourceUnitId)} shielded ${who(e.unitId)} for ${e.amount ?? 0} — ${via(e.abilityId)}`,
          });
          break;
        }
        // `reveal` fires on every attacker every turn they hit — it would drown
        // the log, and the damage line above already says they attacked.
        if (!NOTABLE_STATUSES.has(e.status)) break;
        out.push({
          turn, tone: 'status', sourceUnitId: e.sourceUnitId, unitId: e.unitId,
          text: `${who(e.unitId)} is ${e.status} for ${e.duration}t — ${via(e.abilityId)}`,
        });
        break;
      }
      case 'statusRemoved': {
        // LOG-STATUS. The other half of `statusApplied`: a buff that quietly
        // stops applying is exactly the thing a player loses track of between
        // turns, and "why did that only do 40?" has no answer anywhere else.
        //
        // Filtered by the same `NOTABLE_STATUSES` set, so the two halves cannot
        // disagree — logging the end of something whose start was suppressed
        // (Reveal expiring every single turn) would read as noise from nowhere.
        // Shields are notable on the way in but not on the way out: the pool is
        // already tracked on the HP bar, and an expiry line for every shield
        // would double every support's footprint in the log.
        if (!NOTABLE_STATUSES.has(e.status)) break;
        out.push({
          turn, tone: 'status', unitId: e.unitId,
          // Broken and expired are genuinely different events — one was done to
          // you mid-turn, the other is a clock running out — and a player
          // reading back a turn needs to tell them apart.
          text: e.reason === 'broken'
            ? `${who(e.unitId)}'s ${e.status} broke`
            : `${who(e.unitId)}'s ${e.status} wore off`,
        });
        break;
      }
      case 'death':
        out.push({ turn, tone: 'death', unitId: e.unitId, text: `${who(e.unitId)} was killed` });
        break;
      case 'respawn':
        out.push({ turn, tone: 'respawn', unitId: e.unitId, text: `${who(e.unitId)} respawned at ${at(e.pos)}` });
        break;
      // INTERCEPT-GUARD: the two lines the redirect owes the reader. Without
      // them a bodyguarded turn reads as an attack that missed and a teammate
      // who lost HP for no reason — the mechanic is invisible in the one place
      // players go to find out what happened.
      case 'guardApplied':
        out.push({
          turn, tone: 'status', unitId: e.casterId,
          text: `${who(e.casterId)} is guarding ${who(e.allyId)}`,
        });
        break;
      case 'damageRedirected':
        out.push({
          turn, tone: 'status', unitId: e.to,
          text: `${who(e.to)} took ${e.amount} for ${who(e.from)}`,
        });
        break;
      case 'trapTriggered':
        out.push({ turn, tone: 'status', unitId: e.unitId, text: `${who(e.unitId)} triggered a trap` });
        break;
      case 'trapExpired':
        // Worth a line: a trap you laid and forgot about running out is a plan
        // that quietly stopped being true, and nothing else on screen says so.
        out.push({ turn, tone: 'neutral', text: `A trap at ${at(e.pos)} expired` });
        break;
      case 'chaseResolved':
        // Worth a line precisely when `seen` is false: the chase went to a
        // remembered square rather than to the target, and the reason the unit
        // stopped where it did is otherwise invisible.
        out.push({
          turn, tone: 'neutral', unitId: e.unitId,
          text: e.seen
            ? `${who(e.unitId)} chased ${who(e.targetUnitId)}`
            : `${who(e.unitId)} chased ${who(e.targetUnitId)} to their last known position ${at(e.to)}`,
        });
        break;
      case 'powerupTaken':
        // The heal/buff it granted already logged itself on the line above; this
        // one says *why*, which is the part a player wants to contest next turn.
        out.push({ turn, tone: 'status', unitId: e.unitId, text: `${who(e.unitId)} took the ${e.powerup} power-up at ${at(e.pos)}` });
        break;
      case 'gameEnd':
        out.push({
          turn, tone: 'neutral',
          text: e.result === 'draw' ? 'Double KO — the match is a draw.' : `Team ${(e.winner ?? 0) + 1} wins the match.`,
        });
        break;
      default:
        // phaseStart / abilityFired / moveStep / displaced / energy / decoys /
        // trapPlaced: movement and bookkeeping, not news the log is asked for.
        break;
    }
  }
  return out;
}

export interface CombatLog {
  /** Append one resolved turn's entries under a turn separator. */
  appendTurn(turn: number, events: readonly TurnEvent[], names: LogNames): void;
  /** Entries so far, oldest first — the accumulated record. */
  entries(): readonly LogEntry[];
}

/**
 * How many lines the panel keeps. Well past a whole match — a 20-turn 4v4
 * produces a couple of hundred — so nothing a player could scroll back to is
 * ever dropped. The cap exists because "accumulates across turns" is otherwise
 * unbounded: a long session grows the DOM forever, and an oldest-first trim is
 * the cheap fix. It is a backstop, not a feature.
 */
export const MAX_LOG_LINES = 600;

/**
 * The scrollable panel. It accumulates across turns and **auto-scrolls only
 * when the reader is already at the bottom** — scrolling back to read turn 2
 * should not be yanked away the moment turn 7 resolves.
 */
export function createCombatLog(root: HTMLElement): CombatLog {
  root.replaceChildren();
  root.classList.add('log');
  const list = document.createElement('div');
  list.className = 'log-list';
  root.appendChild(list);

  const all: LogEntry[] = [];

  /**
   * Drop the oldest lines past the cap. A separator whose entries have all been
   * trimmed goes with them, so the panel never shows a "Turn 3" heading with
   * nothing under it.
   */
  const trim = (): void => {
    while (list.childElementCount > MAX_LOG_LINES) {
      const oldest = list.firstElementChild;
      if (oldest === null) break;
      oldest.remove();
    }
    while (list.firstElementChild?.classList.contains('log-turn') === true
      && list.children[1]?.classList.contains('log-turn') === true) {
      list.firstElementChild.remove(); // an emptied separator
    }
    if (all.length > MAX_LOG_LINES) all.splice(0, all.length - MAX_LOG_LINES);
  };

  return {
    appendTurn(turn, events, names) {
      const fresh = logEntriesForTurn(turn, events, names);
      if (fresh.length === 0) return;
      // "Already at the bottom" has to be sampled BEFORE appending, or the new
      // content has already moved the goalposts.
      const pinned = root.scrollHeight - root.scrollTop - root.clientHeight < 24;

      const separator = document.createElement('div');
      separator.className = 'log-turn';
      separator.textContent = `Turn ${turn}`;
      list.appendChild(separator);
      for (const entry of fresh) {
        const line = document.createElement('div');
        line.className = `log-line ${entry.tone}`;
        line.textContent = entry.text;
        list.appendChild(line);
      }
      all.push(...fresh);
      trim();
      if (pinned) root.scrollTop = root.scrollHeight;
    },
    entries: () => all,
  };
}
