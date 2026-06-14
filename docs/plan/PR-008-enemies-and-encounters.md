# PR-008 — Enemies + encounters
Status: ready · Depends on: PR-005 · Scope: ~S · Touches: src/data/enemies.ts, src/art/portraits.ts

## Context
The opposition ([prd F6](../prd.md#6-features-mvp)). Pure data consumed by the engine + battle screen.

## Goal
Merged means: 3 standard enemies + 1 boss exist as data, each with stats, AI, abilities, and ASCII art.

## Acceptance
- [ ] `enemies.ts` exports 3 enemies (e.g. Goblin, Slime, Skeleton) + 1 boss (e.g. Dragon)
- [ ] Each has stats, an `ai` tag, ≥1 ability, and a portrait key
- [ ] Boss has a signature ability and clearly higher stats; flee fails against it (honored by engine)
- [ ] Difficulty curve documented in a comment (early enemies < boss)
- [ ] `pnpm typecheck` passes

## Plan
1. Author 3 enemies + boss using the `Enemy` type.
2. Add ASCII portraits.
3. Tag AI behaviors the engine already supports (PR-005).

## Constraints
- Data only. Reuse the same `Ability`/effect shape as classes so the engine stays generic.

## Notes
- Tune so a fresh hero can win standard fights but the boss needs potions/abilities — validate during PR-009/011 playthrough.
