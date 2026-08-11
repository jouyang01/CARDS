# CLAUDE.md — Shared constitution for all Claude instances on this project

Every Claude session (Builder, Analyzer, Designer) reads this file first, then
`docs/GAME_SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/BACKLOG.md` before doing anything.

## What this project is

**Cards** is a free, browser-based, 1v1 simultaneous-turn tactics duel inspired by
Atlas Reactor. Two players plan in secret each turn; the turn then resolves in four
strict phases: **Prep → Dash → Blast → Move**. Full rules live in `docs/GAME_SPEC.md`.

## Golden rules (non-negotiable)

1. **The engine is pure and deterministic.** `packages/engine` may not import from the
   DOM, the network, or Node APIs, and may never use `Math.random()`, `Date.now()`,
   `new Date()`, floats for game values, or iteration over objects with unstable key
   order in a way that affects outcomes. Given the same `(state, map, orders)`,
   `resolveTurn()` must return the identical state on every machine, forever.
   All game values (HP, damage, energy, distances) are **integers**.
2. **Content is data, not code.** Characters live in `data/characters/*.json`, maps in
   `data/maps/*.json`. Adding or changing a character must not require engine changes
   unless it introduces a genuinely new mechanic — and that mechanic gets a generic,
   reusable implementation.
3. **Every engine behavior change ships with a Vitest test in the same commit.**
   No exceptions. Bug fixes ship with a regression test.
4. **Phase order is sacred.** Prep resolves before Dash, Dash before Blast, Blast
   before Move. Dashing units are immune to Blast attacks aimed at their origin
   square. Knockbacks resolve simultaneously at the end of Blast and cancel the
   victim's Move. Do not "simplify" this.
5. **Hidden information stays server-side.** Player orders are never sent to the
   opponent's client until both have locked in (or the timer fires).
6. **Small commits, descriptive messages.** One logical change per commit. Push only
   when tests pass.

## Role boundaries

| Role | Writes | Never touches |
|---|---|---|
| Builder | `packages/`, tests, `docs/DECISIONS.md` entries | Character balance numbers, backlog priorities |
| Analyzer | `docs/reviews/`, `docs/BACKLOG.md` | Source code |
| Designer | `docs/design/`, `data/` drafts | `packages/` |

When you make a judgment call the docs don't cover, append it (dated, one paragraph)
to `docs/DECISIONS.md`. When a design needs an engine capability that doesn't exist,
mark it `ENGINE ASK` — don't assume.

## Map of the repo

- `docs/GAME_SPEC.md` — the ruleset. Source of truth for game behavior.
- `docs/ARCHITECTURE.md` — tech decisions and system design.
- `docs/BACKLOG.md` — prioritized work items with acceptance criteria. Builder takes the top unblocked item.
- `docs/DECISIONS.md` — append-only log of judgment calls.
- `docs/design/edge-cases.md` — explicit rulings for simultaneous-turn edge cases. Grow it.
- `packages/engine` — pure deterministic simulation + tests. The heart of the project.
- `packages/client` — Vite + TypeScript + SVG rendering.
- `packages/server` — Cloudflare Worker + Durable Object room (built at M3).
- `data/` — characters and maps as JSON.

## Commands

- `npm install` — install everything (npm workspaces)
- `npm test` — engine test suite (Vitest)
- `npm run dev` — client dev server
- `npm run build` — production client build
- `npm run typecheck` — TypeScript across workspaces
