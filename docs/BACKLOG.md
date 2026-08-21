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

> 🎨 **Art / animation / VFX reference (owner Dev Note 2026-08-21 #1).** Any item touching how a unit is
> drawn, rigged, animated, or how a hit is sold — read **`docs/ART_PIPELINE.md`** (the pipeline, the §7
> build order, and the §8 role briefs for Builder/Analyzer/Designer) **and PR #100** (which added it)
> first. **No engine change is required by that pipeline** — projectile timing derives from the existing
> `ability`→`impact` cue gap; anything that looks like an engine need is an `ENGINE ASK` for the owner, not
> a commit. The pipeline is not being built this session (playtest first), but the reference is live now so
> nobody specs or builds art work without it.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batches 1–3 +
  AIM-PREVIEW-TRUE + DEATH-HANG.
- **PR #97–#100:** WARDING-WALL + `wall` shape + `perTile` traps + per-trap `triggers`; BASTION-RAM-LINE;
  CD-BAND-DASH/BLAST/INVARIANT; DOWN-SEAT-SKIP; TRAP-SHOVE-DEFAULT; WALL-ROTATE; the character-art-pipeline
  doc (`docs/ART_PIPELINE.md`).
- **PR #103 (session 10):** WALL-CAST-FIX (the wall casts; `app-harness.ts` records `show()`),
  RAM-LINE-PREVIEW-FIX (superseded — see PR #105), FRAG-SELF (`selfHarm` opt-out from CASTER-SAFE).
- **PR #104 (docs):** review of PR #102/#103; the WALL-HIT-ONCE and RAM-PREVIEW-REVERT specs; TTK approved.
- **PR #105 (session 11):** **RAM-PREVIEW-REVERT** (the charge draws no lane outline; the `chargeHits`
  number-correctness fix kept), **WALL-HIT-ONCE** (a wall bills one unit once and stays a multi-target
  barrier — ruled in edge-cases, verified N-safe), and the **TTK package** — HP band (median 100→130),
  tiered 1.25× skill damage (eleven values), Lumen's Mending Light 25→20, 2v2 turn limit 16→20, and
  **TTK-INVARIANT** enforcing the HP ladder + damage tiers in `content.test.ts`.

Current suite: **2644 tests** (1366 + 976 + 302), typecheck clean, purity clean.

### Where the project is

**Path A's entire pre-playtest program is done and verified.** The two client bugs, the two ability fixes,
and the TTK tuning are all shipped; the game is deployed and, by the suite, correct. The owner has
greenlit playtesting (Dev Note #2). So this session's spec is **not** a stack of engine items — it is the
**PLAYTEST milestone** (owner-run, with the checklist below) plus a small **Builder batch that de-risks and
supports a live networked playtest**: NET-E2E first, then two doc-debt cleanups. Order:
**NET-E2E → GAMESPEC-HP-UPDATE → ROSTER-CEILINGS-UPDATE**, running alongside the owner's playtest.

---

## 🎮 PLAYTEST — the active milestone (owner + humans; GO per Dev Note 2026-08-21 #2)

**Addresses Dev Note: "We should start playtesting."** Nothing in the Builder backlog blocks it (Builder
session-11 OQ #8). A real **two-machine internet playtest** of the live deploy — prioritise the
**asymmetric 3-player 2v2** (a two-player team vs. one player running both characters), the least-exercised
path. Not a Builder code item; the Builder's job is to fix what it surfaces and to ship NET-E2E alongside.

**What to watch — the questions this build was tuned to answer:**
- **The TTK goal (the whole point):** does one caught-in-the-open turn leave the victim a *decision*
  rather than an instant death? Two ults on the squishiest now take 85% of a bar (was 100% — a kill from
  full). Confirm burst no longer one-shots.
- **Match length:** a 20-turn 2v2 should pace to ~19.7 turns for 4 kills. Does it end on **kills**, not the
  **clock**? Does 20 turns *drag*?
- **Skim at 30** — the only ability at the 1.25 ceiling and **86% of Kestrel's ultimate** on a 4-turn
  cooldown. Does it crowd her ult? **Fallback 26** is pre-agreed if it plays badly.
- **Chain Hook at 23 + pull 2** — the roster's only pull ≥ 2, now a real threat (AR-normal per Rampart's
  Fusion Lance, but a big change in what the ability is).
- **Lumen at heal 20** — a healer comp should now be beatable (~12.5 turns/kill, was outlasting the match).
- **Warding Wall — judge power as ONE question (Builder OQ #3):** WALL-HIT-ONCE (a unit is hit once, so
  walking its length is 25 not 75) **and** WALL-REACH (~7 tiles from Aegis after WALL-ROTATE) together. Is
  the wall now too weak, or does the reach carry it? Either lever moves alone if needed.
- **Ram Charge** — the preview is back to route + landing marker, **no lane outline**. Does it read fine?
- **DEATH-HANG** — a mid-match death must stay playable for **both** sides (the M3 bug that started Path A).
- **Cooldown-band tempo** (dashes 4–5, non-basic blasts 3–4) and the shove-into-trap play (TRAP-SHOVE).
- **Networked seams** — reconnect/handoff, the per-player timer, and a **rotated-wall order relayed**
  between two clients (still verified only by reading the protocol — the reason NET-E2E is next).

**Output:** a short, prioritised list of felt problems → a tuning pass, mostly data (numbers). File it as
Dev Notes; the Analyzer routes it into backlog items.

---

## Builder batch — de-risk and support the networked playtest

### NET-E2E. Automated two-client coverage of the networked loop (SERVER + CLIENT) — UNBLOCKED (first)
**Why now:** the networked relay is the one seam pure-function tests never touch, and it is exactly what a
live networked playtest exercises. DEATH-HANG was such a bug (a downed seat froze the client); session-9
OQ #4 (a rotated-wall order surviving the relay) and session-11 remain "verified by reading the protocol,
not a two-client test." A playtest that hits a relay bug with no regression net is how a fixed bug returns.
*AC:*
- **A test drives two `app-harness.ts` controllers through one match over a loopback/fake transport**
  (or the real Durable Object in a test worker — Builder's call on the seam): lobby → both seats submit →
  resolve → next turn, asserting both clients reach the **same** resolved state each turn.
- **The three scenarios that have bitten or are unverified:** (1) a unit **dies/downs** mid-match and the
  next turn is playable for both the downed seat and its opponent (DEATH-HANG, networked); (2) a
  **reconnect/handoff** mid-match resumes correctly; (3) a **rotated Warding Wall** order (`aimStep` on the
  wire) relays and resolves identically on the receiving client (closes session-9 OQ #4 for real).
- **Deterministic and CI-safe** — no wall-clock waits; drive the injected clock, as the existing timer
  tests do.

**Spec Notes.** Files: `packages/server/test/` and/or `packages/client/test/` (a new two-controller
harness), likely a small shared test seam over the existing net protocol. **Reuse the injected clock and
`app-harness.ts`** — do not add real timers or real sockets. This is the "flagged for four sessions" item;
scope it to the three scenarios above, not to every networked edge — breadth can grow once the harness
exists. Out of scope: new networked *features* (rematch, idle-kick — still flagged-future); changing the
protocol. **Watch:** keep the two-client harness off the 300 kB JS bundle-budget path (it is test-only).

### GAMESPEC-HP-UPDATE. GAME_SPEC's HP baseline reflects the TTK band (DOCS) — UNBLOCKED
**Addresses Builder session-11 OQ #7.** `GAME_SPEC.md` still describes `maxHp` as "baseline ~100"; after
TTK-HP-BAND the median is **130** and the band runs **100–175**. *AC:* the HP reference in `GAME_SPEC.md`
(the Builder cited ~line 119) reads the new band (median 130, range 100–175, archetype ladder
firepower < support < frontline); no other rule text changes. **Spec Notes.** One factual correction in the
ruleset doc — the number, not the mechanic. Trivial; grouped here so it is not forgotten. Out of scope:
re-deriving TTK (done — see `docs/reviews/2026-09-27.md`); the format table (already updated by
TTK-TURN-LIMIT).

### ROSTER-CEILINGS-UPDATE. `roster-v1.md` §4's balance ceilings reflect the TTK numbers (DOCS → Designer) — UNBLOCKED
**Addresses Builder session-11 OQ #6 (Designer-owned).** Four §4 ceilings went stale when TTK landed:
undelayed skill cap **24→30** (Kestrel's Skim), nuke ceiling **34→33**, sustain ceiling **25→20** (Lumen),
and "time-to-kill 4–5 connected hits on a 100 HP target" → **~5.9 on bars of 100–175**. §1's kit table
should also gain the HP ladder and the damage-tier rule, which it has never carried. *AC:* the four numbers
and the two structural rules in `roster-v1.md` match the shipped values. **Spec Notes.** Designer-owned
doc; if the Builder touches it, keep it to the numbers. **Not a blocker** — TTK-INVARIANT enforces the live
values in `content.test.ts` meanwhile. Evidence: `docs/reviews/2026-09-27.md`.

---

## Routed to Designer / flags

- **ASSET-WEIGHT-BUDGET (flagged, from `docs/ART_PIPELINE.md` §8 Analyzer brief).** The 300 kB gz JS cap
  (`scripts/bundle-budget.mjs`) does **not** cover `.glb` meshes + textures, and the art pipeline will grow
  that weight unwatched. The pipeline's own Analyzer brief names "recommend a budget for it" as a good
  first backlog item. **Spec when art work is scheduled:** track total asset bytes as a separate CI number
  with a cap, and flag `GLTFLoader`'s addition to the JS bundle when it lands. Not scheduled this session
  (playtest first); registered so it is ready when the pipeline starts.
- **Warding Wall power (Builder OQ #3, playtest).** WALL-HIT-ONCE (one hit per unit) + WALL-REACH (~7-tile
  reach after WALL-ROTATE) are **one** question — judge them together in the playtest, move one lever if
  needed. Ruled in edge-cases (WALL-HIT-ONCE, WALL-ROTATE).
- **Kestrel's Skim at 30 / Bastion's Chain Hook at 23 (playtest flags).** Skim is the sole 1.25-ceiling
  ability at 86% of her ult — **fallback 26**. Chain Hook more than doubled on the roster's only pull ≥ 2.
- **FRAG-SELF zoning nerf (session-10 OQ #4, playtest).** Frag Grenade now catches its own thrower; the
  next `selfHarm` ability with a status rider will apply that status to its own caster (edge-cases, ruled).
- **WALL-BLINK-ONTO (owner confirmation).** Every mine bites a blink that lands on it; the wall still does
  not (its authored *"a blink goes around it"*). One array entry aligns them if the owner wants it.
- **Aegis beam distinctness; self-lethal recoil warning; burn/regen pip glyphs; Warding Halo's dead
  `weaken`; trap count cap; inspect-panel chips hoverable; chase-preview detour; Solar Flare DoT ceiling;
  Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **The art / animation / VFX pipeline** (`docs/ART_PIPELINE.md`) — hitstop/flash/shake first (no assets),
  then generation → Mixamo rig → asset build → renderer integration → weapons/VFX. **No engine change**;
  spike **Aegis** (frontline, melee `shield_bash`). ASSET-WEIGHT-BUDGET pairs with it. Owner directs when.
- **M3-REMATCH, IDLE-KICK, LOBBY-TEAM-CHOICE** (room lifecycle — the natural follow to NET-E2E).
  **All-seats-downed resolves on the timer** (session-8 OQ #4 — rare, safe; needs the resolve-loop guard).
  **same-turn-buff preview**, **route-around-bodies dash impact preview** — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- Folded into **PLAYTEST** above: the TTK goal (burst no longer one-shots), match length at 20 turns,
  Skim/Chain Hook/Lumen numbers, the wall's power, Ram Charge's reverted preview, the cooldown-band feel,
  DEATH-HANG, and the networked seams NET-E2E covers.
