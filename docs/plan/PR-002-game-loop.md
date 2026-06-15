# PR-002 — Fixed-timestep game loop
Status: merged · Depends on: PR-001 · Scope: ~M · Touches: src/game/loop.ts, src/game/update.ts, src/cli.ts

## Context
The heartbeat ([tdd §3](../tdd.md#3-game-loop)) — the real-time clock that later makes enemies advance whether you move or not.

## Goal
Merged means: a fixed-timestep loop runs `update()` then renders at ~12–15 fps, with clean start/stop.

## Acceptance
- [ ] `loop.ts` runs at a fixed tick (~66–80 ms); each tick: gather intents → `update(state, intents, dt, rng)` → render
- [ ] `update()` is pure (returns new/advanced state; no I/O, no drawing)
- [ ] A visible proof of life animates each tick (e.g., a tick counter or moving glyph)
- [ ] Loop stops cleanly on quit; no dangling timers; terminal restored
- [ ] `pnpm typecheck` passes

## Plan
1. `update(state, intents, dt, rng) → state` stub that advances something visible.
2. `loop.ts`: fixed-timestep scheduler calling update + render; stop on quit.
3. Wire from `cli.ts`.

## Constraints
- Keep update/render decoupled. No game rules in `loop.ts` — it only schedules.

## Notes
- Prefer a self-correcting timer (track elapsed) over naive `setInterval` to avoid drift.
