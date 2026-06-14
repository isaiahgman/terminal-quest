# PR-001 — App shell + state machine
Status: ready · Depends on: PR-000 · Scope: ~M · Touches: src/App.tsx, src/state/store.ts, src/types.ts

## Context
The backbone all screens plug into — the store + screen router from [tdd §2,4,5](../tdd.md#4-state-model).

## Goal
Merged means: a single store holds `GameState`, and `<App/>` renders the screen named by `state.screen`, switchable via dispatched actions.

## Acceptance
- [ ] `src/types.ts` defines `GameState` and the `Screen` union (`title|charcreate|explore|battle|result`)
- [ ] `src/state/store.ts` exports `initialState`, a `reducer`, and an `Action` union
- [ ] `<App/>` uses `useReducer` and renders a different placeholder component per `state.screen`
- [ ] A temporary dev keybind cycles screens to prove routing works
- [ ] `pnpm typecheck` + `pnpm test` pass

## Plan
1. Define `GameState`, `Screen`, and `Action` (START_GAME, GOTO_SCENE, RESTART, QUIT to start).
2. `reducer(state, action)` — pure; handle the above.
3. `<App/>` holds `useReducer(reducer, initialState)`, switches on `state.screen` to placeholder screens, passes `{state, dispatch}` down (props or context).

## Constraints
- Reducer stays pure (no side effects). Screens are placeholders here — real ones come later.

## Notes
- Decide props vs React context for `dispatch` now; context keeps later screens clean.
