# TDD — Terminal Quest

Technical design for the product in [`prd.md`](prd.md). A real-time terminal action-roguelike. **Central bet: a pure simulation core, isolated from rendering and input** — so the rules are testable and the renderer can be upgraded (juice!) later without touching game logic.

## 1. Stack
- **TypeScript** (strict), **Node ≥ 18**.
- **Rendering + input:** [`terminal-kit`](https://github.com/cronvel/terminal-kit) — its **ScreenBuffer** does fast, flicker-free full-screen redraws and handles keyboard input. (Alternative: `blessed`/`neo-blessed`.)
- **Roguelike algorithms:** [`rot.js`](https://ondras.github.io/rot.js/) — procedural map generation, seeded RNG, FOV, pathfinding (A*/Dijkstra) when needed.
- **Tests:** vitest (pure sim/combat/progression).
- **Tooling:** pnpm; eslint + prettier (light).
- **Why not Ink?** React's reconcile model fits menus, not a 15-fps real-time game. terminal-kit's ScreenBuffer is the right tool for a game loop.

## 2. Architecture — three isolated layers
1. **Simulation** (`src/game/`) — pure-as-possible state + update logic: `update(state, intents, dt, rng) → state`. No I/O, no drawing. Deterministic via injected seeded RNG → unit-testable.
2. **Render** (`src/render/`) — reads `GameState`, draws to a terminal-kit ScreenBuffer. Read-only; never mutates state.
3. **Input** (`src/input/`) — keypresses → `intents` fed to the sim.

Plus **save** (`src/save/`) serializing state to disk. The **loop** (`src/game/loop.ts`) wires them together.

## 3. Game loop
- **Fixed timestep** (~66–80 ms/tick → ~12–15 fps). Each tick: gather intents → `update()` → render.
- Enemies advance every tick **regardless of player input** → the "stand still and die" pressure.
- Update is decoupled from render so a slow frame can't corrupt the sim.

## 4. Directory layout
```
src/
  cli.ts                 entry: init terminal, load save, start loop, restore on exit
  game/
    loop.ts              fixed-timestep loop (update + render)
    state.ts             GameState type + initialState
    update.ts            pure tick: move enemies, resolve attacks, stamina, pickups
    entities.ts          Player/Enemy/Pickup/Boss types + factories
    combat.ts            radius attack resolution, hit chance, damage, stamina  (PURE, tested)
    progression.ts       xp/level curve, stat growth                            (PURE, tested)
    rng.ts               seeded RNG (wrap rot.js RNG)
    world/
      generate.ts        procedural map gen (rot.js)
      camera.ts          viewport math (world → screen)
  render/
    renderer.ts          draw GameState to ScreenBuffer
    hud.ts               health / stamina / level / boss count
    sprites.ts           glyphs + colors for tiles/entities
    fx.ts                hit flashes, damage numbers (juice — later)
  input/input.ts         keypress → intents
  save/save.ts           (de)serialize, file IO, autosave
  data/
    weapons.ts  enemies.ts  bosses.ts
  config.ts              tunables (fps, viewport, balance knobs)
```

## 5. State model
- `GameState = { player, enemies[], pickups[], bosses[], world, camera, base, status, bossesDefeated, rngSeed }`
- `Player = { pos, hp, maxHp, stamina, maxStamina, level, xp, weapon, damage, ... }`
- `Enemy = { pos, hp, atk, speed, aiState }`  ·  `Boss = Enemy + { id, name, defeated }`
- `World = { tiles, width, height, seed }`  ·  `Camera = { x, y, viewW, viewH }`
- `Pickup = { pos, kind: 'weapon' | ... , payload }`

## 6. Combat model
- **Radius attack:** given player pos + attack type `{ radius, damage, staminaCost, hitChance }`, find enemies within radius, roll `hitChance` per enemy, apply damage. Pure fn in `combat.ts`.
- **Stamina:** cost on attack; regen per tick; gate attacks when empty.
- **Enemy contact:** enemies overlapping/adjacent deal damage to the player per tick.
- Fully deterministic via injected seeded RNG (so balance is testable).

## 7. World gen & camera
- rot.js generates a large seeded walkable map (cellular caverns or open field + obstacles).
- Camera = viewport centered on player, clamped to world bounds; render only visible tiles → cheap even on huge worlds.

## 8. Progression (the dopamine engine)
- XP per kill; level curve e.g. `xpToNext(level) = base * level^1.5`.
- Level-up grants hp/stamina/damage growth tuned to produce the **impossible → trivial** delta.
- Isolated, **pure, and unit-tested** so we can tune numbers fast without touching the loop.

## 9. Save
- JSON at `~/.terminal-quest/save.json`: player, **location**, status, weapon, world seed, base, bossesDefeated.
- **Autosave** on interval + key events (boss kill, base change, dungeon exit). Load on launch; missing file → new game.

## 10. Key decisions / trade-offs
- **terminal-kit over Ink** — real-time ScreenBuffer rendering.
- **Pure sim ⟂ render ⟂ input** — testable rules; renderer upgradeable for juice later without risk.
- **Grid-based + real-time** — enemies on a clock; simplest model that delivers the swarm feel.
- **Roguelite persistence over permadeath** — matches the Solo-Leveling power-retention fantasy.
- **Procedural world** — hand-authoring a large world is the bottleneck; accepted.

## 11. Risks & mitigations
- Real-time terminal jank → cap fps, ScreenBuffer diffing, small viewport.
- "Feel" is hard + renderer-dependent → prove the loop first (MVP), juice later.
- Scope (10 bosses, base, dungeons) → phased plan; MVP is the core loop only.
- Balance/numbers → isolated pure `progression.ts` + `combat.ts` so tuning is fast and tested.
