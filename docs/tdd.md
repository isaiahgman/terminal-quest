# TDD — Terminal Quest

Technical design for the product in [`prd.md`](prd.md). The central bet: **a pure, testable game engine separated from a dumb Ink UI.**

## 1. Stack
- **Language:** TypeScript (strict).
- **Runtime:** Node ≥ 18; dev via `tsx`.
- **UI:** [Ink](https://github.com/vadimdemedes/ink) (React for the terminal) — `useInput`, `useApp`.
- **Flair:** chalk + gradient-string (color), figlet / ink-big-text (title art).
- **State:** React `useReducer` in one top-level store (single source of truth). Revisit zustand only if prop-drilling hurts.
- **Tests:** vitest, targeting the pure engine.
- **Tooling:** pnpm; eslint + prettier (light).

## 2. Architecture
- Entry `src/cli.tsx` renders `<App/>` via Ink `render()`.
- `<App/>` owns the store and **routes to the active screen** from `state.screen`.
- **Screens** are React components; they read state and dispatch actions. No game logic inside them.
- **Engine** (`src/engine/`) is pure TypeScript, no React: combat resolution, turn order, damage. Deterministic (seeded RNG) → unit-testable.
- **Content** (`src/data/`) is plain data typed by `src/types.ts`.
- **Animation** via a `useAnimation` hook that advances a frame index on a timer; components render frames from `src/art/`.

## 3. Directory layout
```
src/
  cli.tsx              entry — render(<App/>)
  App.tsx              store + screen router
  types.ts             Character, Class, Enemy, Ability, Item, Scene, GameState
  state/store.ts       reducer, actions, initialState
  data/
    classes.ts  enemies.ts  scenes.ts  items.ts
  engine/
    combat.ts          turn order, action resolution, damage
    combat.test.ts
    rng.ts             seeded RNG
  screens/
    TitleScreen.tsx  CharCreateScreen.tsx  ExploreScreen.tsx
    BattleScreen.tsx  ResultScreen.tsx
  components/
    HealthBar.tsx  Menu.tsx  AsciiSprite.tsx  MessageLog.tsx
  hooks/useAnimation.ts
  art/portraits.ts  art/fx.ts
```

## 4. State model
- `GameState = { screen, hero, currentSceneId, battle, log, rngSeed }`
  - `screen: 'title' | 'charcreate' | 'explore' | 'battle' | 'result'`
- `Character = { name, klass, level, hp, maxHp, mp, maxMp, atk, def, spd, abilities[], inventory[] }`
- `Enemy = Character-minus-inventory + { ai }`
- `BattleState = { hero, enemy, turnOrder[], activeIdx, phase, pendingAction, log[] }`
  - `phase: 'choose' | 'animate' | 'resolve' | 'win' | 'lose'`
- **Actions:** `START_GAME, SELECT_CLASS, GOTO_SCENE, START_BATTLE, CHOOSE_ACTION, RESOLVE_TURN, USE_ITEM, END_BATTLE, RESTART, QUIT`.

## 5. Screen flow
```
title → charcreate → explore ⇄ battle → (explore | result) → title
```
All transitions are reducer-driven.

## 6. Combat
- **Turn order:** by SPD desc (ties → hero first).
- **Actions:** Attack (`dmg = max(1, atk − def/2)` ± small variance), Ability (costs MP, scaled effect), Item (use potion), Flee (spd-based chance; fails vs boss).
- **Enemy AI:** threshold heuristic (heal/strong-attack); boss has a signature ability.
- **RNG:** seeded (`engine/rng.ts`) so combat is deterministic in tests.
- **Resolution:** enemy hp≤0 → win (+ simple xp/loot); hero hp≤0 → lose.

## 7. Animation
- `useAnimation(frames, fps, {loop})` → `{ frame, done }`. Battle enters `phase:'animate'`, plays 3–6 attack frames, then resolves damage. Ink re-renders per frame.
- HP bar **tweens**: displayed value eases toward the real value over a few frames.
- Keep frame counts small + fps capped (~12) for snappiness and low CPU.

## 8. Testing
- Unit-test `engine/combat.ts` with vitest: damage math, turn order, win/lose, flee odds, item use — all deterministic via seeded RNG.
- UI/animation validated by the manual playthrough checklist (PRD §9).

## 9. Key decisions / trade-offs
- **Ink over raw ANSI** — component model makes layout + animation tractable; cost is a React dep. Worth it.
- **useReducer over zustand (v1)** — fewer deps, enough power.
- **Pure engine ⟂ UI** — the main bet: enables tests, keeps React dumb.
- **Hand-authored linear content** — caps scope, maximizes *feel* per hour.

## 10. Risks & mitigations
- Animation timing jank → small frame counts, fps cap.
- Content scope creep → hard cap MVP at 3 enemies + 1 boss, 4 scenes.
- Ink/Node version quirks → pin Node ≥ 18, lockfile committed.
