# PR-010 — Inventory + items
Status: ready · Depends on: PR-006 · Scope: ~S · Touches: src/data/items.ts, src/screens/BattleScreen.tsx, src/screens/ExploreScreen.tsx, src/engine/combat.ts

## Context
Resource management that makes the boss beatable ([prd F7](../prd.md#6-features-mvp)).

## Goal
Merged means: the hero carries potions usable both in battle and while exploring, with counts that decrement.

## Acceptance
- [ ] `items.ts` defines at least a Health Potion (+ optionally Mana Potion) with data-driven effects
- [ ] Hero starts with a small stock; `Item` action in battle consumes one and heals (counts as a turn)
- [ ] Items usable from the explore screen too (out of combat)
- [ ] Using an item with 0 remaining is impossible (UI hides/disables it)
- [ ] Engine item-use path is unit-tested; `pnpm test` passes

## Plan
1. Define items + effects reusing the effect shape.
2. Add `USE_ITEM` handling in engine (battle) and reducer (explore).
3. Surface an Item submenu in both screens driven by inventory counts.

## Constraints
- Reuse the existing effect/ability resolution in the engine — don't fork a second damage/heal path.

## Notes
- Boss tuning (PR-008) assumes ~2–3 potions available; revisit together.
