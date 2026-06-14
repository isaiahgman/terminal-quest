# PR-009 — Exploration map
Status: ready · Depends on: PR-004, PR-006, PR-008 · Scope: ~M · Touches: src/screens/ExploreScreen.tsx, src/data/scenes.ts

## Context
Connects creation → battles into a journey ([prd F3](../prd.md#6-features-mvp)). The spine that makes it a *game*, not a fight simulator.

## Goal
Merged means: the player traverses Town → Forest → Cave → Boss Lair, triggering encounters, and reaches the boss.

## Acceptance
- [ ] `scenes.ts` defines 4 linear scenes with description, flavor, and `encounters`/exits
- [ ] `ExploreScreen` shows the scene + a `Menu` of choices (advance / fight / use item)
- [ ] Entering an encounter dispatches START_BATTLE with the right enemy; winning returns to the scene and unlocks progress
- [ ] Reaching the lair starts the boss battle
- [ ] `pnpm typecheck` passes

## Plan
1. Author scene data (linear `next` links + encounter refs).
2. `ExploreScreen` renders current scene + choices, dispatches GOTO_SCENE / START_BATTLE.
3. Reducer tracks `currentSceneId` and gates the lair until prior scenes are cleared.

## Constraints
- Linear only — no branching/backtracking in v1. Reuse `Menu`. No new combat logic.

## Notes
- Persist "cleared" flags per scene so a won fight doesn't re-trigger.
