# TQ-018 — Visual identity: palette, backgrounds, Unicode tileset
Status: in progress · Depends on: none · Scope: ~M · Touches: src/render/sprites.ts (+ new src/render/sprites.test.ts), src/render/renderer.ts

## Context
Today the world reads as flat ASCII — `·` floor, `#` wall, `@` player, one foreground colour each ([sprites.ts](../../src/render/sprites.ts)). Beta feedback (2026-06-16): the map and movement work, but it's visually plain and hard to read at a glance. The renderer already composites per-cell `attr` through a terminal-kit `ScreenBuffer` with synchronized output ([renderer.ts](../../src/render/renderer.ts)), and every on-grid thing funnels through one function (`glyphForTile`). That's the right seam to introduce a deliberate **visual identity** — a colour palette, per-cell background colours, and a Unicode tileset — with localized, render-only changes.

This is the **static** look. It is deliberately **not** animation/FX (that's [TQ-015](TQ-015-juice-game-feel.md)), not lighting/fog-of-war, and not entity rendering (enemies aren't drawn yet — see Notes). Those reuse the foundation this ticket lays.

## Goal
Merged means: the world renders with a deliberate colour palette, per-cell background colours, and a readable Unicode tileset — the player is instantly findable, walls/floors are clearly distinct — with zero change to game rules and no frame regression.

## Acceptance
- [ ] `Glyph` gains an optional **background** (e.g. `bg?: string`); `renderer.ts` passes it through `attr` (`bgColor`) for tiles **and** the player, applied only when present.
- [ ] A single **palette/tileset source of truth** (constants in `sprites.ts`) defines glyph + foreground + background for each tile and the player — no colour strings scattered through the renderer.
- [ ] Tiles render with **distinct, readable** styling: walls read as solid/lit, floor as subtle/recessive, using Unicode glyphs (not bare ASCII) where it improves clarity.
- [ ] The **player remains instantly findable** against any tile background (deliberate contrast — verify by running, not just reading).
- [ ] **Render-only:** no change to `GameState`, the simulation, or game rules. No new feedback from renderer into state.
- [ ] **No flicker / no frame-rate regression** — changes stay within the existing per-cell `ScreenBuffer` + synchronized-output path; cost stays proportional to the viewport.
- [ ] New `src/render/sprites.test.ts` covers the tileset: every `Tile` maps to a glyph with fg (and bg where defined), and the palette is internally consistent (exhaustive `switch`, no fallthrough).
- [ ] `npm run check` green (typecheck + strict lint + tests). No `eslint-disable` / `any` / `@ts-ignore`.

## Plan
1. **Palette** — in `sprites.ts`, define a small named palette (a handful of fg/bg colour constants) so the look is tunable in one place. Prefer terminal-kit colour names or hex; if hex/truecolor, note the 256-colour fallback assumption.
2. **Glyph shape** — add optional `bg?: string` to the `Glyph` interface. Keep `char` + `color` as-is so existing callers don't break.
3. **Tileset** — expand `glyphForTile` to return glyph + fg + bg per `Tile` using the palette and Unicode glyphs (e.g. wall as a block/box glyph with a lit bg; floor as a dim dot/▒ on a recessive bg). Keep the `switch` exhaustive over `Tile`.
4. **Player** — move `PLAYER_GLYPH`/`PLAYER_COLOR` into the palette; give the player a deliberate fg (and bg if it aids contrast).
5. **Renderer** — in the tile loop and the player draw, include `bgColor: g.bg` in `attr` only when defined; leave the rest of the draw path (sync output, delta flush) untouched.
6. **Tests** — add `sprites.test.ts` asserting the tileset/palette contract.

## Constraints
- **Render-only.** The simulation stays pure — do not touch `GameState`, `update`, or any game-logic file. This ticket changes *only* `src/render/*`.
- **One source of truth for colour** — no inline colour literals in `renderer.ts`; everything flows from the palette in `sprites.ts`.
- Keep within the existing `ScreenBuffer`/synchronized-output design; don't add a second draw path. Cost stays viewport-proportional.
- Don't expand scope into animation, lighting/FOV, or entity rendering — those are separate tickets that build on this.
- No `eslint-disable` / `any` / `@ts-ignore`.

## Notes
- **Iteration is expected.** This ticket lands a deliberate-but-adjustable baseline; Isaiah will run it and tune the palette/glyphs from what he sees. Keeping all colour/glyph choices in one palette block makes that tuning a one-file edit.
- **Enemies aren't rendered yet** — `renderer.ts` draws tiles + player only, though enemy AI is in state (TQ-005 merged). Drawing entities is a separate ticket; it will reuse this `Glyph`/palette system (give enemies a distinct glyph + colour then, not here).
- **rot.js** is available and is the right tool for the *next* visual layers — `ROT.Color.interpolate` for animated colour (feeds TQ-015), `ROT.FOV`/`ROT.Lighting` for torch-lit fog-of-war (a future lighting ticket). Out of scope here, but this palette is the substrate they'll tint.
- **Terminal capability:** assume a 256-colour/truecolor terminal (terminal-kit degrades gracefully). If we later need to support 16-colour terminals, gate richer colours behind a capability check — note only, not this ticket.
