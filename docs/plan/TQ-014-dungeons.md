# TQ-014 — High-risk/high-reward dungeons
Status: ready · Depends on: TQ-011 · Scope: ~M · Touches: src/game/world/generate.ts, src/game/update.ts, src/data/enemies.ts

## Context
Depth in the world ([prd §7](../prd.md#7-world--progression)): optional pockets with denser danger and better loot — the risk/reward choice that makes exploring meaningful.

## Goal
Merged means: dungeon entrances exist in the world; entering swaps you into a denser, more dangerous area with better rewards; clearing/exiting returns you to the world.

## Acceptance
- [ ] Dungeon entrances are placed in the world and visibly distinct
- [ ] Entering generates/loads a dungeon area with **higher enemy density + better drops**
- [ ] Exiting (or clearing) returns the player to the prior world location
- [ ] Dungeon state interacts cleanly with save (TQ-012)
- [ ] `pnpm typecheck` passes

## Plan
1. Mark entrances during world gen.
2. On enter: push a dungeon sub-world (seeded); on exit: pop back.
3. Tune density/loot tables for higher risk + reward.

## Constraints
- Reuse the same combat/enemy/loot systems — a dungeon is tuned parameters + a context switch, not a new engine.

## Notes
- A guaranteed good weapon drop makes dungeons worth the risk and feeds TQ-010.
