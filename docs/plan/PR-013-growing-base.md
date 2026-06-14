# PR-013 — Growing home base (persistent meta)
Status: ready · Depends on: PR-012 · Scope: ~M · Touches: src/game/base.ts, src/game/state.ts, src/render/renderer.ts, src/save/save.ts

## Context
The meta-progression anchor ([prd §7](../prd.md#7-world--progression)): a home that **grows** as you progress and persists across runs/sessions.

## Goal
Merged means: there's a base location the player returns to; it visibly grows with progress; its state persists in the save.

## Acceptance
- [ ] A base area exists in the world the player can enter/return to
- [ ] The base **grows** based on progress (e.g., bosses defeated / resources) — a visible change, and ideally a tangible buff
- [ ] Base state is part of the save and persists across relaunch
- [ ] Returning to base is safe/low-pressure (a breather from the swarm)
- [ ] `pnpm typecheck` passes

## Plan
1. `base.ts`: base state + growth rules tied to progress.
2. Place the base; render its current tier; apply any buff to the player.
3. Include base in the save (PR-012).

## Constraints
- Keep growth rules data-driven and tied to existing progress signals — don't invent a second economy unless needed.

## Notes
- The base is the home you grow into — lean into the Solo-Leveling "look how far I've come" feeling.
