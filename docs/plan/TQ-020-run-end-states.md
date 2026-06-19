# TQ-020 — Run end-states: defeat + victory (the loop's stakes)

Depends on: TQ-008, TQ-011 · Scope: ~M (ships as ~2 small PRs) · Touches: src/game/state.ts, src/game/update.ts, src/game/loop.ts, src/render/

## Context

This ticket exists because an audit (2026-06-19) found that **the game has no terminal states**, even though both are core spec:

- [prd §5](../prd.md#5-core-loop-moment-to-moment): "stand still and **you die**." [prd §13](../prd.md#13-definition-of-done-v1--mvp) DoD: "standing still kills you."
- [prd §7](../prd.md#7-world--progression): "All 10 down → you win."

In the code today:

- `player.hp` is floored at 0 (`update.ts`) but **nothing reads it** — there is no `'defeat'` status, no game-over, no halt. A dead player keeps playing at 0 hp forever, taking 0-damage hits. The "stand still and die" pressure is, mechanically, absent.
- `status: 'victory'` **is** set by the sim when the boss roster is cleared (TQ-011 PR1), but TQ-011's planned **PR3 — "render YOU WIN + halt the loop"** never shipped. So victory is invisible and the loop keeps running.

These were each deferred by their original ticket (death "lands with TQ-011 / death handling"; the victory screen "ships in a later TQ-011 PR") and then orphaned — no ticket owned them. This ticket owns both, because they share one mechanism: **a run-ending status the renderer shows and the loop honors.**

## Goal

Merged means: when the player's hp hits 0 the run ends with a visible defeat screen, when the last boss falls the run ends with a visible victory screen, and in both cases the simulation loop halts (no more enemy turns) until the player acts (quit / restart). The sim stays pure: it only _sets_ the status; render and loop _react_.

## Decisions for Isaiah (please resolve before implementation)

1. **What does death actually do?** [prd §7](../prd.md#7-world--progression) says _"Death returns you to base; you keep your growth"_ — i.e. roguelite, not permadeath. But the **base doesn't exist yet** (TQ-013, todo), so there is no "base" to return to. Options:
   - **(a) Interim defeat screen + halt now** (recommended): a "YOU DIED" screen, progress already persisted by autosave, loop halts; relaunch starts a fresh run from the saved progression. Wire the true _respawn-at-base_ when TQ-013 lands. Smallest honest step; unblocks the missing stakes immediately.
   - **(b) Respawn-at-spawn now:** on death, relocate the player to a fresh `pickSpawn`, refill hp, keep progression — a stand-in "base" until TQ-013. Closer to the §7 fantasy but invents a placeholder respawn rule we'd later replace.
   - This artifact assumes (a) unless you choose otherwise; it's a one-line change in the plan either way.
2. **Does a halted run accept input?** Recommended: only `q`/Ctrl-C (quit) on an end-screen; ignore movement/attacks. (A full "press R to restart in-process" is its own small follow-up — the input layer has no in-process reset yet; see TQ-019 notes.)
3. **Does defeat clear the save?** Recommended **no** — autosave already holds your progression, and roguelite means you keep growth. (If death should _cost_ something, that's a balance decision for TQ-023.)

## Acceptance

- [ ] `GameStatus` gains `'defeat'` (now `'playing' | 'victory' | 'defeat'`), documented in `state.ts`
- [ ] `update()` sets `status: 'defeat'` once `player.hp <= 0` (sticky, like `'victory'`); a state already in an end-status is a no-op tick (enemies don't keep moving/biting)
- [ ] The renderer draws a centered, unmistakable overlay for each end-status (e.g. "YOU DIED" / "YOU WIN — all bosses defeated") over the frozen final frame, without corrupting the viewport/HUD
- [ ] `loop.ts` stops advancing the sim when `status !== 'playing'` (it may keep rendering the end-screen); quit still works
- [ ] No regression to the pure-sim/read-only-render bet; `npm run check` passes; new sim behavior is unit-tested (hp→0 ⇒ defeat; defeated/victory tick is inert)

## Plan (2 small PRs)

1. **PR 1 — sim (pure):** add `'defeat'` to `GameStatus`; in `update()`, after contact damage, set `status = 'defeat'` when `hp <= 0`; make `update()` an early-return no-op when `state.status` is already terminal (so a halted loop that still ticks can't mutate). Unit tests. No render/loop touch.
2. **PR 2 — present + halt:** `renderer.ts` end-state overlay; `loop.ts` skips `update()` while `status !== 'playing'`. This is the chokepoint pair (`renderer.ts`/`loop.ts`) — keep it one PR, sequenced after any other in-flight render work.

## Constraints

- **Sim sets, render/loop react.** `update()` must not know about screens or halting — it only flips `status`. The renderer reads it; the loop honors it. This preserves the §2 architecture bet.
- Keep `GameStatus` a plain string union (serializable) so TQ-022 can persist it without ceremony.
- The end-state overlay must use the same delta-draw/synchronized-output path as the HUD — no full clears (flicker).

## Notes

- This pairs naturally with **TQ-022** (persist `status`): once a run can _end_, a resumed save should know whether it ended (so a won/lost run doesn't silently resume as playable). Sequence TQ-022 alongside or just after this.
- Interaction to watch (see **TQ-023**): contact damage is currently flat-per-tick, so with death live the early game may spike-kill before it's tuned. Land death first to make the stakes real, then tune the curve with the HUD visible.
- The victory half is literally TQ-011's unshipped PR3; this ticket absorbs it so both end-states live in one coherent render/halt path instead of two half-built ones.
