# PR-004 — Procedural world gen + collision
Status: in progress (sliced — see Slicing) · Depends on: PR-003 · Scope: ~M · Touches: src/game/world/generate.ts, src/game/rng.ts, src/game/update.ts

## Context
The open-feeling world ([prd §7](../prd.md#7-world--progression), [tdd §7](../tdd.md#7-world-gen--camera)) via rot.js. Accepted that hand-authoring a big world is the bottleneck → procedural.

## Goal
Merged means: a large seeded walkable world generates with obstacles, the player spawns on open ground, and walls block movement.

## Acceptance
**PR-004a — pure generator (this PR):**
- [x] `generate.ts` produces walkable/blocked tiles at any requested size — `generateWorld(width, height, seed)`; positive-integer dims validated, deterministic, fully-traversable (independent flood-fill test)
- [x] Same seed reproduces the identical map (verified, incl. resilience to interleaved generations)
- [x] `npm typecheck`/`check` passes

**PR-004b — RNG wrapper + collision wiring (follow-up):**
- [ ] `rng.ts` exposes a seeded RNG wrapping rot.js (localizes the global-RNG side effect — see Constraints) — *being built on the `pr-rng-seeded` branch*
- [ ] `generate.ts` called with **large** dimensions (≥ several screens) from the integration layer
- [ ] Player spawns on a walkable tile; **collision** prevents walking through walls (via `isWalkable` in `update()`)

## Plan
1. Seed the RNG; generate with a rot.js map generator (cellular for caverns, or open field + scattered obstacles).
2. Store tiles in `world`; add a `isWalkable(pos)` check used by movement in `update()`.

## Constraints
- Generation must be deterministic from the seed (needed for save/resume in PR-012). PR-004a is deterministic but reseeds rot.js' **global** RNG as a side effect; PR-004b's `rng.ts` wrapper localizes that so generation is pure, not just deterministic.

## Notes
- Tune density so it reads as "open world with cover," not a maze. (PR-004a settles at ~75% floor; tests bracket the band and assert walls exist.)

## Slicing
PR-004 split into atomic PRs (mirrors PR-006 → PR-007):
- **PR-004a** = the pure `generateWorld` (this PR) — render/input-agnostic, no shared files touched.
- **PR-004b** = `rng.ts` seeded wrapper (`pr-rng-seeded` branch) + spawn + collision wiring into `update.ts`.
