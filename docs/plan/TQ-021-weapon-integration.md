# TQ-021 — Weapon integration: pickups, equip, damage, HUD, save

Depends on: TQ-010 (the pure `weapons.ts` leaf, merged), TQ-012 (save) · Scope: ~M (ships as ~3–4 small PRs) · Touches: src/game/state.ts, src/game/update.ts, src/cli.ts, src/render/hud.ts, src/save/save.ts (the pure `data/weapons.ts` is unchanged)

## Context

[prd §7 / F6](../prd.md#7-world--progression): a **single weapon slot**; weapons are found randomly in the world; equipping **boosts damage**; upgradeable. The second progression axis next to leveling.

The audit (2026-06-19) found this is the clearest "merged but not done" gap. TQ-010 is marked **merged**, but only its **PR1 — the pure leaf** actually shipped: `data/weapons.ts` defines `WEAPONS` and `applyWeapon(spec, weapon)` (fold a weapon's `damageBonus`/`radiusBonus`/`staminaDelta` into an `AttackSpec`), fully unit-tested. TQ-010's **PR2 — integration** never landed. Concretely, today:

- `applyWeapon` is **never called** anywhere outside its own test — grep confirms.
- `Player` has **no weapon slot** (`state.ts`); there is **no `Pickup` type** at all (tdd §5 lists one, but it was never built); `cli.ts` spawns only enemies + bosses.
- The attack path in `update()` resolves `ATTACKS[id]` **directly**, so an equipped weapon could not change damage even if one existed.
- The HUD has no weapon line (though `weapons.ts` already says "shown in the HUD once wired"); the save omits the weapon (so does PRD §8's "equipped weapon" requirement go unmet).

So an entire promised system is dead code in the live game. This ticket is TQ-010's unshipped PR2, broken into atomic slices.

Importantly, this is **not** half-wired today _on purpose_: the repo's "no speculative unused code" rule is exactly why nobody added `Player.weapon` with nothing to set it. The fix is to wire the whole chain in one ticket family — pickup → slot → damage → HUD → save — so every field has a live reader the moment it's added.

## Goal

Merged means: weapons exist as seeded pickups in the world; walking onto one equips it to the single slot; equipped weapons measurably change attack damage **through the existing combat path** (`applyWeapon` ∘ `resolveAttack`, never a fork); the HUD shows what's equipped; and the equipped weapon survives save/resume.

## Decisions for Isaiah

1. **Pickup model.** Proposed: `Pickup = { pos: Vec2; kind: 'weapon'; weapon: WeaponId }` on `GameState.pickups?: readonly Pickup[]` (matches tdd §5's sketch; `kind` leaves room for future pickup types). Confirm the shape.
2. **Equip semantics on overlap.** Single slot, no inventory (v1). When you step onto a weapon: equip it and **discard** whatever you held (recommended — simplest, matches "single slot"), or **drop** the old one on your tile (swappable). Recommend discard for v1; "upgradeable" is a separate axis.
3. **How many weapons, and the power ramp.** A balance knob: how many pickups seed a fresh world, and whether they're placed on the ascending-power ladder (`rusted-dagger → iron-sword → warhammer`) by distance, or uniformly. Recommend a small fixed count (e.g. 3–5), placed like enemies (seeded, away from spawn); tune by playing.
4. **"Upgradeable" (F6).** Out of scope for v1 (find + equip + damage). Flag as a later ticket so we don't gold-plate the first cut.
5. **Save coordination.** The weapon field is a `SaveData` addition behind a `SAVE_VERSION` bump — coordinate with **TQ-022** so boss-progress + status + weapon all land in one version bump rather than three.

## Acceptance

- [ ] `Player` gains `weapon?: WeaponId` (empty slot = `undefined` = unarmed, the well-defined baseline `applyWeapon` already models); documented in `state.ts`
- [ ] A `Pickup` type + `GameState.pickups?` exist; `cli.ts` seeds weapon pickups deterministically from the world seed (like `spawnEnemies`)
- [ ] In `update()`, a player standing on a weapon pickup equips it (slot updated, pickup removed); the attack path resolves `applyWeapon(ATTACKS[id], player.weapon && WEAPONS[player.weapon])` so a landed hit reflects the weapon — verified by a sim test (same swing, more damage with a weapon equipped)
- [ ] The HUD shows the equipped weapon name (or "Unarmed")
- [ ] The equipped weapon is persisted and restored (folded into TQ-022's version bump)
- [ ] Combat is **not forked**: damage still flows through `resolveAttack`; `applyWeapon` only transforms the spec. `npm run check` passes

## Plan (3–4 small PRs)

1. **PR 1 — slot + damage:** add `Player.weapon?` (`state.ts`); wrap the spec at the one call site in `update.ts` with `applyWeapon`. Unit-test the damage delta. (No way to _obtain_ a weapon yet — so land this with PR 2 to avoid a slot nothing can set; or seed a debug starting weapon behind a test only.)
2. **PR 2 — pickups + equip:** `Pickup` type + `GameState.pickups?` (`state.ts`); equip-on-overlap in `update()`; seed pickups in `cli.ts`.
3. **PR 3 — HUD line:** show the equipped weapon (`render/hud.ts`).
4. **PR 4 — persist:** add `weapon` to `SaveData` (fold into TQ-022's `SAVE_VERSION` bump rather than a standalone bump).

## Constraints

- **Reuse the combat path, never fork it** (the same constraint TQ-010's leaf was built around): a weapon expresses itself only as an `AttackSpec` transform via `applyWeapon`; `resolveAttack` is unchanged.
- Keep `state.ts`/`update.ts` edits small and additive (optional fields, mirroring `enemies?`/`progress?`) — they're the reconciliation chokepoints.
- Don't add `Player.weapon` (or any field) until a reader/writer for it lands in the same PR family — honor "no speculative unused code." This is why PR1 and PR2 are tightly coupled.
- `atk` (leveling) and `damageBonus` (gear) stay separate so the two progression axes never double-count — already the leaf's design.

## Notes

- The math is already proven: `weapons.test.ts` exercises `applyWeapon ∘ resolveAttack`. This ticket is pure wiring — the risk is all in the shared files, not the formula.
- `Pickup`/`Boss` factories are currently "unhomed" per tdd §12; a small `factories.ts` (or co-location in `state.ts`) is the natural home for the `Pickup` type/constructor — decide when PR2 lands.
