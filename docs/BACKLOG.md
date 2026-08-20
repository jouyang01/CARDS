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
**DRIVE THE REAL UI WIRING IN TESTS** (see the ⚠⚠ box). **Open/update a PR to `main` every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Deploy is set; QUOTA-RUNAWAY guards the quota. Keep green.

> ⚠️⚠️ **The bug class that keeps shipping green: "pure function passes, real UI broken."** WALL-CAST-FIX
> (top of this backlog) is the newest instance: WALL-ROTATE's engine + preview are correct and fully
> tested, yet the ability **cannot be cast**, because the ONE untested seam — the client building and
> submitting the order (`toUnitOrders` → lock-in → resolve) — drops the wall's rotation. **No client test
> drives select → click → lock-in → resolve for `warding_wall`.** Every fix below ships a test that drives
> **`app-harness.ts` end-to-end**, not the pure helper. If a test would still pass with the order-build
> unwired, it is the wrong test.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batches 1–3 +
  AIM-PREVIEW-TRUE + DEATH-HANG.
- **PR #97:** WARDING-WALL (a new `wall` shape + `perTile` trap placement + a per-trap `triggers` list),
  BASTION-RAM-LINE (`chargeHits:"all"` + a landing marker), CD-BAND-DASH/BLAST/INVARIANT, DOWN-SEAT-SKIP.
- **PR #98 (docs):** the TRAP-TRIGGER ruling.
- **PR #99 (Builder session 9):** **TRAP-SHOVE-DEFAULT** (`DEFAULT_TRAP_ENTRIES` = all four; an ordinary
  mine now fires on a knock-through, the guard flipped, blink-past still inert — verified against
  TRAP-TRIGGER) and **WALL-ROTATE** (the wall aim now carries anchor **+** rotation; anchored-at-click,
  runs along the chosen cardinal; a four-button rotate row; ruled in edge-cases — WALL-ROTATE). *(WALL-ROTATE
  is correct in the engine and preview but exposed a client order-build bug — see WALL-CAST-FIX.)*
- **PR #100:** a character-art-pipeline doc (generation → Mixamo → weapons → VFX). Docs only.

Current suite: **2610 tests** (1347 + 961 + 302), typecheck clean, purity clean.

### Build order and dependencies

**WALL-CAST-FIX → RAM-LINE-PREVIEW-FIX → the five TTK items → PLAYTEST → NET-E2E.** Both bug fixes are
first and **blocking**: they gate the playtest — a playtest of Warding Wall and Ram Charge is worthless
while one cannot be cast and the other cannot be read. No dependency between them; do them in the listed
order (severity).

**The TTK package (owner directive 2026-09-27) sits between the fixes and the playtest.** It is Path A's
tuning pass arriving early — from measurement rather than from felt play — and the argument for putting it
*before* PLAYTEST is that a playtest of numbers we already intend to change spends the scarcest resource
in the project on values that will not ship. **This ordering is the owner's call** (review §5 / OQ 1); if
the preference is to playtest current numbers first, the five items move behind PLAYTEST with their specs
unchanged. **The five must land as one change** — HP alone makes a healer comp outlast the match, and HP
without the turn limit ends every 2v2 on the clock.

---

## Client bugs — the two abilities that don't work for a human (do first; they gate the playtest)

### WALL-CAST-FIX. Warding Wall cannot be cast — the client drops the rotation from the order (CLIENT, HIGH) — UNBLOCKED (first)
**Addresses Dev Note: "Aegis's Warding Wall does not cast successfully."** **Root cause found.** WALL-ROTATE
(PR #99) made a wall's aim require **both** an anchor square and a rotation step — the engine's `aimIsLegal`
for `'wall'` ends `... && isAimStep(aimStep)` (`resolve.ts`), so a wall order **with no step is refused**.
The client computes the rotation into `draft.aimStep` (`aimFor` `'wall'`) and shows the rotate row
(`isPlacedRotatable`), **but `toUnitOrders` only copies `aimStep` into the order when `isRotatable(ability)`
is true**, and `isRotatable` is `line || cone` only (`targeting.ts:176`, used at `:995`). A wall is
`isPlacedRotatable`, **not** `isRotatable`, so the rotation is **dropped at order-build**, the engine gets a
stepless wall, and refuses it → the wall never casts. The preview reads `aimFor` directly, so it draws
correctly and hides the bug.

*AC:*
- **A failing test, added first, driving the REAL controller end-to-end** (`app-harness.ts`): select
  Warding Wall the way the UI does, click a target square, (optionally pick a rotation), **Lock In**, and
  **resolve** — assert a 4-tile wall of traps is in the resolved state, anchored at the clicked tile,
  running in the selected (or default) direction. This must **fail on `main`** (the order has no `aimStep`,
  the engine refuses it, no wall appears) and pass after the fix.
- **The fix carries the step for a placed-rotatable shape.** In `toUnitOrders` (`targeting.ts:995`), gate
  the `aimStep` write on `isRotatable(ability) || isPlacedRotatable(ability)` (or simply on
  `isAimStep(draft.aimStep)` — the engine ignores a step on shapes that don't read one). A wall's chosen
  rotation reaches the engine.
- **A defaulted wall still casts:** a player who never touches the rotate row commits with `aimFor`'s
  default (`WALL_ROTATIONS[0]`), so the order carries that step and the wall lands.
- **The selected rotation is the one that lands:** picking a different arrow and committing produces a wall
  running that way (assert against the resolved trap tiles).

**Spec Notes.** Files: `packages/client/src/targeting.ts` (the `toUnitOrders` gate), tests in
`packages/client/test/` driving `app-harness.ts` through **lock-in and resolve** (not preview). **No engine
change** — the engine is correct; the client drops the field. Keep the existing preview tests green. The
real lesson to bank: `warding_wall` had 24 engine + a preview test and still could not be cast, because the
order-build seam had no coverage — this fix closes that seam for the wall for good. Out of scope: the wall's
geometry/mechanics (correct per WALL-ROTATE); other abilities.

### RAM-LINE-PREVIEW-FIX. Ram Charge does not preview as a line attack (CLIENT) — UNBLOCKED (after WALL-CAST-FIX)
**Addresses Dev Note: "Bastion's Ram Charge is still not a linear dash/attack preview."** The **engine is
correct** (`bastion.ram_charge` has `chargeHits:"all"`; `walkCharge` damages every enemy the path crosses).
The preview draws the route tiles (`covered`, `app.ts`) and the landing marker (the BASTION-RAM-LINE
addition), **but nothing marks the crossed ENEMIES as hit and no damage number shows along the line** —
`ram_charge` has no `impact` field, so `impactPreview`'s discs are empty, and there is **no client mirror of
`walkCharge`/`chargeHits`.** A real `line` attack lights its whole tile run (`lineSquares`) and
`previewNumbers` stamps every enemy on it; a `path` charge never reaches that path, so it reads as a
movement route, not an attack.

*AC:*
- **The preview reads as a line attack:** every enemy the charge path crosses is marked with its **15**
  damage (the same tell a `line`/blast attack shows — reuse that path, do not invent a second), **plus** the
  existing landing marker. A `chargeHits:"all"` dash previews **all** crossed enemies, not just the first.
- **A test driving the REAL preview** (`app-harness.ts`): with enemies along Bastion's charge line, aim Ram
  Charge and assert the preview reports **every** crossed enemy hit for 15 (and the landing marker present).
  Property-style (PREVIEW-NUMBERS-AUDIT): the previewed hit set == the set the engine's `chargeHits:"all"`
  resolution damages, for the roster.
- **A non-`chargeHits:"all"` dash is unchanged** (a first-enemy-only or teleport dash previews as before).

**Spec Notes.** Files: `packages/client/src/targeting.ts` (compute the crossed-enemy hit set for a
`chargeHits:"all"` path the way `walkCharge` does — **read the engine's derivation, don't recompute a
parallel one**), `packages/client/src/app.ts` (draw the damage tell on the crossed enemies, same layer a
line attack uses). Preview-only — the engine already hits everyone. Ties off session-7 OQ #3 for real. Out
of scope: the `chargeHits` engine mechanic (correct); Ram Charge's numbers/cooldown (correct); other dashes.

---

## Data — the TTK package (owner directive 2026-09-27; Path A's tuning pass, arriving early)

> **Owner directive, verbatim:** *"The package — 1. HP to the table above — raises TTK to AR parity and
> fixes the ult burst. 2. Skill damage to 1.25x basic, single target skills should do more than aoe
> skills. Skills that debuff should do less damage than skills that do not. 3. `TURN_LIMIT` 2v2: 16 → 20
> — mandatory, or matches decide on the clock. 4. Lumen's Mending Light 25 → 20 — mandatory, or a healer
> comp outlives the match."* Stated goal: *"I want to make sure time to kill is similar so that one error
> doesn't cause an instant death."*
>
> Evidence, the Atlas Reactor measurements, and the reasoning for every number:
> **`docs/reviews/2026-09-27.md`**. **The integers below are final — implement them, do not re-derive
> them.**

**Five items, in order: TTK-HP-BAND → TTK-SKILL-DAMAGE → TTK-LUMEN-HEAL → TTK-TURN-LIMIT →
TTK-INVARIANT.** Four are data/config one-liners; the fifth is the test. **They are one change and must
land together** — HP alone makes the healer grind outlast the match, and HP without the turn limit ends
every 2v2 on the clock. Do not ship a partial package.

**Out of scope for the whole batch, stated so nobody adds a "helpful" pass:** ultimate damage (the HP
raise replaces the ult cap the 2026-09-23 review proposed — see review §2.1); `energyGain`, `ULT_COST`,
`PASSIVE_ENERGY` (review §3.3); every shield value and every catalyst (they land in AR's band by
themselves once the bars grow); `KILLS_TO_WIN`; all cooldowns, including Mending Light's — **only its
amount changes**, so "Prep cooldowns are correct right now" still holds; traps; Aegis's kit (he has no
direct-damage skill since PR #97 and session-8 OQ #5 closed that as intended).

### TTK-HP-BAND. HP rises ~30% and the archetype ladder is restored (DATA) — UNBLOCKED
**Addresses owner directive #1.** Today's bars run 85–135 (median 100), so a basic takes **22.0%** of a
health bar against Atlas Reactor's **17.3%**, and an ultimate takes **38%** against AR's **23%** — which
is why **two ults deal exactly 85 to Wisp's 85 HP and kill from full**. Supports sit only 11% above
firepower where AR put them 33% above. *AC: the nine `maxHp` values become —* `wisp` **85→100**,
`kestrel` **90→105**, `cinder` **95→110**, `vex` **95→110**, `thorn` **100→130**, `lumen` **105→140**,
`aegis` **120→155**, `bastion` **130→170**, `ravok` **135→175**; *no other field in any character file
changes; both suites stay green.* **Spec Notes.** Nine one-field edits in `data/characters/*.json`.
Lands median HP 130 (basic bite 16.9% vs AR's 17.3%, TTK 5.9 hits vs AR's 5.8), archetype ratio
1 : 1.26 : 1.58 (AR 1 : 1.33 : 1.65), and the double-ult at 85% of the squishiest bar against AR's 83%.
**This is why no ultimate is being nerfed** — do not also cut ult damage. Out of scope: everything in the
batch-level list above.

### TTK-SKILL-DAMAGE. Skill damage rises to a tiered 1.25× ceiling (DATA) — UNBLOCKED (after HP)
**Addresses owner directive #2.** Skills currently deal **0.64×** their character's basic (AR: 0.96×), so
damage is barbelled into the free basic and the ultimate with nothing in between — the basic is the
damage-max pick on every single turn for seven of nine characters. *AC: the eleven damaging non-basic,
non-ult abilities carry exactly these `damage` amounts —*

| Character | Ability | Now | **New** |
|---|---|---|---|
| Kestrel | `skim` | 12 | **30** |
| Vex | `frag_grenade` | 34 | **33** |
| Kestrel | `kite_shot` | 16 | **26** |
| Wisp | `bola` | 12 | **24** |
| Bastion | `ram_charge` | 15 | **23** |
| Bastion | `chain_hook` | 10 | **23** |
| Ravok | `shockwave` | 12 | **19** |
| Thorn | `bramble_stride` | 10 | **17** |
| Ravok | `bullrush` | 14 | **17** |
| Lumen | `dazzling_ray` | 12 | **15** |
| Cinder | `flare_burst` | 10 | **12** |

*— and nothing else on those abilities changes (riders, ranges, radii, cooldowns, `energyGain` all
stand); no trap amount changes; no ultimate changes; both suites stay green.* **Spec Notes.** Eleven
one-field edits in `data/characters/*.json`. The rule these came from, recorded for the **next**
character rather than for re-deriving this table:
`round_half_up(basic × shape × rider × delay)` where **basic** is `abilities[0]`'s headline `damage`
(conditional bonuses like `axisBonus`/`innerBonus` excluded), **shape** = 1.25 single-target (no
`radius`/`impact`/`beamWidth`) or 1.00 area, **rider** = 1.00 none / 0.88 status (`slow`, `weaken`,
`root`, `reveal`, `damageOverTime`) / 0.76 displacement (`knockback`, `pull`), **delay** = 1.25 when
`delayTurns ≥ 1`. **The tiers are load-bearing, not decoration:** a flat 1.25× would raise sustained
output ~10% and claw back part of the HP gain, while the tiered table lands median output at **22.0/turn
— exactly today's** (review §3.1). **Do not simplify them into a single multiplier.** Two numbers to
watch in the playtest: `skim` is the only ability at the 1.25 ceiling and at 30 it is 86% of Kestrel's
ultimate (fallback **26** if it crowds her ult), and `chain_hook` more than doubles on the roster's only
pull ≥ 2 (AR's Rampart Fusion Lance is the precedent: 25 + pull, cd3). Out of scope: as above.

### TTK-LUMEN-HEAL. Mending Light heals 20, not 25 (DATA) — UNBLOCKED (must ship with the HP change)
**Addresses owner directive #4.** Heals are absolute numbers and do not scale with a bigger bar, so
raising HP alone makes a healer comp **worse**: two attackers net 7.9 damage/turn through Lumen, and at
the new bars that is **16.5 turns for a single kill — longer than the match**. At 20 it is 12.5. *AC:
`data/characters/lumen.json` `mending_light` `heal` amount **25 → 20**; its* `cooldown` *stays* **2**;
*no other Lumen value changes; both suites stay green.* **Spec Notes.** One field. Lumen's sustained
throughput becomes 16.0/turn on a 140 bar = **11.4% of a health bar per turn**, inside AR's support band
(median 9.7%, max 12.5%) for the first time — today she is at 17.6%, 1.4× AR's best support, because
Radiant Lash heals 12 *while* dealing 14 so her 2-turn cooldown never leaves a gap. **The amount changes,
not the cooldown** — the 2026-09-23 directive "Prep cooldowns are correct right now" is untouched.
`roster-v1.md` §4's "sustain ceiling: 25 heal per 2-turn cooldown (Lumen)" becomes 20 and is routed to
the Designer below. Out of scope: Verdant Veil, Blood Frenzy, Sanctuary, Overgrowth, every shield.

### TTK-TURN-LIMIT. 2v2 runs to 20 turns, not 16 (ENGINE CONFIG) — UNBLOCKED (must ship with the HP change)
**Addresses owner directive #3, and it is load-bearing.** At two attackers and `roster-v1.md` §4's 60%
hit rate, 2v2 already paces to **15.2 turns for 4 kills against a 16-turn limit**; after the HP raise it
is **19.7**. Without this change every 2v2 ends on the clock instead of on kills. (AR had slack because
4v4 supplies four attackers per kill target; our default supplies two.) *AC:*
`packages/engine/src/formats.ts` `FORMATS['2v2'].turnLimit` **16 → 20**; `killsToWin` *stays* **4**; *4v4
and 1v1 untouched;* `docs/GAME_SPEC.md` §1's *format table row for 2v2 reads* `| 2v2 | 4 | 20 |`; *the
two assertions in* `packages/engine/test/formats.test.ts` *that name 16 (`:22` — the `toEqual` on the
whole 2v2 record — and `:61-67` — "2v2 decides on the leader after turn 16") are updated to 20 and still
prove the same behaviour (still active at the old boundary, finished at the new one).* **Spec Notes.**
One config value, one spec-table cell, two test updates. Not a "constant tweak" — it changes what a match
is, which is why the review argues it in full (§2.3) and why it must not ship without the HP change or
vice versa. Also check the client's clock/scoreboard read the limit from the format rather than a literal
(`scoreboard.ts:145` takes `format.turnLimit`, so it should just follow — confirm, don't assume). Out of
scope: `KILLS_TO_WIN` (staying at 4 is deliberate — see review §7.3, an open question for the owner, not
a Builder call).

### TTK-INVARIANT. The HP ladder and the damage tiers are enforced by a test (TEST) — BLOCKED on the four above
**Why:** the same reason CD-BAND-INVARIANT exists — a balance rule that lives only in prose is a rule the
next character silently breaks, and `roster-v1.md` §1's kit table has no HP or damage constraint at all.
*AC:* `packages/engine/test/content.test.ts` *asserts, over all nine shipped characters:* (a) *every*
`maxHp` *matches the shipped ladder and the archetype medians stay ordered* **firepower < support <
frontline** *with support at least 15% above firepower;* (b) *every non-basic, non-ult ability carrying a*
`damage` *effect sits at* `round_half_up(basic × shape × rider × delay)` *for its own class, per the table
in TTK-SKILL-DAMAGE — computed in the test from the ability's own* `radius`/`impact`/`beamWidth`/`shape`,
*its rider effect kinds, and its* `delayTurns`, *so a new character is checked by the same rule;* (c) *the
failure message names the class and the expected multiplier, so an author reads the rule rather than a
bare number.* **Spec Notes.** `content.test.ts` already imports all nine characters and is where the
roster's structural rules live — extend it, do not add a file. **Aegis is legitimately exempt from (b)**
(no direct-damage skill since PR #97; session-8 OQ #5 closed that as intended) — express that as "no
damaging skills to check", never as a name in an allow-list. **Traps are out of (b) entirely** —
conditional damage has no term in the formula. Keep `validate.ts` value-agnostic: a balance band is roster
policy, and content tests are where policy belongs.

### The risk, and it is mechanical
Changing nine `maxHp` values and eleven damage values will break any test that asserts a specific
remaining-HP number or a kill after N hits, and the turn-limit change breaks the two `formats.test.ts`
assertions named above. Run the full suite and fix the **tests**, not the data — these integers are the
owner's. Watch `packages/client/test/modes-ui.test.ts`, the one client test that references real
character HP values.

## Path A — validate before you build (the session direction; owner-chosen)

The game is feature-complete for a 2v2 duel and **deployed live**, but the recent mechanics (cooldown
bands, Warding Wall + rotation, Ram Charge's line, TRAP-SHOVE, DEATH-HANG, AIM-PREVIEW-TRUE) are
**unvalidated by real play**. Path A retires that risk before adding more.

### PLAYTEST (owner + humans; not a Builder code item) — AFTER the two bug fixes ship
A real **two-machine internet playtest** of the live deploy — ideally the **asymmetric 3-player 2v2**, the
least-exercised path. **Prerequisite:** WALL-CAST-FIX and RAM-LINE-PREVIEW-FIX merged first — otherwise two
abilities under test are unusable; and, per the build order, **the five TTK items** unless the owner rules
otherwise. If the TTK package has landed, the playtest also answers: does a fight last long enough that a
single caught-in-the-open turn is survivable (the directive's whole point); does Kestrel's Skim at 30 crowd
her ultimate (fallback 26); does Bastion's Chain Hook at 23 + pull 2 read as fair; does a 20-turn 2v2 drag. Watch: does a mid-match death stay playable for both sides (DEATH-HANG);
do dashes at 4–5 and blasts at 3–4 improve the tempo; does the rotatable Warding Wall read and matter (and
is its ~7-tile reach too long — session-9 OQ #2); does Ram Charge's line read as an attack; does a
shove-into-trap play feel good (TRAP-SHOVE). **Output: a short list of felt problems → a tuning pass**,
mostly data (numbers), not engine.

### NET-E2E. Automated end-to-end networked test harness (SERVER + CLIENT) — FLAGGED, size TBD after playtest
The biggest latent risk: DEATH-HANG was a networking-wiring bug pure-function tests could not catch, and
session-9 OQ #4 (a committed wall's rotation across a replay) was "verified by reading the protocol, not a
two-client test" — the same gap. There is **no automated two-client coverage** of the networked loop (lobby
→ both clients submit → resolve → next turn → a death → reconnect → a rotated-wall order relayed). Path A's
infrastructure payoff. **Not fully specced** — its shape depends on what the playtest surfaces and a
Builder/owner call on the seam (two `app-harness.ts` controllers over a loopback transport, or the real
Durable Object in a test worker). Scope it into a full item after the playtest.

## Routed to Designer / flags

- **`roster-v1.md` §4's balance ceilings go stale with the TTK package (Designer).** Three lines need
  rewriting once TTK-HP-BAND / TTK-SKILL-DAMAGE / TTK-LUMEN-HEAL land: *"time-to-kill on a 100 HP target:
  4–5 connected hits"* (bars are 100–175 now and TTK is ~5.9), *"undelayed skill damage caps at 24"* (the
  cap becomes 30 — Kestrel's Skim) and *"skill nuke ceiling: 34"* (33), and *"sustain ceiling: 25 heal per
  2-turn cooldown (Lumen)"* (20). §1's kit table should also gain the HP ladder and the damage-tier rule,
  which it has never carried. **Documentation debt, not a blocker** — TTK-INVARIANT enforces the numbers in
  `content.test.ts` meanwhile. Evidence: `docs/reviews/2026-09-27.md`.
- **Kestrel's Skim at 30 (playtest flag).** The only ability at the 1.25 ceiling, and 86% of her own
  ultimate on a 4-turn cooldown. **Fallback 26.** — **Bastion's Chain Hook at 23** on the roster's only
  pull ≥ 2; AR-normal (Rampart's Fusion Lance: 25 + pull, cd3) but a big change in what the ability is.
- **WALL-REACH (session-9 OQ #2, Designer).** After WALL-ROTATE, `warding_wall`'s far end can sit ~7 tiles
  from Aegis (anchor within 4, wall extends 4 along the cardinal); it was ~5 under the old centred geometry.
  No number changed and the Builder did not rebalance. **Designer/playtest call** whether `range` should
  come down. Ruled in edge-cases (WALL-ROTATE flag). Watch it in the playtest.
- **WALL-BLINK-ONTO (owner confirmation; session-9 OQ #3).** After TRAP-SHOVE-DEFAULT every mine bites a
  blink that lands on it, but the wall still does not (its authored *"a blink goes around it"*). This is now
  the *only* trap-trigger divergence. **Kept as authored; flag to owner** — one array entry (`teleport` on
  `warding_wall.triggers`) + flipping the *"blink onto a wall tile"* test aligns them if wanted.
- **Aegis has no cooldown'd Blast** (session-8 OQ #5) — **closed as intended** (owner "Aegis skill set is
  good"). **Aegis beam distinctness** (now a 3-wide lane). **Self-lethal recoil warning** (a design call,
  not scheduled). **Burn/regen pip glyphs** (art, a look on a real plate). **Warding Halo's dead `weaken`**,
  **trap count cap**, **inspect-panel chips hoverable**, **chase-preview detour**, **Solar Flare DoT
  ceiling**, **Thorn mine carpet** — unchanged flags.

## Flagged future (not scheduled)

- **All-seats-downed resolves on the timer, not at once** (session-8 OQ #4) — rare, safe; schedule only
  with the resolve-loop guard specified. **M3-REMATCH**, **IDLE-KICK**, **LOBBY-TEAM-CHOICE** (room
  lifecycle — the natural follow to NET-E2E). **same-turn-buff preview**, **route-around-bodies dash impact
  preview** — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- Folded into **Path A / PLAYTEST**: exercise a death; shove-into-trap combos; the cooldown-band feel; the
  rotatable Warding Wall and its reach; Ram Charge's line; the new HUD; AIM-PREVIEW-TRUE; Ravok's recoil.
