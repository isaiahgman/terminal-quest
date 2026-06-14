# PR-006 — Combat engine: radius + stamina + hit-chance (pure)
Status: ready · Depends on: PR-005 · Scope: ~M · Touches: src/game/combat.ts, src/game/combat.test.ts, src/game/rng.ts

## Context
The signature mechanic, as pure tested logic ([prd §6](../prd.md#6-combat--the-signature-system), [tdd §6](../tdd.md#6-combat-model)). This is the "attack complexity" ticket Isaiah asked to capture separately.

## Goal
Merged means: given player + an attack spec, the engine resolves a **radius attack with per-enemy hit chance and stamina cost**, deterministically and unit-tested.

## Acceptance
- [ ] `resolveAttack(state, attack, rng)` finds enemies within `attack.radius`, rolls `attack.hitChance` per enemy, applies `attack.damage`, deducts `attack.staminaCost`
- [ ] Attack is **blocked** if stamina < cost (returns unchanged + a "too tired" signal)
- [ ] Stamina **regenerates** per tick up to max (a `regenStamina(state, dt)` helper)
- [ ] Enemy → player contact damage resolved here too
- [ ] `combat.test.ts` covers: radius selection, hit-chance distribution (seeded), damage, stamina gating, regen — all deterministic
- [ ] `pnpm test` passes

## Plan
1. Define `AttackSpec { name, radius, damage, staminaCost, hitChance }`.
2. Implement pure `resolveAttack` + `regenStamina` operating on state, RNG injected.
3. Seeded vitest cases (fixed seed → known hits).

## Constraints
- **Pure. No `Math.random` (use injected seeded RNG), no I/O, no rendering.** Don't mutate inputs — return new state.

## Notes
- Keep `hitChance` per-enemy independent — that randomness within the radius is the intended texture.
