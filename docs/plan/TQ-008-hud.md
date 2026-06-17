# TQ-008 — HUD: health / stamina / level
Status: ready · Depends on: TQ-007 · Scope: ~S · Touches: src/render/hud.ts, src/render/renderer.ts

## Context
The player can't manage stamina/health they can't see ([prd F1/F3](../prd.md#10-features)). Makes the combat loop legible.

## Goal
Merged means: a live HUD shows health, stamina, level/XP, and boss-progress, updating in real time.

## Acceptance
- [ ] HUD renders **health bar**, **stamina bar**, **level + XP**, and **bosses defeated / 10**
- [ ] Bars update every tick as values change (stamina visibly drains/regens)
- [ ] HUD overlays without corrupting the world viewport (fixed region, e.g., bottom rows)
- [ ] Read-only from state; `npm run typecheck` passes

## Plan
1. `hud.ts` draws bars/text into a reserved screen region.
2. `renderer.ts` composes world viewport + HUD each frame.

## Constraints
- Read-only rendering. Reserve HUD rows so it never overlaps the play area.

## Notes
- `bosses defeated / 10` can read 0/10 until TQ-011 lands — wire the field now.
