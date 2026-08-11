# Cards

A free, browser-based, **1v1 simultaneous-turn tactics duel** in the spirit of Atlas
Reactor. Both players plan in secret; the turn resolves in four strict phases —
**Prep → Dash → Blast → Move** — so every turn is a read on your opponent.

Built AI-first: separate Claude instances (Builder / Analyzer / Designer) work
through this repo. Start with [`CLAUDE.md`](./CLAUDE.md), then:

- [`docs/GAME_SPEC.md`](./docs/GAME_SPEC.md) — the ruleset
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — deterministic engine + $0 hosting design
- [`docs/BACKLOG.md`](./docs/BACKLOG.md) — what to build next
- [`docs/design/edge-cases.md`](./docs/design/edge-cases.md) — simultaneity rulings

## Quickstart

```bash
npm install
npm test        # engine test suite
npm run dev     # client dev server → http://localhost:5173
npm run build   # production client build
```

## Status

**M0 (scaffold)** — complete. Repo structure, specs, seeded backlog, engine types +
content validation with passing tests, map renderer, CI, Pages deploy workflow.
Next: **M1 — engine core** (Backlog items 1–12).

## Milestones

M0 scaffold → M1 deterministic engine → M2 local playable → **M3 online with room
codes** → M4 three-character roster → M5 feel & fairness → M6+ catalysts, mods, 2v2.
