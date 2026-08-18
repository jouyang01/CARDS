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

## ✅ COMPLETE

- The full local hot-seat game + AR parity + the screenshot UI batch + M3-ROOM…M3-LOCKLIST.
- **PR #73:** WAYPOINT-TELL, M3-WAIT-STATE + M3-CONN-STATE, CREATE-LINK, BASIC-BEAM.
- **PR #75 (this review):** **WAYPOINT-DASH-CLEAR** (a dash takes the composed route + marks with it,
  derived not cleared), **M3-END-SCREEN** (a decided match says who won, per-seat, and offers the front
  door), **M3-TIMER** (the 40s server clock, injected; one deadline per room; Time Bank +10s; missed →
  hold), **M3-RECONNECT** (a dropped seat is held, reclaimed by name, and covered by a teammate
  meanwhile — the handoff derived from `connected`+`missedTurns`).

Current suite: **1876 tests** (858 + 792 + 226), typecheck + build clean. Engine source untouched.

> **The networked game is feature-complete and playable end-to-end.** Remaining: two robustness/polish
> items, then **deploy** — the prep is unblocked now; the live deploy is one owner login away (the
> owner is setting up Cloudflare).

### Build order and dependencies

**TIMER-PERSIST → NET-PRESENCE-UI → M3-DEPLOY-PREP → M3-DEPLOY-LIVE.** The first three are unblocked;
M3-DEPLOY-LIVE is blocked only on the owner's Cloudflare login (in progress). **BASIC-MODES** is a
separate engine session after. Realistic one-session cut: the first three, with M3-DEPLOY-LIVE landing
the moment the owner confirms login.

---

## Server — deployed-play robustness (do before deploy)

### TIMER-PERSIST. The decision deadline + Time Bank charges survive DO hibernation (SERVER, small) — UNBLOCKED (first)
**Addresses Builder OQ 2026-09-15 #1 + #3.** `#deadline` and the Time Bank charge counts are **in
memory only**, so a Durable Object evicted mid-decision returns with no open window (the turn waits for
players until the alarm re-arms) and with everyone's charges reset. No regression vs pre-M3-TIMER, but
eviction happens in **production** — this must be solid before deploy. *AC: the open deadline (as a
duration or an absolute the DO can rehydrate) **and** each seat's remaining Time Bank charges are
**persisted on the `Room` record** and **rehydrated in `#arm`** on wake; a Durable Object that reloads
mid-decision resumes the same window and the same charge counts; a test evicts/reconstructs a DO
mid-turn and asserts the deadline and charges are unchanged.* **Spec Notes.** Files:
`packages/server/src/durable-object.ts` (persist alongside the existing `Room` write in
`blockConcurrencyWhile`/on change), `hub.ts` (`#arm` rehydrate; the `Room` type gains the fields). One
field-group on `Room` + a rehydrate line, as the Builder scoped. Keep it plain-JSON. Ruled in
edge-cases (TIMER-PERSIST). Out of scope: the idle-player rule (flagged, not scheduled); changing the
clock semantics.

## Client — presence polish

### NET-PRESENCE-UI. Show disconnected seats and who is covering for whom (CLIENT, small) — UNBLOCKED
**Addresses Builder OQ 2026-09-15 #4 + #5.** The handoff is server-correct but silent: a stand-in's
board grows the disconnected teammate's characters with nothing saying so, and `RoomView.seats` carries
`connected` no screen draws. *AC: the **lobby and the topbar mark a disconnected seat** (a dimmed / ❌
nameplate, read from `seats.connected`); a seat **covering** for a disconnected teammate is **told so**
(a line in the wait banner, or a mark on the borrowed nameplates), so the extra characters are
explained; a test asserts a disconnected seat renders marked and a covering seat shows the cover
notice.* **Spec Notes.** Files: `packages/client/src/` (the lobby view + the in-match topbar/HUD).
Read `connected` + the server's derived control map (HANDOFF) — **recompute nothing**. Client-only, no
protocol change. Ruled in edge-cases (NET-PRESENCE-UI). Out of scope: the handoff rule (server, shipped);
reconnect logic (shipped).

## Deploy — the last gate to internet multiplayer

### M3-DEPLOY-PREP. Everything for deploy except the auth-gated push (SERVER + CLIENT + tooling) — UNBLOCKED
Do the deploy plumbing that does **not** need the Cloudflare account, so the live deploy is one command
once the owner is logged in. *AC: **`wrangler` is added** as a dev dependency and a **`deploy` script**
exists for the Worker (`packages/server`, against the existing `wrangler.toml` — DO + `new_sqlite_classes`
migration already declared); the **client's production Worker URL is configurable** (a build-time
env/config, not a hard-coded `localhost` socket) so the built client connects to the deployed Worker's
`wss://` origin; a **`wrangler dev`/miniflare smoke check** boots the Worker locally against the real
runtime (first real-runtime check); the build (`npm run build`) produces the Pages artifact. Tests/checks:
the smoke check boots and answers a health/`POST /rooms`; the client reads the Worker URL from config,
not a constant.* **Spec Notes.** Files: `packages/server/package.json` (wrangler dep + `deploy` script),
`packages/client/src/main.ts` (the socket URL from config/env), root scripts. Confirm the unauthenticated
`POST …/start` route is gone (done PR #68). **Do not deploy** here — that is M3-DEPLOY-LIVE. Out of
scope: the live push; custom domains.

### M3-DEPLOY-LIVE. Deploy the Worker + client and wire the URLs (SERVER + CLIENT) — BLOCKED on a deploy CREDENTIAL in the build env (owner login done)
The actual publish. **Owner inputs received (2026-09-15):** the owner ran `wrangler login` **on their
Mac** and registered the **`lockstepcards`** workers.dev subdomain — so the Worker will publish to
`cards-server.lockstepcards.workers.dev` (or similar), and free subdomains are the choice (no custom
domain). *AC: `wrangler deploy` publishes the Worker (Durable Object with the SQLite migration —
free-plan compatible); the client is deployed to **Pages** (or the repo's existing GitHub Pages
workflow); the deployed client points at the deployed Worker's `wss://` URL (from M3-DEPLOY-PREP's
config, e.g. `wss://cards-server.lockstepcards.workers.dev`); a real two-machine create → pick → play →
resolve round-trips over the internet; the deploy gate is legible (pass/fail surfaced).*
**Spec Notes — the remaining blocker is WHERE the deploy runs.** The owner's `wrangler login` lives on
**their Mac only**; the Builder runs in a **cloud container that is not logged in**, so it cannot
`wrangler deploy` as-is. Two ways to close this, owner to choose:
- **(A, recommended) A Cloudflare API token in CI.** The owner creates an "Edit Cloudflare Workers"
  token in the dashboard and adds it as a **GitHub repo secret** `CLOUDFLARE_API_TOKEN` (via the GitHub
  website — never pasted into chat). Then a GitHub Actions workflow deploys the Worker on push (the repo
  already has a Pages workflow for the client). Hands-off after setup, tied to no one laptop.
- **(B) Owner runs it on their Mac.** Requires the repo cloned locally; the owner runs a single
  `npm run deploy` the Builder provides. Fastest to a first deploy, but repeats on every deploy and
  needs the repo on the Mac.
**Flag the owner to pick A or B before building this.** Out of scope: custom domains (owner chose free
subdomains); a full CI matrix.

## Engine — the last roster knob

### BASIC-MODES. Two aim-time profiles on one ability (ENGINE + CLIENT) — UNBLOCKED (large; returns Kestrel)
*AC: an ability may carry `modes: [AbilityProfile, AbilityProfile]` chosen at aim time (order carries
the index); ships with **Kestrel's Twin Bolts** (wide cone 2 ↔ thin line 6) and **returns Kestrel to
the client's default `CATALOG`**; the client offers the toggle (AIM2 UI). Tests: each mode resolves its
own profile.* **Spec Notes.** The largest BASIC-\* ask (real UI work); its own session, after the deploy
work. Out of scope: other kits.

## Flagged future (not scheduled)

- **M3-REMATCH** — re-enter the same room from the end screen (both players agree to re-arm); a protocol
  conversation nobody has specced. The loop closes via the create form without it (Builder OQ 2026-09-15
  #6). Flag if the owner wants it.
- **IDLE-KICK** — a forfeit/kick for a *connected* seat that never acts (M3-TIMER already holds it each
  turn, so it plays badly rather than hanging the game). Post-v1 griefing mitigation (Builder OQ
  2026-09-15 #2). Not scheduled.
- **LOBBY-TEAM-CHOICE** — let a seat choose its team; makes `wouldSeatNobody` live. Not scheduled.

## CAMO-E2E-FINISH — UNBLOCKED (low)
Before/after-delta at fixed coords (reuse `largestCluster`). Low; the rule is unit-covered.

## Routed to Designer / flags

- **Beam + axisBonus** compose legally (ruled). **Chase-preview detour** deferred (destination marker,
  not a drawn route). **Decoy as a universal obstacle** reverses R2 — Designer call. **Host-only in-lobby
  map control** / **public draft** — reversals of set-at-creation / BLIND-PICK; flag if wanted.
- **Dash melee-cover** (Designer-deferred). **Thorn's lobbed auto** (5→4 first nerf lever). **Pad tuning**
  (`everyTurns` 4→5 on iron-basin). **Kestrel out of default `CATALOG`** until BASIC-MODES.
- **UI-TIMER hot-seat auto-lock**, **touch input**, **PREVIEW-MODIFIERS shields**, **AIM-SMOOTH**,
  `killerUnitId`/`gameEnd`, **A4**, **spectators**, **`vulnerable`** — unchanged, not scheduled.

## Observed-not-requested / playtest (not Builder-blocking)

- **A real two-machine networked playtest** (now that the loop is complete — worth doing right after
  M3-DEPLOY-LIVE), **the disconnect/handoff flow** (drop a seat mid-match, watch a teammate cover, then
  reclaim), **Aegis's beam feel**, **the 40s clock feel**, **CHASE-COLLIDE**, **melee vs cover**.
