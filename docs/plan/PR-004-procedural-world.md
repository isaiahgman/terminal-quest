# PR-004 — Procedural world gen + collision
Status: ready · Depends on: PR-003 · Scope: ~M · Touches: src/game/world/generate.ts, src/game/rng.ts, src/game/update.ts

## Context
The open-feeling world ([prd §7](../prd.md#7-world--progression), [tdd §7](../tdd.md#7-world-gen--camera)) via rot.js. Accepted that hand-authoring a big world is the bottleneck → procedural.

## Goal
Merged means: a large seeded walkable world generates with obstacles, the player spawns on open ground, and walls block movement.

## Acceptance
- [ ] `rng.ts` exposes a seeded RNG wrapping rot.js (same seed → same world)
- [ ] `generate.ts` produces a large map (≥ several screens) with walkable/blocked tiles
- [ ] Player spawns on a walkable tile; **collision** prevents walking through walls
- [ ] Same seed reproduces the identical map (logged/verifiable)
- [ ] `pnpm typecheck` passes

## Plan
1. Seed the RNG; generate with a rot.js map generator (cellular for caverns, or open field + scattered obstacles).
2. Store tiles in `world`; add a `isWalkable(pos)` check used by movement in `update()`.

## Constraints
- Generation must be deterministic from the seed (needed for save/resume in PR-012). Pure given a seed.

## Notes
- Tune density so it reads as "open world with cover," not a maze.
