# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free**; client/server consume `TurnEvent[]` + the engine's derived queries — never
recompute them. **`@cards/server` imports `@cards/engine` only** (client may import server protocol
**types only**). **Movement is Manhattan (MET1); aiming is Euclidean.** **Every engine behavior change
ships with a Vitest test in the same commit.** **Drive the real UI wiring in tests** (`app-harness.ts`
/ two-net-client tests). **Open/update a PR to `main` every session.**

> ⚠️ **`main` is LIVE** — a green push publishes. Deploy is set. Keep it green.

## ✅ COMPLETE

- The full hot-seat game + AR parity + the whole M3 networked loop + deploy + Dev Notes batch 3.
- **PR #88 (this review):** **HUD-LAYOUT** (the board dominates the screen — catalysts bottom-left,
  movement bottom-right, lock-in bar centre, score top), **SOCKET-ID-STABLE** (a restored room is
  joinable — the next id derives from the persisted seats), **TOOLTIP-SWEEP** (the last four native
  tooltips are instant), **DEV-CHARSELECT-ERROR** (a bad `?chars=` refuses to load), **HARNESS-HOTSEAT**
  (the pass-the-device handover is harness-driven).

Current suite: **2333 tests** (1137 + 910 + 286), typecheck + build clean.

### Build order and dependencies

**AIM-PREVIEW-TRUE → HARNESS-LOBBY-MATCH.** AIM-PREVIEW-TRUE is large and owner-flagged VERY IMPORTANT
— a full session on its own; HARNESS-LOBBY-MATCH rides if there's room. No engine work.

---

## Client — the truthful aim preview (do first; owner VERY IMPORTANT)

### AIM-PREVIEW-TRUE. The aim preview's shape becomes the engine's own tile-centre predicate (CLIENT) — UNBLOCKED (first, HIGH)
**Addresses Dev Note #3: "View the PR #90 Designer and ensure it makes it into the next builder spec"**
(the Designer spec is `docs/design/aim-preview-true.md`, owner-flagged **VERY IMPORTANT**); and the two
live preview bugs it fixes — **Dev Note #1: "BAstion's Crushign Slam Center hit does not account for
preview correctly."** and **Dev Note #2: "Aegis Shield Bash still shows a cone preview, it should be
the 3 tile wide rectangle."** The client draws two objects that cannot agree — the smooth AIM2 *input
region* and the `expandShape` *answer* — which under HITBOX1 disagree by up to ½ tile at every edge and
rotation. *AC (from `aim-preview-true.md` §3):*
1. **Congruence (the keystone test):** for every shipped shape — circle, cone, **beam**, line, both
   Kestrel modes, dash impact — over a sweep of quantized rotations, the lit `expandShape` tile set
   equals **exactly** the set of tiles whose centres fall inside the drawn boundary (none outside, none
   missing). This doubles as a HITBOX1/CONE-B/CIRCLE-FIX geometry regression guard.
2. The boundary is **generated from the ability's engine parameters** (`range`, radius, the
   `halfWidth(d)=d` ramp, `beamWidth`, quantized `aimStep`) in **one module** — never hand-drawn art.
3. **Wall occlusion is drawn** — line/cone boundaries truncate at the first wall (LOS-OCCLUSION);
   circle draws whole.
4. **Both layers render:** the smooth boundary outline **plus** the tile fills inside it; tiles pop as
   their centre crosses the line. Damage numbers unchanged.
5. **Locked orders** re-render the same boundary + tiles in the locked style (one derivation for
   preview, confirmation, resolution).
6. **Determinism boundary respected:** tile selection stays the engine's integer `expandShape`; the
   outline is float/curve client presentation (as AIM2 already ruled).
*Per-shape boundary (from the spec's table): `circle` → radius exactly r; `cone` → the wedge inflated
by ½ (edges out ½, apex/corners radius-½ arcs); `cone`+`beamWidth` → **the lane inflated by ½: a
rounded-corner rectangle** (Aegis, Dev Note #2); `line` → a half-width-½ capsule; `modes` → each mode
its own; dash `impact` → the circle rule at the landing.*
**Spec Notes (mine, extending the Designer's §4).** Files: `packages/client/src/` — a **single**
boundary-derivation module reading engine params (keeps AC #2 structural), the renderer that tessellates
it (the wedge ⊕ disc(½) is ~a dozen points + three arcs, not a general Minkowski), and the range
envelope moved to a **quieter** channel (thin border, faded once a live aim exists — the second half of
the owner's "two things" feeling). **Sub-band tell (Dev Note #1):** the axis/inner highlights (Bastion's
+8 line via `axisSquares`, Cinder's core via `innerSquares`) must draw **congruently from the same
engine predicate** as the outer boundary — "Center hit does not account for preview correctly" is about
which tiles show the centre bonus, so the band is the engine's answer too, not a client redraw. An
**optional engine export** of the analytic boundary description is fine (the spec allows it); keep
`expandShape`/HITBOX1/CONE-B/CIRCLE-FIX **untouched** — this draws what they compute. **Out of scope:**
any change to the shape engine; the damage numbers (correct since PREVIEW-AUDIT). Cross-item: may
resolve the Designer's "Aegis beam distinctness" flag — re-ask after.

## Client — the last harness gap

### HARNESS-LOBBY-MATCH. Drive the lobby→match transition through the harness (CLIENT test, low) — UNBLOCKED
**Addresses Builder OQ 2026-09-21 #6.** `app-harness.ts` covers everything in `startHotSeat`; the one
untested wiring surface is `main.ts`'s `joinRoom` subscribe handler tearing down the lobby and calling
`startNetworkedMatch` — the *class* that produced the ready-button bug. *AC: a test drives a lobby that
reaches `matchStarted`, asserts the lobby screen is torn down and the board comes up on the seat's
filtered state.* **Spec Notes.** Files: `packages/client/test/` + the harness. Low; closes the last
"pure passes, wiring broken" surface. Out of scope: the match loop (covered).

## Routed to Designer / flags

- **Aegis's beam distinctness** — AIM-PREVIEW-TRUE draws the beam as a distinct rounded-rectangle lane;
  **re-ask the Designer after it ships** whether that reads distinct enough from a wedge, or a further
  render treatment is wanted.
- **Warding Halo's dead `weaken`** (add an enemy-facing Prep path or drop the rider), **trap count cap**
  (none exists; a count cap + eviction is a Designer decision if the mine carpet is oppressive) — still
  Designer-owned.
- **Inspect-panel chips hoverable** (Builder OQ 2026-09-21 #3) — the inspect chips carry their text but
  are `pointer-events:none`; making them hoverable needs a **pinned-panel** design (a panel that stops
  chasing the pointer). Future item if the owner wants it.
- **Beam + axisBonus** compose legally. **Chase-preview detour** deferred. **Decoy-universal-obstacle**
  / **host map control** / **public draft** — reversals, flag if wanted. **Solar Flare DoT ceiling**,
  **Thorn mine carpet** — playtest.

## Flagged future (not scheduled)

- **NET-E2E** — a two-client Playwright harness against a running Worker (pixel coverage). **M3-REMATCH**,
  **IDLE-KICK**, **LOBBY-TEAM-CHOICE**, **CAMO-E2E-FINISH** (low) — unchanged.

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine internet playtest** (deploy works; SOCKET-ID-STABLE now survives a restart).
  **The new HUD layout feel**, **PHASE-STATUS-FIRST**, **CASTER-SAFE**, **DASH-STATUS**, **BRUSH-BREAK**,
  **Aegis's beam** (after AIM-PREVIEW-TRUE), **Thorn's mine carpet**.
