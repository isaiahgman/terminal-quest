# PR-002 — Title screen
Status: ready · Depends on: PR-001 · Scope: ~S · Touches: src/screens/TitleScreen.tsx, src/components/Menu.tsx, src/art/portraits.ts

## Context
First thing the player sees ([prd F1](../prd.md#6-features-mvp)). Also introduces the reusable `Menu` component used elsewhere.

## Goal
Merged means: an animated/styled title screen with a keyboard menu that starts the game or quits.

## Acceptance
- [ ] Big ASCII "TERMINAL QUEST" title (figlet or ink-big-text) with a gradient
- [ ] `Menu` component: arrow keys move selection, Enter confirms, selected item highlighted
- [ ] Options: **New Game** → dispatch START_GAME (→ charcreate), **Quit** → exit
- [ ] Reusable `Menu` takes `items` + `onSelect` props (no game logic inside)
- [ ] `pnpm typecheck` passes

## Plan
1. Add `gradient-string` + a title lib; render the banner.
2. Build generic `Menu` ({items, onSelect}) with `useInput`.
3. `TitleScreen` composes banner + menu; wire New Game/Quit to dispatch.

## Constraints
- `Menu` must stay generic/reusable (CharCreate + battle reuse it). No hardcoded title-specific logic in it.

## Notes
- A subtle title shimmer can reuse `useAnimation` once PR-007 lands; static gradient is fine for now.
