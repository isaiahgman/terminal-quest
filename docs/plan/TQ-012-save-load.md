# TQ-012 — Save / autosave
Depends on: TQ-004, TQ-009 · Scope: ~M · Touches: src/save/save.ts, src/cli.ts, src/game/loop.ts

## Context
Persistence ([prd §8](../prd.md#8-save), [tdd §9](../tdd.md#9-save)): drop the player back exactly where they were, and make progression *persistent* (roguelite).

## Goal
Merged means: the game autosaves and, on relaunch, restores the player's location, status, weapon, world (via seed), level, and bosses defeated.

## Acceptance
- [ ] `save.ts` serializes/deserializes the save fields to `~/.terminal-quest/save.json`
- [ ] **Autosave** on interval + key events (boss kill, weapon equip)
- [ ] On launch: existing save → resume exactly (same world from seed, same position/stats); no save → new game
- [ ] World reconstructs deterministically from the saved seed (relies on TQ-004 determinism)
- [ ] Corrupt/missing save handled gracefully (start fresh, no crash); `npm run typecheck` passes

## Plan
1. Define the serializable save shape; write/read JSON in `~/.terminal-quest/`.
2. Autosave hook in the loop + on events; load in `cli.ts` before starting.
3. Rebuild world from seed on load.

## Constraints
- Save **the seed**, not the whole tile array, to keep saves small (world is deterministic). Never block the game loop on disk I/O (write async/throttled).

## Notes
- Enemies/pickups can respawn from seed+rules on load; only persist what's needed to resume the *feel*.
