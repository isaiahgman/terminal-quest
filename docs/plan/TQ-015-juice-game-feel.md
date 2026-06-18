# TQ-015 — Juice: hit flashes, damage numbers, screen shake
Status: ready · Depends on: TQ-008 · Scope: ~M · Touches: src/render/fx.ts, src/render/renderer.ts

## Context
Game feel ([prd §9](../prd.md#9-game-feel--juice-when-we-get-there)). Isaiah flagged this as hard and renderer-dependent — deliberately **last**, once the loop is proven. Pure presentation; no rules change.

## Goal
Merged means: hits produce visible, satisfying feedback — flashes, floating damage numbers, and a screen shake on big hits.

## Acceptance
- [ ] Enemies flash/blink briefly when hit
- [ ] **Floating damage numbers** rise and fade at hit locations
- [ ] A short **screen shake** on high-damage / high-risk hits
- [ ] All effects are render-only (driven by transient events from state); no change to game rules or tests
- [ ] No frame-rate regression / flicker; `npm run typecheck` passes

## Plan
1. Emit transient "hit events" from the sim (data the renderer reads).
2. `fx.ts` renders flashes/numbers/shake from those events with short lifetimes.
3. Cap concurrent effects for performance.

## Constraints
- **Render-only.** The simulation stays pure — effects must not feed back into game state. Keep within the fps budget.

## Notes
- This is where the "impossible → trivial" moment gets its *crunch*. Worth doing well once the core is solid.
