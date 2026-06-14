# PR-001 — Tile renderer (ScreenBuffer)
Status: ready · Depends on: PR-000 · Scope: ~M · Touches: src/render/renderer.ts, src/render/sprites.ts, src/game/state.ts

## Context
The drawing layer ([tdd §2,7](../tdd.md#2-architecture--three-isolated-layers)). Everything visible flows through here.

## Goal
Merged means: a tile grid renders to a terminal-kit **ScreenBuffer** and redraws each frame without flicker.

## Acceptance
- [ ] `sprites.ts` maps tile/entity kinds → glyph + color
- [ ] `renderer.ts` takes a `GameState` and draws the visible tiles to a ScreenBuffer, then `.draw()`/`.draw({delta:true})`
- [ ] A hardcoded sample map renders correctly with color
- [ ] Repeated redraws show **no flicker/tearing**
- [ ] Renderer is **read-only** — it never mutates `GameState`
- [ ] `pnpm typecheck` passes

## Plan
1. Minimal `GameState` with a `world.tiles` 2D array.
2. ScreenBuffer sized to terminal; map tiles → glyphs via `sprites.ts`; draw with delta updates.
3. Render a static sample map to prove it.

## Constraints
- Use ScreenBuffer delta drawing (not full clears) to avoid flicker. No game logic in the renderer.

## Notes
- Handle terminal resize later; assume fixed size for now.
