# PR-005 — Combat engine (pure)
Status: ready · Depends on: PR-003 · Scope: ~M · Touches: src/engine/combat.ts, src/engine/rng.ts, src/engine/combat.test.ts

## Context
The architectural centerpiece ([tdd §6,9](../tdd.md#6-combat)): all battle rules as pure, deterministic, unit-tested functions — zero React.

## Goal
Merged means: given a battle state + an action, the engine returns the next state deterministically, and tests cover the rules.

## Acceptance
- [ ] `rng.ts` exports a seeded RNG (same seed → same sequence)
- [ ] `combat.ts` exports pure fns: `computeTurnOrder`, `resolveAction(state, action, rng)`, `isBattleOver(state)`
- [ ] Supports actions: Attack, Ability (MP cost + effect), Item, Flee
- [ ] Damage = `max(1, atk − floor(def/2))` ± seeded variance; abilities apply data-driven effects
- [ ] `combat.test.ts` covers: damage math, turn order by SPD, ability MP gating, flee odds, win/lose detection — all deterministic
- [ ] `pnpm test` passes

## Plan
1. `rng.ts` — small seeded PRNG (mulberry32 or similar).
2. Implement the pure fns operating on `BattleState`; never mutate input (return new state).
3. Write vitest cases with fixed seeds.

## Constraints
- **No React, no I/O, no `Math.random`** — RNG must be injectable for determinism. Pure functions only.

## Notes
- This PR ships with no UI; it's validated entirely by tests. The Battle screen (PR-006) consumes it.
