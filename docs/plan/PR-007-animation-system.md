# PR-007 — Animation system
Status: ready · Depends on: PR-006 · Scope: ~M · Touches: src/hooks/useAnimation.ts, src/art/fx.ts, src/screens/BattleScreen.tsx, src/components/HealthBar.tsx

## Context
Delivers the "feels alive" promise ([prd F5](../prd.md#6-features-mvp), [tdd §7](../tdd.md#7-animation)) — the signature of this project.

## Goal
Merged means: attacks play multi-frame ASCII animations and HP bars tween instead of snapping.

## Acceptance
- [ ] `useAnimation(frames, fps, {loop})` returns `{frame, done}` and advances on a timer
- [ ] Battle gains an `animate` phase: choosing an action plays attack frames, *then* damage resolves
- [ ] At least 3 effects in `fx.ts`: attack swing, hit/flinch, faint
- [ ] `HealthBar` animates the displayed value toward the target over a few frames
- [ ] fps capped (~12); no perceptible input lag; clean unmount (no dangling timers)
- [ ] `pnpm typecheck` passes

## Plan
1. `useAnimation` with `setInterval`/`setTimeout` + cleanup on unmount.
2. Author frame arrays in `fx.ts`.
3. Insert `animate` phase between `choose` and `resolve` in the battle flow.
4. Make `HealthBar` ease its rendered value.

## Constraints
- Always clear timers on unmount. Keep frames ≤ 6. Engine stays untouched — animation is a UI concern layered on top.

## Notes
- If timing feels janky, lower fps before adding frames.
