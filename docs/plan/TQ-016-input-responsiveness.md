# TQ-016 — Responsive held-direction movement (decouple from OS key-repeat)
Status: in progress (#32) · Depends on: TQ-003 · Scope: ~S · Touches: src/input/input.ts (+ src/input/input.test.ts), maybe src/game/config.ts

## Context
Beta-test feedback (2026-06-15): holding a direction works, but movement **fires once, stalls for ~½–1 s, then starts repeating**. Root cause is the input model in [`src/input/input.ts`](../../src/input/input.ts): it's "repeat on press" and leans on the **OS keyboard auto-repeat** stream to keep moving. Terminals emit key-DOWN only (no key-up — [tdd input gotcha](../tdd.md)), and the OS inserts a long *initial-repeat delay* before auto-repeat kicks in. That gap is the stall: first press → one move → silence until the OS starts repeating → continuous. The movement cadence is also hostage to each user's OS keyboard settings instead of the game's 15 fps tick.

## Goal
Merged means: pressing and holding a direction starts moving on the next tick and **keeps moving smoothly with no mid-stall**, at the game's tick cadence — independent of the OS auto-repeat delay/rate.

## Acceptance
- [ ] Holding a direction produces continuous movement with **no initial stall** (no "move once, pause, then go"); movement begins on the first tick after the keypress.
- [ ] Movement cadence is driven by the game loop (`SIM_DT`, 15/s), not the OS key-repeat rate — verified by the input unit test, not by feel.
- [ ] Releasing a key stops movement within a bounded, documented window (the coast-after-release tradeoff; see Notes).
- [ ] The "held" window is a single **named constant** (tunable; lives in `config.ts` if that file exists, else top of `input.ts`).
- [ ] `update()` stays pure and unchanged; all new logic is in the input layer. Intents remain the only thing crossing into the sim.
- [ ] `npm run check` green (typecheck + strict lint + tests), incl. new `input.test.ts` cases. No rule disables.

## Plan
1. Replace the fire-and-forget intent buffer with **held-direction state**: each key event records the direction + a "last seen at" tick/timestamp.
2. A direction counts as *held* for `HELD_WINDOW_MS` after its most recent key event. Size the window slightly **above** the typical OS initial-repeat delay so the pre-auto-repeat gap is bridged (kills the stall); keep it small enough that release feels prompt.
3. On `drain()` (once per tick), emit a move intent for each still-held direction; expire stale directions.
4. Unit-test with an injected clock: one keypress → moves for the window then stops; repeated "auto-repeat" events keep it moving with no gap; cadence matches ticks, not event spacing.

## Constraints
- Input layer only — do **not** move timing logic into `update()`/`loop.ts`; the simulation must stay deterministic and pure (no wall-clock inside `update()`).
- No `eslint-disable`/`any`/`@ts-ignore`. Inject the clock (don't call `performance.now()` straight in logic) so the behaviour is testable.

## Notes
- Terminals have no key-up, so "release" is inferred by timeout — there's an unavoidable short **coast after release** (~one window). Document the chosen window; it's the cost of removing the stall. (If coast feels bad, the lever is window size, not architecture.)
- Pairs with [TQ-017](TQ-017-diagonal-movement.md) (diagonals): the held-direction state this introduces is exactly what diagonal-combining needs, so do 016 first.
