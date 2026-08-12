# ARCHITECTURE.md — Cards

## Direction (v1 → later)

Cards is a simultaneous-turn PvP tactics duel (1v1 now; 2v2/3v3 later — never hardcode
single-unit assumptions). One character controlled per player in v1 (two later). 2D SVG
visuals now; the engine emits an event log so a 3D renderer can be swapped in later
without touching game logic. Every layer below is built to that shape: the engine takes
**unit lists, not single-unit fields**, and the client is a pure consumer of the
`TurnEvent[]` log, never a re-implementation of game rules.

## The core decision

The game is a **pure, deterministic simulation engine** in TypeScript
(`packages/engine`), shared verbatim by client and server:

```
resolveTurn(state: GameState, map: MapDef, orders: [PlayerOrders, PlayerOrders], roster: Roster): TurnResult
```

The fourth argument, `roster`, is a read-only index from `characterId`/`abilityId` to
`AbilityDef`s, built once from `data/characters/*.json`. It lets the pipeline find an
order's phase, range, cooldown and ultimate cost without fattening `GameState` — content
is data, not state (golden rule #2), and the netcode still syncs only orders. Rationale
in `docs/DECISIONS.md` (2026-08-12, turn pipeline skeleton).

No randomness, no wall clock, no I/O, integer math only. Given identical inputs,
identical outputs on every machine. Consequences:

- **Netcode syncs orders, not state.** A turn is a few hundred bytes. Both clients
  (and the server, as authority) run the same `resolveTurn` and stay in lockstep.
- **Everything is testable.** The Analyzer enforces spec compliance with unit tests
  against pure functions.
- **Replays are free.** A match = initial state + order log. The determinism test
  replays a recorded match and asserts a stable final-state hash.

## Stack ($0 hosting)

| Layer | Choice |
|---|---|
| Engine | TypeScript, zero runtime dependencies, Vitest |
| Client | Vite + TypeScript, SVG rendering (no game framework) |
| Server | Cloudflare Worker + one Durable Object per room, WebSockets (M3) |
| Client hosting | GitHub Pages via GitHub Actions |
| Fallback netcode | PeerJS (WebRTC) — only if Workers ever becomes unviable |

## Match flow (from M3)

1. Player A: "Create room" → Worker mints a 4-letter code, spins up a Durable Object.
2. Player B joins with the code. Both pick characters. DO holds authoritative state.
3. Each turn: clients submit `PlayerOrders` over WebSocket. The DO reveals **nothing**
   until both have locked or the timer fires (hidden information lives here).
4. DO broadcasts both order sets; clients and DO each run `resolveTurn`; clients
   animate the four phases sequentially from the returned event log.
5. **Reconnects:** the DO keeps initial state + full order history. A refreshed
   browser rejoins by room code and replays to current. Build this at M3, not later.

## Rendering (client)

- SVG grid; CSS classes for terrain; simple shapes/icons for characters.
- Targeting UI draws ability shapes (line/cone/circle/path/square) as translucent
  overlays during Decision; opponent sees nothing.
- Resolution playback: the engine returns an ordered **event log**
  (`TurnEvent[]` — ability fired, damage dealt, unit moved square-by-square, status
  applied, death, respawn...). The client animates events phase by phase. The event
  log is the rendering contract — renderer never re-derives game logic.

## Repository layout

See CLAUDE.md. Engine imports nothing from client/server. Client and server both
import engine. `data/` JSON is imported at build time (client) and bundled (server).

## CI/CD

- `ci.yml`: on every push/PR — install, engine tests, typecheck, client build.
- `deploy-pages.yml`: on push to main — build client with the repo-name base path,
  deploy to GitHub Pages. Requires Pages set to "GitHub Actions" in repo settings.
- Server deploys via `wrangler deploy` manually at M3 (workflow added then).
