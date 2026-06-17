# TQ-003 — Player movement + following camera
Status: merged · Depends on: TQ-002 · Scope: ~M · Touches: src/input/input.ts, src/game/update.ts, src/game/entities.ts, src/game/world/camera.ts, src/render/renderer.ts

## Context
First interactivity + the camera that makes a world bigger than the screen feel open ([prd F1](../prd.md#10-features), [tdd §7](../tdd.md#7-world-gen--camera)).

## Goal
Merged means: arrow/WASD moves the player around a world larger than the screen, and the camera follows, centered and clamped to bounds.

## Acceptance
- [ ] `input.ts` maps arrow/WASD → movement intents
- [ ] Player entity moves on the grid in response; movement happens in `update()`
- [ ] Camera centers on the player and **clamps** at world edges (no black past bounds)
- [ ] Renderer draws only the camera viewport; a larger-than-screen world scrolls smoothly
- [ ] `pnpm typecheck` passes

## Plan
1. Add `player.pos` to state + a Player factory.
2. Input → intents → `update()` moves player.
3. `camera.ts`: compute viewport from player pos + world size; renderer uses it.

## Constraints
- Movement logic lives in `update()` (sim), not input or render. Grid-based (whole-tile) movement only.

## Notes
- Decide diagonal movement now (8-dir feels better for a swarm dodger).
