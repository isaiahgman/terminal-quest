# PR-006 — Battle screen UI
Status: ready · Depends on: PR-004, PR-005 · Scope: ~M · Touches: src/screens/BattleScreen.tsx, src/components/HealthBar.tsx, src/components/MessageLog.tsx, src/components/AsciiSprite.tsx

## Context
Makes the engine ([PR-005](PR-005-combat-engine.md)) playable ([prd F4](../prd.md#6-features-mvp)). Static first; animation is PR-007.

## Goal
Merged means: a full battle is playable to victory or defeat via the action menu.

## Acceptance
- [ ] Renders hero vs enemy sprites, HP/MP bars (`HealthBar`), and a scrolling `MessageLog`
- [ ] Action menu (Attack / Ability / Item / Flee) drives `resolveAction`; enemy takes its turn via AI
- [ ] HP/MP and log update each turn; battle ends on win/lose and dispatches END_BATTLE
- [ ] Win returns to `explore`; lose goes to `result` (game over)
- [ ] `pnpm typecheck` passes

## Plan
1. `HealthBar` ({current, max, label}) — colored bar.
2. `MessageLog` ({lines}) — last N messages.
3. `BattleScreen` holds `BattleState`, renders sprites/bars/menu, calls engine on input, runs enemy turn, detects end.

## Constraints
- Screen calls the engine but contains **no damage math** itself. Reuse `Menu`. No animation yet (static frames ok).

## Notes
- Keep a single `seed` in battle state so enemy turns stay reproducible.
