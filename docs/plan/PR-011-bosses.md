# PR-011 — Bosses + win condition
Status: ready · Depends on: PR-007, PR-009 · Scope: ~M · Touches: src/data/bosses.ts, src/game/entities.ts, src/game/update.ts

## Context
The goal of the game ([prd §7](../prd.md#7-world--progression)): 10 bosses scattered across the world; hard to reach, hard to beat; all 10 down = win.

## Goal
Merged means: bosses exist as tough placed entities, defeating one increments progress, and clearing all 10 triggers victory. (Ship with 1–2 real, the framework for 10.)

## Acceptance
- [ ] `bosses.ts` defines bosses with id, name, high hp/damage, and a signature behavior
- [ ] Bosses are placed at fixed/seeded world locations (not random swarm spawns)
- [ ] Defeating a boss sets `defeated` and increments `bossesDefeated`; HUD reflects `n/10`
- [ ] Defeating **all** bosses triggers a victory state
- [ ] Adding the remaining bosses is pure data (no code change); `pnpm typecheck` passes

## Plan
1. Boss type extends Enemy; author 1–2 fully, leave data slots for 10.
2. Seeded placement across the map (far apart, gated by difficulty/distance).
3. Win check in `update()` when all defeated.

## Constraints
- Bosses must be **data-driven** so reaching 10 is authoring, not engineering. Reuse enemy AI + combat engine; only the signature behavior is special.

## Notes
- Tune so an under-leveled player loses but a ground-out player wins — that's the Solo-Leveling payoff. Validate against the PR-009 curve.
