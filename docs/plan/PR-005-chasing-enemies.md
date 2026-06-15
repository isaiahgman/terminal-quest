# PR-005 — Enemies that hunt you on a clock
Status: in progress · Depends on: PR-004 · Scope: ~M · Touches: src/game/enemy.ts, src/game/entities.ts, src/game/update.ts

## Context
The pressure that makes the game a game ([prd §6](../prd.md#6-combat--the-signature-system)): enemies advance whether or not you move — "stand still and you die."

## Goal
Merged means: enemies spawn in the world and move toward the player every tick; close enough, they charge straight in.

## Acceptance
- [x] `enemy.ts` defines ≥1 enemy type (stats: hp, atk, speed) — *the data-only slice; see Notes*
- [x] Enemies **advance toward the player each tick, independent of player input** — pure `stepEnemy()` in `entities.ts` (greedy step on a tiles/sec move budget); wiring the result into `update()` is the integration slice
- [x] Within a proximity threshold they switch to a direct charge — `CHARGE_RADIUS` + `phase: 'advance' | 'charge'` in `entities.ts`
- [x] Standing still results in taking contact damage — `contactDamage()` returns the enemy's `atk` when within one tile (player-hp drop applied when wired into `update()`)
- [x] Enemy movement is deterministic (no `Math.random`/I/O); `npm run check` passes

## Plan
1. Enemy entity + factory; spawn a few into state.
2. In `update()`: step each enemy toward player (greedy toward player; rot.js pathfinding only if obstacles demand it).
3. Proximity → charge state.

## Constraints
- All enemy AI in `update()` (sim). Keep movement cheap (greedy first; pathfinding only if needed).

## Notes
- Contact damage formalized with stamina/attacks in PR-006; a simple per-tick contact hit is fine here.
- **Slicing:** shipped as multiple small PRs. The first (the enemy data model — `Enemy` type, `createEnemy`, `ENEMY_TYPES`) lands in a single dependency-free leaf, `src/game/enemy.ts`, touching no shared files. The second (this PR) adds the **enemy AI stepping** — also a pure, dependency-free leaf, `src/game/entities.ts`: `stepEnemy()` (greedy advance on a per-enemy tiles/sec move budget), `CHARGE_RADIUS` + the `advance | charge` phase, and `contactDamage()`. It takes the player target, a walkability predicate, and `dt` as injected inputs (mirroring `combat.ts`), so it is fully unit-tested ahead of touching the shared loop. Wiring it into `update()` — `enemies[]` + per-enemy AI on `GameState`, player `hp`, applying contact damage — is the **sequential integration slice** (a separate PR, the chokepoint noted in CLAUDE.md). Rendering lands after that. This consolidates what the TDD §4 originally split across `entities.ts` + `data/enemies.ts` — recorded with rationale in TDD §12.
