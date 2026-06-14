# PR-004 — Character creation
Status: ready · Depends on: PR-002, PR-003 · Scope: ~S · Touches: src/screens/CharCreateScreen.tsx

## Context
Turns class data ([PR-003](PR-003-data-model-and-content.md)) into the player's hero ([prd F2](../prd.md#6-features-mvp)).

## Goal
Merged means: player browses the 3 classes, sees portrait+stats, confirms, and a hero is created in state.

## Acceptance
- [ ] Screen lists the 3 classes (reuses `Menu`); selection shows that class's portrait + stat block live
- [ ] Confirming dispatches SELECT_CLASS → `state.hero` is a `Character` from `createHero`
- [ ] After confirm, `state.screen` advances to `explore`
- [ ] Back/cancel returns to title
- [ ] `pnpm typecheck` passes

## Plan
1. `CharCreateScreen` renders `Menu` of classes + a detail panel (portrait + stats) for the highlighted class.
2. On confirm → dispatch SELECT_CLASS(klass); reducer sets `hero` and `screen='explore'`.

## Constraints
- Reuse `Menu` + `AsciiSprite`; no new combat/engine logic.

## Notes
- Name entry optional for v1 — default the hero name to the class name to keep scope tight.
