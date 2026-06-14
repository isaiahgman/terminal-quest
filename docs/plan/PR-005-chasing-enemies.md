# PR-005 — Enemies that hunt you on a clock
Status: ready · Depends on: PR-004 · Scope: ~M · Touches: src/game/entities.ts, src/game/update.ts, src/data/enemies.ts

## Context
The pressure that makes the game a game ([prd §6](../prd.md#6-combat--the-signature-system)): enemies advance whether or not you move — "stand still and you die."

## Goal
Merged means: enemies spawn in the world and move toward the player every tick; close enough, they charge straight in.

## Acceptance
- [ ] `enemies.ts` defines ≥1 enemy type (stats: hp, atk, speed)
- [ ] Enemies spawn at a distance and **advance toward the player each tick, independent of player input**
- [ ] Within a proximity threshold they switch to a direct charge
- [ ] Standing still results in being swarmed and taking contact damage (player hp drops)
- [ ] Enemy movement is deterministic given the seed; `pnpm typecheck` passes

## Plan
1. Enemy entity + factory; spawn a few into state.
2. In `update()`: step each enemy toward player (greedy toward player; rot.js pathfinding only if obstacles demand it).
3. Proximity → charge state.

## Constraints
- All enemy AI in `update()` (sim). Keep movement cheap (greedy first; pathfinding only if needed).

## Notes
- Contact damage formalized with stamina/attacks in PR-006; a simple per-tick contact hit is fine here.
