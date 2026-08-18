# BACKLOG.md — prioritized, top item first

Owned by the Analyzer. The Builder implements the **entire unblocked set** in dependency
order (top-down), each with tests, committing per item. Items stay small and
independently shippable. Each item carries **Spec Notes** (Analyzer's build guidance).

**Format (GAME_SPEC §1):** 2v2 default (2–4 players), 4v4 supported (4–8), 1v1 dev/testing.

**Standing directives:** engine iterates unit **lists**; engine is pure/deterministic and
**dependency-free** (client may depend on Vite/Three.js; **server may depend on the Workers
runtime**); client/server consume `TurnEvent[]` + the engine's derived queries — never recompute
them. **`@cards/server` imports `@cards/engine` only, never the client** (the client may import
server protocol **types only**, `import type`). **Movement is Manhattan (MET1); aiming is Euclidean
(AIM-METRIC).** **Open/update a PR to `main` every session** (CLAUDE.md).

> ⚠️ **`main` is now LIVE.** A green push to `main` publishes the Worker (Cloudflare) and the client
> (GitHub Pages) automatically. Keep it green.

## ✅ COMPLETE

- The full local hot-seat game + AR parity + the screenshot UI batch + M3-ROOM…M3-LOCKLIST, the whole
  M3 networked loop (lobby, net board, timer, reconnect/handoff, end screen), and the roster/basics work.
- **PR #77 (this review):** **TIMER-PERSIST** (the decision window + Time Bank survive DO eviction;
  RECONNECT-DETACH restores every seat disconnected), **NET-PRESENCE-UI** (mark disconnected seats +
  tell a stand-in it's covering), **M3-DEPLOY-PREP** (the client's Worker origin is a build var; smoke
  check), **M3-DEPLOY-LIVE** (CI publishes the Worker on a green `main` — **the game is deployed**;
  Worker live at `cards-rooms.lockstepcards.workers.dev`, client on GitHub Pages).

Current suite: **1914 tests** (882 + 792 + 240), typecheck + build clean. Engine source untouched.

## 🔧 OWNER ACTION (one setting — unblocks internet multiplayer)

- **Set the repo VARIABLE `WORKER_ORIGIN` = `cards-rooms.lockstepcards.workers.dev`.** GitHub → repo
  **Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**. Then
  re-run the Pages deploy (push any commit to `main`, or re-run the workflow). Until this is set, the
  deployed client at `https://jouyang01.github.io/CARDS/` is same-origin and the networked path reaches
  no server (Builder OQ 2026-09-16 #4). **The Worker 404 at its root is expected — it is the backend,
  not the website.**

### Build order and dependencies

**SUBMISSIONS-PERSIST → NET-PRESENCE-ENEMY → BASIC-MODES.** The first two are small; BASIC-MODES is the
last engine knob and its own session. No hard dependencies between them.

---

## Server — finish TIMER-PERSIST's job (do first)

### SUBMISSIONS-PERSIST. Locked-in orders survive a DO eviction (SERVER, small) — UNBLOCKED (first)
**Addresses Builder OQ 2026-09-16 #2.** TIMER-PERSIST persisted the deadline and the Time Bank charges;
the **third** in-memory thing is this turn's submissions (`hub.ts` `#submissions`), so a Durable Object
evicted mid-turn resumes the right window but every seat reads **unlocked** and must re-lock. *AC: the
current turn's locked-in orders are **persisted on the `Room` record** (a plain object, same shape as
`bank`) and **rehydrated on restore**, so a DO reconstructed mid-turn shows each seat still locked with
its submitted orders; a test evicts/reconstructs a DO after a lock-in and asserts the submission and
lock state are unchanged.* **Spec Notes.** Files: `packages/server/src/durable-object.ts` (persist
alongside the deadline/charges write), `hub.ts` (`#submissions` rehydrate; the `Room` type gains the
field). Plain-JSON, deterministic. This is the gap between "the clock survives" (done) and "the turn
survives". Out of scope: mid-flight order *editing*; the idle-player rule (flagged).

## Client — the optional presence follow-up

### NET-PRESENCE-ENEMY. An enemy "1 of 2 present" count (CLIENT, tiny) — UNBLOCKED (optional)
**Addresses Builder OQ 2026-09-16 #6.** NET-PRESENCE-UI marks own-team disconnects; the enemy block
shows only a pick count. *AC: the enemy lobby/topbar block may show a **present count** ("1 of 2
present") beside its pick count; enemy character **ids and picks stay hidden** (BLIND-PICK); a test
asserts the enemy present-count renders and no enemy id/pick leaks.* **Spec Notes.** Files:
`packages/client/src/` (the enemy lobby/topbar block). Coarse status like the lock-count — **not** a
golden-rule-#5 leak (ruled). Optional, not load-bearing; skip if the session is full. Out of scope:
enemy seat ids; any pick data.

## Engine — the last roster knob

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large; returns Kestrel)
*AC: an ability may carry `modes: [AbilityProfile, AbilityProfile]` chosen at aim time (order carries
the index); ships with **Kestrel's Twin Bolts** (wide cone 2 ↔ thin line 6) and **returns Kestrel to
the client's default `CATALOG`**; the client offers the toggle (AIM2 UI). Tests: each mode resolves its
own profile; validation rejects a malformed `modes` array.* **Spec Notes.** The largest BASIC-\* ask
(real aim-UI work); its own session. Engine change → ships with tests (golden rule #3); keep the mode
geometry integer/deterministic. Out of scope: other kits.

## Flagged future (not scheduled)

- **M3-REMATCH** — re-enter the same room from the end screen (a protocol conversation; the loop closes
  via the create form without it).
- **NET-E2E** — a two-client Playwright harness against a running Worker (would cover the presence
  marks the hot-seat render suite can't reach — Builder OQ 2026-09-16 #5). Low.
- **IDLE-KICK** — forfeit/kick a connected seat that never acts (M3-TIMER already holds it). Post-v1.
- **LOBBY-TEAM-CHOICE** — let a seat choose its team; makes `wouldSeatNobody` live.

## CAMO-E2E-FINISH — UNBLOCKED (low)
Before/after-delta at fixed coords (reuse `largestCluster`). Low; the rule is unit-covered.

## Routed to Designer / flags

- **Beam + axisBonus** compose legally (ruled). **Chase-preview detour** deferred. **Decoy as a
  universal obstacle** reverses R2 — Designer call. **Host-only in-lobby map control** / **public
  draft** — reversals of set-at-creation / BLIND-PICK; flag if wanted.
- **Dash melee-cover** (Designer-deferred). **Thorn's lobbed auto** (5→4 first nerf lever). **Pad
  tuning** (`everyTurns` 4→5 on iron-basin). **Kestrel out of default `CATALOG`** until BASIC-MODES.
- **UI-TIMER hot-seat auto-lock**, **touch input**, **PREVIEW-MODIFIERS shields**, **AIM-SMOOTH**,
  `killerUnitId`/`gameEnd`, **A4**, **spectators**, **`vulnerable`** — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine internet playtest** — the moment `WORKER_ORIGIN` is set: create a room, share
  the code, play a friend over the network; **the disconnect/handoff/reconnect flow** end-to-end; **the
  40s clock feel**; **Aegis's beam**, **CHASE-COLLIDE**, **melee vs cover**, **Might centre contest**.
