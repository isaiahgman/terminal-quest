# TQ-004 — Procedural world gen + collision
Status: in progress (sliced — see Slicing) · Depends on: TQ-003 · Scope: ~M · Touches: src/game/world/generate.ts, src/game/rng.ts, src/game/update.ts, src/cli.ts

## Context
The open-feeling world ([prd §7](../prd.md#7-world--progression), [tdd §7](../tdd.md#7-world-gen--camera)) via rot.js. Accepted that hand-authoring a big world is the bottleneck → procedural.

## Goal
Merged means: a large seeded walkable world generates with obstacles, the player spawns on open ground, and walls block movement.

## Acceptance
**TQ-004a — pure generator (this PR):**
- [x] `generate.ts` produces walkable/blocked tiles at any requested size — `generateWorld(width, height, seed)`; positive-integer dims validated, deterministic, fully-traversable (independent flood-fill test)
- [x] Same seed reproduces the identical map (verified, incl. resilience to interleaved generations)
- [x] `npm typecheck`/`check` passes

**TQ-004b — RNG wrapper + collision wiring (follow-up):**
- [x] `rng.ts` exposes a seeded RNG wrapping rot.js (localizes the global-RNG side effect — see Constraints) — landed; `cli.ts` is its first consumer (deterministic spawn pick)
- [x] `generate.ts` called with **large** dimensions (≥ several screens) from the integration layer — `cli.ts` generates a `term.width*2 × term.height*2` world
- [x] Player spawns on a walkable tile; **collision** prevents walking through walls (via `isWalkable` in `update()`)

## Plan
1. Seed the RNG; generate with a rot.js map generator (cellular for caverns, or open field + scattered obstacles).
   - **rot.js map generators read the _global_ `ROT.RNG` singleton, not an injected instance.** The `Rng` wrapper (TQ-004b's seeded RNG, `src/game/rng.ts`) clones an independent generator, so constructing one does NOT seed map gen. Before generating, call `RNG.setSeed(worldSeed)` (import `{ RNG } from 'rot-js'`) so the map is deterministic from the world seed — otherwise it defaults to `Date.now()` and differs every launch, breaking this PR's "same seed → same world" acceptance and TQ-012 resume.
2. Store tiles in `world`; add a `isWalkable(pos)` check used by movement in `update()`.

## Constraints
- Generation must be deterministic from the seed (needed for save/resume in TQ-012). TQ-004a is deterministic but reseeds rot.js' **global** RNG as a side effect; TQ-004b's `rng.ts` wrapper localizes that so generation is pure, not just deterministic.

## Notes
- Tune density so it reads as "open world with cover," not a maze. (TQ-004a settles at ~75% floor; tests bracket the band and assert walls exist.)

## Slicing
TQ-004 split into atomic PRs (mirrors TQ-006 → TQ-007):
- **TQ-004a** = the pure `generateWorld` (this PR) — render/input-agnostic, no shared files touched.
- **TQ-004b** = `rng.ts` seeded wrapper + spawn + collision wiring. Collision is `isWalkable` in `update.ts` (already present); the integration (large-world gen + seeded spawn pick) lands in `cli.ts`.
