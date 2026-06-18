# TQ-008 — HUD: health / stamina / level
Depends on: TQ-007, TQ-009 · Scope: ~S · Touches: src/render/hud.ts, src/render/hud.test.ts, src/render/renderer.ts, src/render/renderer.test.ts, src/game/state.ts

## Context
The player can't manage stamina/health they can't see ([prd F1/F3](../prd.md#10-features)). Makes the combat loop legible. TQ-007 (attacks/stamina) and TQ-009 (leveling) are merged, so `Player.hp/stamina` and `Player.progress` (`level/xp/maxHp/maxStamina`) already exist and `update()` already drains/regens stamina each tick — this ticket is display-only.

## Goal
Merged means: a live HUD shows health, stamina, level/XP, and boss-progress, updating in real time.

## Acceptance
- [ ] HUD renders **health bar**, **stamina bar**, **level + XP**, and **bosses defeated / 10**
- [ ] Bars update every tick as values change (stamina visibly drains/regens)
- [ ] HUD overlays without corrupting the world viewport (fixed region, bottom rows)
- [ ] Read-only from state; `npm run check` passes

## Plan
1. `hud.ts` draws a **3-row** HUD into a reserved bottom region:
   ```
   HP ██████████░░ 18/20
   SP ███████░░░░░  6/10
   Lv 3   XP 12/45   Bosses 0/10
   ```
   - A **pure `barFill(value, max, width)`** helper (clamped, NaN-guarded) returns filled-cell count — tested in isolation, per the architecture bet (pure logic ⟂ rendering).
   - `drawHud(screen, state, top, width)` paints the region; takes a structural `{ put }` screen so it's testable with a lightweight fake.
   - Reads `progress ?? createProgression()` and `bossesDefeated ?? 0` — the same default-the-optional idiom `update()` uses.
   - Surfaces `state.tooTired` as a subtle cue on the stamina row (the field's comment already assigns this to TQ-008).
2. `renderer.ts` composes world viewport + HUD each frame: reserve `HUD_ROWS`, shrink the world pass to `playH = height − HUD_ROWS` (pass `playH` as `viewH` to `computeCamera`, bound the tile loop + entity y-cull to `playH`), then call `drawHud(this.screen, state, playH, width)` after the player draw.
3. `state.ts` adds `bossesDefeated?: number` (optional — matches `enemies?`/`progress?` incremental-wiring). Reads `0/10` until TQ-011 makes it authoritative.

## Constraints
- Read-only rendering. Reserve HUD rows so it never overlaps the play area.
- No game math in the HUD beyond pure presentation (`barFill`). Tick-rate-coupled contact-damage reconciliation (`update.ts` TODO) and player death are **out of scope** — they land with TQ-011 / death handling.

## Notes
- `bosses defeated / 10` reads `0/10` until TQ-011 lands — the field is wired now. `TOTAL_BOSSES = 10` lives inline in `hud.ts` (TODO: move to the bosses module when TQ-011 owns the real source).
- `renderer.test.ts` needs updating: it asserts the tile pass is the first `w*h` puts and the player is the last put, and pins a camera offset computed from the full `viewH`; shrinking the viewport + appending HUD puts changes all three.
