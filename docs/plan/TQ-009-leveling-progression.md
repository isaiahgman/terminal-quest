# TQ-009 — Leveling + power curve (pure)
Depends on: TQ-006 · Scope: ~M · Touches: src/game/progression.ts, src/game/progression.test.ts, src/game/update.ts

## Context
**The dopamine engine** ([prd §2](../prd.md#2-the-feeling-were-chasing-the-real-spec)). This is where the "impossible → trivial" Solo-Leveling delta is manufactured. The most important *feel* PR.

## Goal
Merged means: kills grant XP, XP levels you up, level-ups grow your stats — and the curve is tuned + tested so power growth feels earned then explosive.

## Acceptance
- [ ] `progression.ts` (pure): `gainXp`, `xpToNext(level)`, `applyLevelUp` granting hp/stamina/damage growth
- [ ] Killing an enemy awards XP; crossing the threshold levels up and increases stats
- [ ] Curve documented with the intended *feel* (early grind → later power spike)
- [ ] `progression.test.ts` covers: xp accrual, multi-level-up in one gain, stat growth, curve monotonicity
- [ ] `npm run test` passes

## Plan
1. Implement pure progression fns + curve constants in `config.ts`.
2. Hook kill → `gainXp` in `update()`.
3. Tests with concrete numbers asserting the power delta.

## Constraints
- Pure + isolated so numbers can be tuned fast without touching the loop. No rendering here.

## Notes
- Expect to iterate the constants by *playing*. Keep all knobs in `config.ts` for fast tuning.
