# TQ-017 — Diagonal (8-direction) movement
Depends on: TQ-016 · Scope: ~S · Touches: src/input/input.ts (+ src/input/input.test.ts), src/game/update.ts (+ src/game/update.test.ts)

## Context
Beta-test feedback (2026-06-15): two directions held together should move **diagonally**. Today input maps each key to a single orthogonal step and never combines them, so the `@` only goes in 4 directions. [TQ-003's note](TQ-003-movement-camera.md) already flagged this ("Decide diagonal movement now — 8-dir feels better for a swarm dodger"); this ticket is that decision, made: **yes, 8-direction.** It's the natural follow-on to [TQ-016](TQ-016-input-responsiveness.md), whose held-direction state lets us see which directions are held *at the same time*.

## Goal
Merged means: holding a horizontal and a vertical direction at once moves the player one tile diagonally per tick (true 8-direction movement).

## Acceptance
- [ ] Holding two perpendicular directions (e.g. ↑ + →) moves the player **one diagonal tile per tick** — a single intent with `dx` and `dy` both non-zero, not two separate steps.
- [ ] All 8 directions reachable (N, S, E, W + 4 diagonals); opposing keys held together resolve by **last-pressed-wins on that axis** — the more-recently-pressed of the two takes that axis (never both, never a stall). This preserves TQ-016's quick-reversal feel in the timeout tier; a pure cancel would re-introduce the ~`HELD_WINDOW_MS` standstill on reversal that TQ-016 fixed. (Decided 2026-06-17.)
- [ ] Wall behaviour is defined and tested: when the diagonal target is blocked but an orthogonal neighbour is open, the player **slides** along the wall (moves orthogonally) rather than sticking. (Decided 2026-06-17: slide, not block.)
- [ ] **Sim change required (artifact's earlier assumption was wrong):** `update()` today checks only the single combined target tile `(x+dx, y+dy)`, so a blocked diagonal makes the player *stick*. Add a minimal, tested per-axis fallback in `update()` — try the diagonal; if blocked, try `(x+dx, y)` then `(x, y+dy)`, moving to the first open one. `update()` stays pure (no I/O, deterministic).
- [ ] `npm run check` green (typecheck + strict lint + tests), incl. diagonal + wall-slide + opposing-axis (last-pressed-wins) cases.

## Plan
1. In `drain()`, after TQ-016's held-direction resolution, collapse the surviving held set into a **single** intent. Per axis, **last-pressed wins** (not a `right−left` sum): if both opposing dirs are held, the one with the more-recent `lastSeen` takes that axis. The held `Map` is already re-seated on press (recency = iteration order), which also gives a deterministic tiebreak when timestamps are equal.
2. Skip the no-op intent when both axes resolve to 0; emit exactly one move intent/tick. (The existing `input.test.ts` reversal case at L109–129 asserts *two* intents and must be rewritten to this single-intent contract.)
3. Wall-slide in `update()`: try the diagonal target; if `isWalkable` is false, try `(x+dx, y)` then `(x, y+dy)` and move to the first open tile, else stay. Add `update.test.ts` cases for a clear diagonal, a blocked-diagonal slide (each orthogonal), and a fully-boxed-in no-move.

## Constraints
- Keep the combine logic in the input layer; `update()` stays pure. One intent per tick for movement (don't regress to two sequential steps — that reads as a stutter).
- No `eslint-disable`/`any`/`@ts-ignore`.

## Notes
- Diagonal speed: combining to one tile/tick means diagonals cover √2× distance per tick (slightly faster). Acceptable for a swarm dodger; note if it needs normalising later.
- Depends on TQ-016 strictly — build it first so "which directions are held right now" is already modelled.
