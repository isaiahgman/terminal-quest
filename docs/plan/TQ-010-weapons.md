# TQ-010 — Weapons: slot, random drops, equip, damage
Depends on: TQ-006, TQ-009 · Scope: ~M · Touches: src/data/weapons.ts, src/game/entities.ts, src/game/update.ts, src/render/hud.ts

## Context
The second progression axis ([prd §7](../prd.md#7-world--progression)): a single weapon slot, weapons found randomly in the world, equipping boosts damage.

## Goal
Merged means: weapons drop in the world; walking over one picks it up; it equips to the single slot and increases attack damage.

## Acceptance
- [ ] `weapons.ts` defines several weapons (name + damage modifier; optional radius/stamina tweaks)
- [ ] Weapons spawn as pickups in the world (seeded placement)
- [ ] Walking onto a weapon equips it to the **single slot** (replacing the previous); damage reflects it
- [ ] Equipped weapon shown in the HUD
- [ ] Damage change verified (engine uses weapon modifier); `npm run typecheck` + `npm run test` pass

## Plan
1. Author weapon data; add `Pickup{kind:'weapon'}` + seeded spawns.
2. Pickup-on-overlap in `update()` → set `player.weapon`.
3. `resolveAttack` factors the weapon modifier; HUD shows the name.

## Constraints
- One slot only (no inventory in v1). Reuse the combat engine's damage path — don't fork it.

## Notes
- Upgrade/rarity is a later stretch.
- **Ships as two PRs.** (1) the pure module `src/data/weapons.ts` (+ tests) — weapon data + `applyWeapon`, no wiring; (2) integration into the world/loop/HUD after TQ-008 lands `hud.ts`.
- **Design decisions (2026-06-17):**
  - *Damage model:* a weapon adds a **flat `damageBonus`** to the attack's base `damage` (additive, separate from the leveling `atk` stat — no double-counting). Accepted that a flat bonus fades as `atk` grows late-game; revisit with a multiplier only if play-testing demands it.
  - *Modifier surface:* damage / reach (`radiusBonus`) / swing-weight (`staminaDelta`) only — weapons **do not touch `hitChance`** (reliability is the attack's identity).
  - *Starting kit:* the player **starts unarmed**. The empty slot is `undefined`, and `applyWeapon(spec, undefined)` returns the attack unchanged — so there is no starter weapon in the catalogue; the first pickup is the first weapon.
