# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js; **server may depend on the Workers
runtime**); client/server consume `TurnEvent[]` + the engine's derived queries — never recompute
them. **`@cards/server` imports `@cards/engine` only, never the client.** **Movement is Manhattan
(MET1); aiming is Euclidean (AIM-METRIC).** **Open/update a PR to `main` every session** (CLAUDE.md).

## ✅ COMPLETE

- The full local hot-seat game (engine core through SCORE1; AR parity; vision/stealth/camo;
  DASH-OCCUPIED; PADS-INDICATOR/RENDER-COVERAGE; TRAP-LIFETIME-TUNE; PREVIEW-DECOY; AIM-SMOOTH).
- **M3 so far:** **M3-ROOM** (Worker + DO room), **M3-PROTOCOL** (submit → merge → resolve →
  broadcast), **M3-HIDDEN** (per-team filtered views — the security boundary), **M3-JOIN-GUARD**
  (started room refuses joins), **M3-START** (`POST /rooms/:code/start` for short rooms — *interim,
  unauthenticated; removed at M3-LOBBY / gated at M3-DEPLOY*).
- **PR #51/#52 dev-note items:** **PADS-SPREAD** (no two pads within Chebyshev 1), **PADS-PASS** (a
  pad is taken by being on its square at any point in the turn), **BUFF-UI** (a named, counted-down
  status strip for the active character), and the Designer's **screenshot UI batch spec**
  (ar-parity §4.1–4.6 — scheduled below).

Current suite: **1217 tests** (engine 628 + client 468 + server 121), typecheck + build clean
(run `npm install` after pulling), purity green.

> **This batch = the owner's screenshot UI batch (priority) + the preview-modifier Dev Note**, then
> M3 resumes with **M3-LOBBY**. The owner supplied an AR screenshot and two Dev Notes, so the local
> client's AR-fidelity UI comes first. **Do not touch vision** (per-format `visionRange` superseded
> by ar-parity §3). Pad rulings (PADS-PASS/SPREAD/knockback) are now folded into edge-cases.

### Build order and dependencies

**STATUS-ICONS** (foundation for the nameplate/inspect icon row) → **UI-NAMEPLATES** → **UI-INSPECT**
→ **UI-INTENT** → **UI-TOPBAR** → **UI-TIMER** → **PREVIEW-MODIFIERS** → **M3-LOCKLIST** (small
server). Then **M3-LOBBY** (large) and **CAMO-E2E-FINISH** (low). All the UI items are client and
anchor to UI-VIEWPORT's overlay (shipped); STATUS-ICONS must precede the two items that draw its
icons. Realistic one-session cut: the UI batch + PREVIEW-MODIFIERS + M3-LOCKLIST; M3-LOBBY carries.

---

## Owner UI batch (client — priority; specced by the Designer in ar-parity §4.1–4.6)

### STATUS-ICONS. Replace the colour pips with AR's icon vocabulary (CLIENT) — UNBLOCKED (first)
**Addresses Dev Note: "Look for the Atlas Reactor UI design spec that was just made and be sure to
account for it."** (ar-parity §4.2; owner: Might = sword, Revealed = eye.) *AC: each drawable status
renders as a **drawn glyph** (canvas/SVG, no external assets) in its fixed `PIP_ORDER` slot —
Root=chained boot, Slow=hourglass, Weaken=broken sword, Reveal=eye, Shield=bubble **with the
remaining amount as a numeral**, Might=sword, Haste=wing, Energized=bolt, Unstoppable=ram,
Untargetable=ghost, **Stealth=mask rendered to the OWNING team only**; durations render as a small
numeral on the icon; the floating pips and any HUD strip read the same vocabulary (no divergence).*
**Spec Notes.** Files: `packages/client/src/status-pips.ts` (extend the pip vocabulary to glyphs;
keep `PIP_ORDER`/`PIP_COLORS` and BUFF-UI's `statusChips` reading the same source), `renderer3d.ts`
(draw the glyph textures). Weaken/Might and Root/Haste read as broken/whole pairs on purpose.
**Stealth's icon is owner-team-only** (an enemy-visible stealth marker is a contradiction). This is
the foundation for the icon row in UI-NAMEPLATES and UI-INSPECT — build it first. Out of scope:
per-unit placement (that's UI-NAMEPLATES).

### UI-NAMEPLATES. Overhead name / HP+shield / energy+ULT / status row, vision-gated (CLIENT) — BLOCKED on STATUS-ICONS
(ar-parity §4.1.) *AC: above every **visible** unit — **name** (character name until M3 gives player
names); **HP bar with the numeral inside**, shield as a distinct appended segment; **energy as a
thin bar under HP** with an **"ULT" tag when energy ≥ 100**; the **STATUS-ICONS row** under the bar;
**vision-gated** — a nameplate renders only while `canSee` holds (own team always; fogged/stealthed
units show nothing), same rule as PREVIEW-FOG; a **decoy carries a full fake nameplate** (name,
frozen cast-time HP, empty status row — see the decoy snapshot ruling). A client test asserts a
fogged enemy shows no nameplate and a decoy shows a Wisp nameplate with an empty status row.*
**Spec Notes.** Files: `app.ts`/`renderer3d.ts` (billboarded nameplates anchored to units),
`fog.ts` (the visible-unit set + the decoy snapshot fields). **Never a better scout than vision** —
consume `canSee`/`FogView`; derive nothing. Ruled in edge-cases (decoy snapshot carries nameplate
fields). Out of scope: player names (M3); last-known ghost nameplates (a ghost is DECOY-RENDER/
LAST-KNOWN's own render).

### UI-INSPECT. Hover any visible unit for its cooldowns / catalysts / statuses (CLIENT) — BLOCKED on STATUS-ICONS
**Addresses owner directive (ar-parity §4.3): "Player can see cooldowns of other characters and the
buffs/debuffs/energy/hp status when they have vision of the character."** *AC: hover (or click-hold)
a **visible** unit → a panel with its five ability slots + **current cooldown numbers**, ult charge,
**catalysts remaining vs spent** (spent greyed), and active statuses with durations; **own team
always inspectable, enemies only while `canSee`** (fog/Stealth hide the panel); a **decoy shows
Wisp's kit at the cast snapshot** (cooldowns frozen), never live data and never a refusal; **zero
engine change** (reads state the client already holds). A client test asserts a fogged enemy is not
inspectable and a decoy shows cast-time cooldowns.*
**Spec Notes.** Files: `app.ts`/`hud.ts` (the inspect panel), reusing STATUS-ICONS. Same vision gate
as nameplates. Ruled in edge-cases (decoy snapshot). Out of scope: last-known inspect data (no ghost
kit in v1).

### UI-INTENT. Teammates' queued plans on the board (CLIENT) — UNBLOCKED
(ar-parity §4.6; closes the ruled-but-invisible "Teammate information".) *AC: during Decision, above
each **allied** unit: the queued ability's **slot number** (plus a free-action/catalyst marker when
declared) and a **lock-state tick** once that seat locks in; enemies show nothing (hidden info is
team-vs-team); a client test asserts an ally's queued slot shows and an enemy's does not.*
**Spec Notes.** Files: `app.ts`/`renderer3d.ts`. In the hot-seat this reads the other seat's draft;
over the network it reads the Decision payload's own-team lock/plan info (which M3-LOCKLIST keeps
per-seat for own team). Out of scope: showing the enemy's plan (never).

### UI-TOPBAR. The match strip: portraits · score · turn (CLIENT) — UNBLOCKED (extends SCORE1)
(ar-parity §4.4.) *AC: a top overlay strip — **friendly portraits · team score · turn number ·
enemy score · enemy portraits**; each portrait carries a mini HP bar and a dead/respawn-count state;
centre shows **kills vs target for both teams with the turn counter between them** (Turn X of Y);
verified on-screen at both map sizes (UI-VIEWPORT overlay).*
**Spec Notes.** Files: `app.ts`/`hud.ts` (or a `scoreboard.ts` extension from SCORE1). Reads engine
state + SCORE1's folds; no engine change. Out of scope: the end-of-match breakdown (SCORE1 already).

### UI-TIMER. Countdown with urgency + Time Bank pip (CLIENT) — UNBLOCKED (extends TIMER-40)
(ar-parity §4.5.) *AC: a countdown beside LOCK IN — **whole seconds above 10 s, tenths + a colour
shift below 10 s**; the **Time Bank rendered as one pip** (we have 1 charge); the +10 s extension
**animates visibly** when it fires (never silent); counts from `DECISION_SECONDS` (40).*
**Spec Notes.** Files: `hud.ts`/`app.ts`. Presentation only (the timer value is `TIMER-40`'s
constant; server-authoritative timing is M3-TIMER). Out of scope: per-player networked timing.

### PREVIEW-MODIFIERS. The damage preview accounts for Might/Weaken/cover (CLIENT + engine export) — UNBLOCKED
**Addresses Dev Note: "Should account for Might + Cover + Weakness."** *AC: a damage preview number
(PREVIEW-NUMBERS + the decoy/nameplate previews) shows the **post-modifier** damage — the attacker's
**current Might/Weaken** applied, then **cover** reduction if the target is behind cover from the
attacker — computed by **reusing the engine's `computeDamage`/`isBehindCover`** (not reinvented); a
Might'd attacker's preview is higher, a Weakened one lower, a target-in-cover shows the reduced
number, each matching a direct `computeDamage` call; a status **applied this turn** (Adrenaline at
Blast start) is NOT predicted — the preview reflects current state.*
**Spec Notes.** Files: `packages/client/src/preview-numbers.ts`; export `computeDamage`/
`isBehindCover` from `@cards/engine` if not already (pure — correct surface-widening, like
`orders.ts`). **Shields flagged, not required** — the owner named Might/Cover/Weaken; keep the number
the post-cover damage for v1 (the nameplate shows the shield pool separately). Ruled in edge-cases
(preview accounts for Might/Weaken/cover). Out of scope: engine damage rules (unchanged); predicting
post-lock statuses.

## M3 — small fix + the lobby

### M3-LOCKLIST. Enemy lock state → a count, not seat ids (SERVER) — UNBLOCKED (small)
**Addresses Builder OQ 2026-08-16 third #4.** *AC: a Decision payload keeps **own-team** lock state
per-seat (UI-INTENT needs it) but reports the **enemy team's readiness as a bare locked-count**, not
seat ids; the M3-HIDDEN test that excludes enemy fields still passes and a new test asserts no enemy
seat id appears in a pre-reveal payload.*
**Spec Notes.** Files: `packages/server/src/hub.ts` (the `decision` payload shape). Do it **before**
M3-LOBBY builds a waiting UI on the richer shape. Ruled in edge-cases (Decision payload lock list).

### M3-LOBBY. Map/format/catalyst/character selection + team-seat + R3 + the network client (SERVER + CLIENT) — UNBLOCKED (large)
*AC: a lobby picks map + format + each player's catalyst triad + character, seats players, enforces
**R3 duplicate-pick** (unique within a team, mirrors legal); its start button calls `RoomHub.start()`
and **deletes the temporary `POST /rooms/:code/start` route**; supersedes MAPTOGGLE and M3-START's
interim; replaces M3-PROTOCOL's deterministic deal with player picks; **the client consumes a
`decision` and a filtered `turnResolved` over the socket** — proving M3-HIDDEN end-to-end (Builder
OQ #7).* Folds in per-character catalyst selection + the Shift-landing preview.
**Spec Notes.** The first item to build the **network client** (socket layer) — until now the client
is hot-seat only and has never consumed M3-HIDDEN's payloads (chosen to be a `GameState` with things
missing, so it reads with the existing renderer). Large; may span sessions. Out of scope: reconnect
(M3-RECONNECT), server-authoritative timing (M3-TIMER).

### CAMO-E2E-FINISH. Composited proof of the camo red tile (CLIENT e2e) — UNBLOCKED (low)
**Re-specced per Builder OQ 2026-08-16 third #1** (the `pixelAt` technique can't work — no
board→pixel map in the e2e). *AC: `findPixels(before, isBrushGreen)` captures the brush coords;
drive the `?scenario=in-brush` unit to **attack from inside brush**; assert a meaningful number of
**those same coordinates** now match `isCamoRed` (a before/after delta at fixed coords — dodges both
the projection and the counting problem).*
**Spec Notes.** Files: `e2e/render.spec.ts` + `pixels.ts`. **Not "small"** — a multi-turn browser
drive that gets a unit attacking from brush. Low priority; the *rule* is unit-covered
(`camo-reveal.test.ts`), only the compositing is unproven.

## M3 — the rest of the roadmap (blocked in sequence)

### M3-TIMER. Server-authoritative per-player timer + Time Bank (SERVER + CLIENT) — BLOCKED on M3-LOBBY
*AC: the DO enforces each player's `DECISION_SECONDS` (40) deadline; a missed submission resolves as
**hold-position** (settle the OPEN partial-disconnect ruling at build — lean: hold, then a teammate
gains the abandoned characters after one fully missed turn); Time Bank (1× +10 s) extends only that
player's deadline; the client shows UI-TIMER's countdown driven by the server clock.*

### M3-RECONNECT. Rejoin by code + reclaim a held seat + replay to current (SERVER + CLIENT) — BLOCKED on M3-LOBBY
*AC: a dropped browser rejoins by room code, **reclaims its original seat** (identity-matched — the
seat M3-JOIN-GUARD reserves) with its control map intact, and the DO re-syncs it to the current turn
from stored state (not a re-simulation).*

### M3-DEPLOY. Wrangler deploy + Pages integration + first real-runtime smoke (CI) — BLOCKED on M3-LOBBY
*AC: a `wrangler deploy` path (ARCHITECTURE §110); the client points at the deployed Worker;
core-CI/Pages gates hold; a `wrangler dev`/miniflare **smoke check** proves the Worker boots for real
(Builder OQ #6); **the `POST /rooms/:code/start` route is gone or gated** (M3-START #5).* **Needs
owner infra decisions (account, route) — coordinate before building.**

## Routed to Designer (data / balance — not Builder build items)

- **Pad placement + timings** — Builder re-laid both maps' pads as mirrored singles only to satisfy
  PADS-SPREAD (`duel-arena` now stacks all six in the two central columns) — satisfies the rule and
  the mirror guard "and nothing else." **Designer owns real placement** (lanes, sightlines, which
  pad is worth contesting). **Pad COLOURS are coupled to the render e2e** (`isPadTeal`/`isTeamBlue`
  clamp) — squares/timings free, colours are not without moving those predicates.

## Flags (optional / playtest-gated — not scheduled)

- **PREVIEW-MODIFIERS shields** — showing HP-loss-after-shield is a natural extension; the owner
  named Might/Cover/Weaken, so v1 shows post-cover damage only. Fold in if playtest wants it.
- **Pad contest feel** (a charge steals a pad from a closer walker — Builder OQ #8), **AIM-SMOOTH
  angle-uniform table** (only if 512 falls short), `killerUnitId`/`gameEnd` events, Might/Weaken vs
  over-time (ruled off), CAT-DASH-FULL vs one-free-action — unchanged, not scheduled.

## Deferred — do NOT schedule

- **A4** per-ability FX — blocked on M3 + roster lock (revisit after M3-LOBBY).
- **Spectators**, **CL1/CL2/E2**, **flat `energy` effect kind**, **vision metric change**, **tunable
  cone angle**, **optimistic move validation**, **`vulnerable`**, **Echo Boost / Chronosurge /
  Critical Shot / Regroup catalysts** — not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **Pad centre-line contest & Dash-beats-Move**, **DoT/HoT vs Might/Weaken** (ruled off),
  **chase prediction tell**, **8-tile melee cones**, **Fade full-action**, **catalyst hoarding**,
  **Kestrel** untested via MAPTOGGLE, **turn-1 spawn margin one tile**, **vision Manhattan diamond**
  (owner-approved), **aim-rotation angular evenness**.
