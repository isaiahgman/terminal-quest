# TQ-017 — Diagonal (8-direction) movement
Status: ready · Depends on: TQ-016 · Scope: ~S · Touches: src/input/input.ts (+ src/input/input.test.ts)

## Context
Beta-test feedback (2026-06-15): two directions held together should move **diagonally**. Today input maps each key to a single orthogonal step and never combines them, so the `@` only goes in 4 directions. [TQ-003's note](TQ-003-movement-camera.md) already flagged this ("Decide diagonal movement now — 8-dir feels better for a swarm dodger"); this ticket is that decision, made: **yes, 8-direction.** It's the natural follow-on to [TQ-016](TQ-016-input-responsiveness.md), whose held-direction state lets us see which directions are held *at the same time*.

## Goal
Merged means: holding a horizontal and a vertical direction at once moves the player one tile diagonally per tick (true 8-direction movement).

## Acceptance
- [ ] Holding two perpendicular directions (e.g. ↑ + →) moves the player **one diagonal tile per tick** — a single intent with `dx` and `dy` both non-zero, not two separate steps.
- [ ] All 8 directions reachable (N, S, E, W + 4 diagonals); opposing keys held together cancel on that axis (no jitter).
- [ ] Wall behaviour is defined and tested: when the diagonal target is blocked but an orthogonal neighbour is open, the player **slides** along the wall (moves orthogonally) rather than sticking. (If we instead choose "block diagonal entirely," state that — but pick one and test it.)
- [ ] `update()` already accepts arbitrary `dx`/`dy` and checks `isWalkable` — confirm no sim change is needed (or keep any change minimal and tested).
- [ ] `npm run check` green (typecheck + strict lint + tests), incl. diagonal + wall-slide cases.

## Plan
1. In `drain()`, after TQ-016's held-direction resolution, collapse the held set into a **single** intent: `dx = (right?1:0) - (left?1:0)`, `dy = (down?1:0) - (up?1:0)`.
2. Skip the no-op intent when both are 0; emit one move/tick.
3. For wall-slide: if diagonal blocked, let `update()`'s per-axis walkability fall through to the open orthogonal — verify current `update()` does this, or adjust the intent/`update()` minimally and test.

## Constraints
- Keep the combine logic in the input layer; `update()` stays pure. One intent per tick for movement (don't regress to two sequential steps — that reads as a stutter).
- No `eslint-disable`/`any`/`@ts-ignore`.

## Notes
- Diagonal speed: combining to one tile/tick means diagonals cover √2× distance per tick (slightly faster). Acceptable for a swarm dodger; note if it needs normalising later.
- Depends on TQ-016 strictly — build it first so "which directions are held right now" is already modelled.
