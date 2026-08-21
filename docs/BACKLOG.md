# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit** — and a **bug fix ships with the regression test in that
same commit.** **A genuinely new mechanic gets a generic, reusable implementation** (golden rule #2).
**DRIVE THE REAL UI WIRING IN TESTS** (`app-harness.ts` end-to-end, not the pure helper). **Open/update a
PR to `main` every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Deploy is set; QUOTA-RUNAWAY guards the quota. Keep green.

> 🎨 **Art / animation / VFX reference (owner Dev Note 2026-08-21).** Any item touching how a unit is
> drawn, rigged, animated, or how a hit is sold — read **`docs/ART_PIPELINE.md`** (pipeline, §7 build
> order, §8 role briefs) **and PR #100/#108/#109** first. **No engine change is required by that
> pipeline** — anything that looks like one is an `ENGINE ASK` for the owner. Clip selection is pure and
> lives in the renderer (`character-clips.ts`), never in `sampleFrame()` or the engine.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + AIM-PREVIEW-TRUE + DEATH-HANG.
- **PR #97–#105:** WARDING-WALL + `wall` shape + `perTile` traps + `triggers`; WALL-ROTATE; WALL-CAST-FIX;
  WALL-HIT-ONCE; TRAP-SHOVE-DEFAULT; BASTION-RAM-LINE + RAM-PREVIEW-REVERT; CD-BAND-*; DOWN-SEAT-SKIP;
  FRAG-SELF; the **TTK package** (HP band, tiered skill damage, Lumen heal, 2v2 turn limit, TTK-INVARIANT).
- **PR #106 (docs):** greenlit PLAYTEST; specced NET-E2E + the doc-debt items.
- **PR #107 (session 12):** **NET-E2E** (two real clients, one real room — death/reconnect/rotated-wall
  relay), **GAMESPEC-HP-UPDATE**, **ROSTER-CEILINGS-UPDATE**, **BOTPLAY** (a scripted opponent + 400
  matches of evidence).
- **PR #108–#110 (art + roster):** the character-art pipeline (Aegis spike → mesh → Mixamo rig → Phase 8
  client load + animate; `character-model.ts` lazy-loads `GLTFLoader`, `character-clips.ts` pure clip
  selection) and roster v1. **Engine untouched.**

Current suite: **2695 tests** (1410 + 983 + 302), typecheck clean, purity clean. Engine src unchanged for
two sessions.

### Build order and dependencies

**INTERCEPT-GUARD → SUDDEN-DEATH-TEST**, then, as capacity allows, **NET-E2E-EXPAND** and **BOTPLAY-SWEEP**.
INTERCEPT-GUARD is the one substantial feature (a new `guard` mechanic, one commit); SUDDEN-DEATH-TEST is a
small test-only lock on a ruling. No dependency between the two — do them in the listed order (size). The
human **PLAYTEST** runs in parallel (owner); its findings arrive as Dev Notes and re-prioritise this list.

---

## Engine + data + client — Aegis's thesis ability (the session's main work)

### INTERCEPT-GUARD. Intercept becomes the Bodyguard's redirect (ENGINE + DATA + CLIENT) — UNBLOCKED (first)
**Addresses Dev Note: "Make sure you see Aegis' intercept change and spec it for the builder."** The
Designer's redesign is complete and **RULED** (owner directive) — the authority is
**`docs/design/intercept-guard.md`** (numbers, the seven `guard` rulings, targeting, client, and the eight
required tests), plus the edge-cases entry and the 2026-08-17 DECISIONS note. **Read that doc; this item is
the build contract, it does not restate every ruling.** A genuinely new mechanic (a `guard` EFFECT_KIND,
first since DOT-HOT), so per golden rule #2 it gets a generic, reusable implementation. **Ships as ONE
engine+data+client commit** — nothing rides ahead (no data-only change is expressible without the engine).

*AC — data (`data/characters/aegis.json`, `intercept`):* `phase: "dash"`, `cooldown: 5`, `energyGain: 5`,
**`range: 5`**, **ally-targeted** (bound to an ally unit id, the `chaseTargetId` pattern on the ally side —
not a square that lands near an ally); effects become `teleport` + **`guard { duration: 1 }`** + `shield
{ amount: 18, duration: 1 }` **applied to Aegis only**; the old `impact` block and the ally-shield are
**removed**; description rewritten to the redirect.

*AC — engine (new `guard` EFFECT_KIND, beneficial polarity, caster id via the DOT-HOT `StatusInstance`
attribution):*
- **Redirects damage only** — statuses, knockback/pull, and Move-loss still land on the **ally**.
- **Enemy-dealt, guard-live damage only** — direct Blast hits and **enemy trap** damage the ally triggers
  in Dash/Move redirect; the ally's own `selfHarm`/`selfDamagePct` recoil and **end-of-turn DoT ticks** do
  **not**.
- **Amount = what would have reached the ally** — attacker's Might/Weaken **and the ally's cover** compose
  as if the hit landed on the ally, then that number applies to **Aegis's shields, then HP** (Aegis's own
  cover is not recomputed — he is not where the shot was aimed).
- **Duration = the rest of the cast turn** — applied in Dash, covers Blast + Move, expires end-of-turn.
- **Aegis dies mid-turn → the guard dies with him**; damage after his death lands on the ally normally. A
  redirected hit that kills Aegis credits the attacker's team (standard attribution).
- **Refresh-not-stack** — one guard per ally; a second application replaces the first (latest caster wins,
  deterministic by resolution order).
- **Simultaneity untouched** — redirection changes *where* damage applies, not *when*; guard is applied in
  Dash strictly before any Blast sub-step; PHASE-STATUS-FIRST and mutual-kill semantics stand.

*AC — targeting / landing:* landing is the **nearest open orthogonally-adjacent** square to the ally **at
Dash-phase start**, fixed-direction-order tiebreak; **all four blocked → fizzle, cooldown spent** (teleport
precedent). A guarded ally who dashes away **stays guarded** (bound to the unit). **1v1 fallback:** with no
living ally, Intercept targets a **square** within 5 → teleport + the 18 shield, no guard; with a living
ally, square-targeting an empty square is **invalid** (the fallback is a fallback, not a choice).

*AC — client:* aim = click an ally within 5; preview shows the landing square + a guard link (ally
highlighted, line to Aegis's landing); a `guard` status pip (shield-with-figure, blue) on the **ally**;
events **`guardApplied { casterId, allyId }`** and **`damageRedirected { from, to, amount }`**; playback
**shows the shot bending** to Aegis and the combat log prints it (drive the real wiring — a redirect that
does not visibly bend reads as a miss bug).

*AC — the eight tests the design owes (verbatim from `intercept-guard.md` §6):* (1) enemy Blast at the
ally's square → damage lands on Aegis (shield first), ally takes zero; (2) ally's cover reduces the
redirected amount, Aegis's own cover does not; (3) knockback at the ally still displaces the **ally**
(damage redirected, push not); (4) enemy trap the ally steps on in Move redirects, an end-of-turn DoT tick
on the ally does not, the ally's own recoil does not; (5) Aegis killed by the first redirected hit → the
second hit lands on the ally; (6) landing determinism — blocked adjacents pick in fixed order, all four
blocked → fizzle with cooldown spent; (7) 1v1 — no living ally → square fallback works, ally alive →
square-targeting an empty square is invalid; (8) mirror 4v4 — a second guard on the same ally replaces the
first.

**Spec Notes.** Files: `packages/engine/src/types.ts` (`EFFECT_KIND` + `guard` polarity; the redirect
plumbing), `packages/engine/src/resolve.ts` (apply `guard` in Dash; redirect in `runBlast` and in
`triggerTrapsOnEntry`'s damage path; the amount composition), `packages/engine/src/status.ts` (the
`guard` status + refresh), `data/characters/aegis.json`, and the client (aim/preview/pips/events/log).
**Gotchas:** the redirect must compose the ally's cover but not Aegis's (design §4.3) — get the amount from
the same path that would have applied to the ally, then reroute the *result*; the enemy-trap redirect means
`triggerTrapsOnEntry` needs to know a live guard exists on the victim; the DoT-tick exclusion means the
end-of-turn tick path must **not** consult the guard. **Out of scope:** multi-turn guards (v1 is one
turn); guarding against statuses/displacement (damage only); redirecting recoil (explicitly excluded);
Shadowstep/Bullrush's `impact` (they keep it — only Intercept leaves the `impact` list). **Playtest lever
is the shield (18 → 14), never the redirect** — the redirect is the identity.

---

## Engine test — lock the sudden-death ruling

### SUDDEN-DEATH-TEST. "The next kill wins" is enforced by a test (TEST) — UNBLOCKED
**Addresses Dev Note: "Rule on sudden death: The rule is that in Sudden Death, the next kill wins."** Ruled
in edge-cases (SUDDEN-DEATH); the behaviour **already ships** (`resolveOutcome`, `resolve.ts:2925` re-runs
the `turn >= turnLimit` check every turn, so the first kill differential wins). `formats.test.ts` proves
sudden death is *entered* but never that a kill *ends* it — lock that. *AC:* in `formats.test.ts`, from a
state past the turn limit with `suddenDeath` true and kills tied, (a) a turn producing a **kill
differential** → `status finished`, `winner` = the leader; (b) a turn that stays tied → still `active`,
`suddenDeath` still true, turn advances; (c) a simultaneous Double KO that carries **both** teams to
`killsToWin` from a tie → `draw` (the one surviving draw, per the Mutual-damage ruling); (d) a Double KO
**below** the target stays tied and continues. **Spec Notes.** Test-only — **no production change**; if any
assertion needs a production change to pass, the ruling and the code have diverged and that is a finding,
not a test edit. Extend `formats.test.ts`; reuse its `holdTurn`/`run` helpers. Out of scope: an artificial
turn cap or alternate tiebreak (the owner ruled unbounded, next kill wins).

---

## Secondary — as capacity allows, behind the two above

### NET-E2E-EXPAND. Two-seats-on-one-team and the rest of the networked surface (TEST) — UNBLOCKED
**Addresses Builder session-12 OQ #3.** NET-E2E covers death/reconnect/rotated-wall; the highest-value gap
is **two seats controlling one team** — the asymmetric 3-player 2v2 that PLAYTEST prioritises and the
least-exercised path in the whole game. *AC:* the two-client harness gains a match where one team is two
seats and the other is one seat running both characters; assert per-team order merging and identical
resolved state on all clients. **Then, if time:** the per-player timer expiring over the wire, a disconnect
during **playback** (not Decision), and a reconnecting seat's lobby→match handoff. **Spec Notes.** Extend
`packages/client/test/net-harness.ts`; injected clock only. Out of scope: the Durable-Object-level harness
(see DO-E2E, flagged) — this stays at the `RoomHub`/client seam.

### BOTPLAY-SWEEP. The bot harness sweeps pairings for balance outliers (TEST/TOOLING) — UNBLOCKED
**Addresses Builder session-12 OQ #6.** BOTPLAY is 48 matches, one map, two comps. *AC:* a sweep mode that
runs every character pairing (and optionally 4v4 / 1v1 / both maps) and reports **outliers** — TTK,
damage-per-turn, win-rate skew — as a summary, not a CI gate. **Spec Notes.** Keep the deterministic,
~1s-per-run discipline; the sweep is a **tool the Analyzer runs for evidence**, not a green/red gate (a bot
that does not focus-fire is not ground truth — see OQ #2). Out of scope: making balance decisions from it;
the human playtest is the primary validation. Lower priority than the two items above and than reacting to
PLAYTEST Dev Notes.

---

## 🎮 PLAYTEST — the active validation milestone (owner + humans; ongoing)

Greenlit last session and running. Two evidence streams now: **BOTPLAY** (400 deterministic matches, in
hand) and the **human playtest**. Prioritise the **asymmetric 3-player 2v2** (two seats vs. one player
running both — the least-exercised path). **The specific question BOTPLAY raised (session-12 OQ #2):**
76–87% of *bot* matches ended on the clock, not on kills — the thing TTK-TURN-LIMIT was meant to fix. That
is caveated hard (the bot does not focus-fire), so **ask humans the question directly: does a real 2v2 end
on kills or the clock?** Do **not** re-tune the turn limit off the bot number. Also watch, unchanged from
last session: the TTK burst goal (two ults no longer one-shot the squishiest), 20-turn pacing, Skim at 30
(fallback 26), Chain Hook 23 + pull 2, Lumen at heal 20, the wall's power (WALL-HIT-ONCE + ~7-tile reach
judged together), Ram Charge's reverted preview, DEATH-HANG, and the networked seams. **Output:** a
prioritised list of felt problems → Dev Notes → tuning items.

## Routed to Designer / flags

- **ASSET-WEIGHT-BUDGET (near-term, from `ART_PIPELINE.md` §8 Analyzer brief).** `GLTFLoader`+`SkeletonUtils`
  (~77 kB gz) are correctly **code-split** (dynamic import), so the main JS bundle is protected — confirm
  `scripts/bundle-budget.mjs` still passes as models land. **The `.glb` + texture total is NOT in that
  budget** and will grow per character; **spec a separate asset-weight cap** the day a second character's
  `.glb` is committed (only Aegis is spiked today, so not urgent). Track it as its own CI number.
- **DO-E2E (flagged, from session-12 OQ #4).** The Durable Object wrapper around `RoomHub` is only
  miniflare-smoke-tested; a DO-level networked harness is a distinct future item.
- **Warding Wall power (playtest); Kestrel Skim 30 / Chain Hook 23 (playtest); FRAG-SELF zoning nerf
  (playtest); WALL-BLINK-ONTO (owner confirmation); INTERCEPT-GUARD shield 18→14 lever (playtest); Aegis
  beam distinctness; self-lethal recoil warning; burn/regen pip glyphs; Warding Halo's dead `weaken`; trap
  count cap; inspect-panel chips hoverable; chase-preview detour; Solar Flare DoT ceiling; Thorn mine
  carpet** — unchanged flags.

## Flagged future (not scheduled)

- **The rest of the art / animation / VFX pipeline** (`docs/ART_PIPELINE.md`) — the remaining eight
  characters through generation → rig → clips; hitstop/flash/shake VFX; ASSET-WEIGHT-BUDGET pairs with it.
  Owner directs when.
- **M3-REMATCH, IDLE-KICK, LOBBY-TEAM-CHOICE** (room lifecycle). **All-seats-downed resolves on the timer**
  (needs the resolve-loop guard). **same-turn-buff preview**, **route-around-bodies dash impact preview** —
  unchanged.
