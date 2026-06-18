# TQ-006 — Combat engine: radius + stamina + hit-chance (pure)
Depends on: TQ-005 · Scope: ~M · Touches: src/game/combat.ts, src/game/combat.test.ts

## Context
The signature mechanic, as pure tested logic ([prd §6](../prd.md#6-combat--the-signature-system), [tdd §6](../tdd.md#6-combat-model)). This is the "attack complexity" ticket Isaiah asked to capture separately.

## Goal
Merged means: given player + an attack spec, the engine resolves a **radius attack with per-enemy hit chance and stamina cost**, deterministically and unit-tested.

## Acceptance
- [x] `resolveAttack(attacker, targets, spec, rng)` finds targets within `spec.radius`, rolls `spec.hitChance` per target, applies damage, deducts `spec.staminaCost` — pure, RNG injected, no entity import (decoupled, see Notes)
- [x] Attack is **blocked** if stamina < cost (returns unchanged copies + a `blocked` "too tired" signal; no RNG consumed)
- [x] Stamina **regenerates** up to max via a `regenStamina(combatant, amount)` helper (caller computes `amount = rate * dt`)
- [x] `combat.test.ts` covers: radius selection, hit-chance distribution (seeded), damage, stamina gating, regen — all deterministic
- [x] `npm test` passes
- [ ] ~~Enemy → player contact damage resolved here too~~ — **moved to TQ-007** (needs the `Player`/`Enemy` entities this pure slice deliberately doesn't import; see Notes)

## Plan
1. Define `AttackSpec { name, radius, damage, staminaCost, hitChance }`.
2. Implement pure `resolveAttack` + `regenStamina` operating on state, RNG injected.
3. Seeded vitest cases (fixed seed → known hits).

## Constraints
- **Pure. No `Math.random` (use injected seeded RNG), no I/O, no rendering.** Don't mutate inputs — return new state.

## Notes
- Keep `hitChance` per-enemy independent — that randomness within the radius is the intended texture.
- **Decoupling decision (TQ-006):** to build ahead of TQ-005 without coupling, `combat.ts` defines its own minimal `Combatant` interface (no `Player`/`Enemy` import) and takes RNG as an injected function rather than threading `state`/`rng.ts`. The signature became `resolveAttack(attacker, targets, spec, rng)` instead of `(state, attack, rng)`. Player/Enemy are structurally compatible with `Combatant`, so TQ-007 wires them in without changing this module.
- **Contact damage moved to TQ-007:** enemy → player contact damage needs the entity layer, so it lands with the loop/entity wiring, not in this pure-math slice.
