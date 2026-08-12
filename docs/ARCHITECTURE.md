# ARCHITECTURE.md — Cards

## The core decision

The game is a **pure, deterministic simulation engine** in TypeScript
(`packages/engine`), shared verbatim by client and server:

```
resolveTurn(state: GameState, map: MapDef, orders: PlayerOrders[]): TurnResult
```

No randomness, no wall clock, no I/O, integer math only. Given identical inputs,
identical outputs on every machine. Consequences:

- **Netcode syncs orders, not state.** A turn is a few hundred bytes. Both clients
  (and the server, as authority) run the same `resolveTurn` and stay in lockstep.
- **Everything is testable.** The Analyzer enforces spec compliance with unit tests
  against pure functions.
- **Replays are free.** A match = initial state + order log. The determinism test
  replays a recorded match and asserts a stable final-state hash.

## Teams vs. players

The engine models **two teams** of N units each; it never knows how many humans are
playing. Formats (2v2 default, 4v4, 1v1 dev — GAME_SPEC §1) set characters per team;
each player controls 1 or 2 characters on one team. The **room layer owns the
player → character control map**: it collects each player's submission, merges them
into one `PlayerOrders` (per-team order set), and only then calls `resolveTurn`. A
3-player 2v2 and a 2-player 2v2 therefore produce byte-identical engine inputs.
Per-player concerns — lock-in, decision timer, Time Bank, disconnects — all live in
the room layer too.

## Stack ($0 hosting)

| Layer | Choice |
|---|---|
| Engine | TypeScript, zero runtime dependencies, Vitest |
| Client | Vite + TypeScript, SVG rendering (no game framework) |
| Server | Cloudflare Worker + one Durable Object per room, WebSockets (M3) |
| Client hosting | GitHub Pages via GitHub Actions |
| Fallback netcode | PeerJS (WebRTC) — only if Workers ever becomes unviable |

## Match flow (from M3)

1. Player A: "Create room" → picks a format (default 2v2) → Worker mints a 4-letter
   code, spins up a Durable Object.
2. 2–8 players join with the code (bounds per format — GAME_SPEC §1). In the lobby,
   each player takes a team seat and claims 1 or 2 of that team's characters; the DO
   stores the control map and holds authoritative state.
3. Each turn: every player submits orders for the characters they control over
   WebSocket. The DO reveals **nothing to the opposing team** until all players have
   locked or the timer fires (hidden information lives here); teammates' plans are
   mirrored to each other.
4. DO merges per-player submissions into the two per-team order sets, broadcasts
   them; clients and DO each run `resolveTurn`; clients animate the four phases
   sequentially from the returned event log.
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
