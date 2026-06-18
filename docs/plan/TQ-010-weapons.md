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
- A starting basic weapon makes the MVP playable. Upgrade/rarity is a later stretch.
