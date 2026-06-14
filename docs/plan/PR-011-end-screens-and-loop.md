# PR-011 — End screens + loop
Status: ready · Depends on: PR-009, PR-010 · Scope: ~S · Touches: src/screens/ResultScreen.tsx, src/state/store.ts

## Context
Closes the loop ([prd F8](../prd.md#6-features-mvp)) and makes the playthrough *complete* — the final MVP PR.

## Goal
Merged means: beating the boss shows victory, dying shows game-over, and both return to the title to play again.

## Acceptance
- [ ] Victory screen on boss defeat (celebratory ASCII + recap)
- [ ] Defeat/game-over screen when hero hp ≤ 0
- [ ] RESTART resets to a clean `initialState` at the title (no leftover hero/battle state)
- [ ] Full playthrough — win path and lose path — runs end to end with no crash (PRD §9 checklist)
- [ ] `pnpm typecheck` + `pnpm test` pass

## Plan
1. `ResultScreen` renders win vs lose variant from `state`.
2. Add `outcome` to state; reducer sets it on battle end (boss win / hero death).
3. RESTART action → fresh `initialState`.
4. Run the PRD §9 manual checklist; fix any crashes.

## Constraints
- This PR must leave MVP (F1–F8) fully green. No new features — wire-up + polish only.

## Notes
- After this merges, MVP is done; open PR-012+ for stretch items (save/load, more content, npm publish).
