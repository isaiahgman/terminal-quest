# TQ-007 — Named attack types (risk/reward) wired to input
Status: ready · Depends on: TQ-006 · Scope: ~S · Touches: src/data/attacks.ts, src/input/input.ts, src/game/update.ts

## Context
Turns the engine into *play* ([prd §6](../prd.md#6-combat--the-signature-system)): 1–3 creatively-named attacks on a risk/reward axis, mash-but-stamina-limited.

## Goal
Merged means: the player has 2–3 distinct named attacks bound to keys; using them spends stamina and triggers `resolveAttack`; mashing is limited by stamina.

## Acceptance
- [ ] `attacks.ts` defines 2–3 `AttackSpec`s with **creative names** on a risk/reward axis (e.g. low: small/cheap/reliable; high: big radius/damage/expensive)
- [ ] Each attack is bound to a key; pressing it triggers that attack via the engine
- [ ] Spamming drains stamina; at empty, attacks are blocked until regen (forces repositioning)
- [ ] Distinct, observable difference between low- and high-risk attacks in play
- [ ] `pnpm typecheck` passes; engine tests still green

## Plan
1. Author the attack specs (final names TBD with Isaiah — placeholders fine).
2. Map keys → attack intents in `input.ts`; `update()` calls `resolveAttack`.
3. Surface a brief "too tired" cue when blocked (full HUD is TQ-008).

## Constraints
- No new combat math here — reuse TQ-006's engine. Data + wiring only.

## Notes
- Names are a creative hook; leave a TODO to finalize them. A high-risk attack with a vulnerable wind-up is a great stretch.
