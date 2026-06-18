# TDD — Terminal Quest

Technical design for the product in [`prd.md`](prd.md). A real-time terminal action-roguelike. **Central bet: a pure simulation core, isolated from rendering and input** — so the rules are testable and the renderer can be upgraded (juice!) later without touching game logic.

## 1. Stack
- **TypeScript** (strict), **Node ≥ 18**.
- **Rendering + input:** [`terminal-kit`](https://github.com/cronvel/terminal-kit) — its **ScreenBuffer** does fast, flicker-free full-screen redraws and handles keyboard input. (Alternative: `blessed`/`neo-blessed`.)
- **Roguelike algorithms:** [`rot.js`](https://ondras.github.io/rot.js/) — procedural map generation, seeded RNG, FOV, pathfinding (A*/Dijkstra) when needed.
- **Tests:** vitest (pure sim/combat/progression).
- **Tooling:** npm; eslint + prettier (light).
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
    entities.ts          enemy-AI stepper: stepEnemy / contactDamage / EnemyAi + charge constants (CHARGE_RADIUS, CHARGE_SPEED_MULTIPLIER); see §12
    enemy.ts             Enemy type + createEnemy factory + ENEMY_TYPES data table  (TQ-005; see §12)
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
    weapons.ts  bosses.ts  (enemy data consolidated into game/enemy.ts; see §12)
  config.ts              tunables (fps, viewport, balance knobs)
```

## 5. State model
- `GameState = { player, enemies[], pickups[], bosses[], world, camera, base, status, bossesDefeated, rngSeed }`
- `Player = { pos, hp, maxHp, stamina, maxStamina, level, xp, weapon, damage, def, ... }`  (`def` mitigates enemy-contact damage — the player is a `def` target)
- `Enemy = { kind, pos, hp, maxHp, atk, def, speed, glyph, color }`  ·  `Boss = Enemy + { id, name, signature }`  (*no `defeated` flag — bosses ride in `enemies[]` and defeat is the `bossesDefeated` counter; see the TQ-011 entry in §12. Per-enemy AI bookkeeping is **not** a field on `Enemy`; it lives in a separate `EnemyAi` struct — see below. `glyph`/`color` are plain strings the renderer maps — see §12)
  - *Per-enemy AI state* lives in a separate `EnemyAi` struct (`{ moveBudget, phase }`) the simulation owns one-of per live enemy — kept **off** `Enemy` so the entity stays a serializable stats/position leaf. The AI stepper threads an `EnemyAi` alongside each `Enemy` (advancing position + refreshing the budget/phase) rather than carrying that mutable bookkeeping on the entity itself (see the `EnemyAi` doc comment in `entities.ts`, and the TQ-005 move-budget/charge entries in §12).
- `World = { tiles, width, height, seed }`  ·  `Camera = { x, y, viewW, viewH }`
- `Pickup = { pos, kind: 'weapon' | ... , payload }`

## 6. Combat model
- **Radius attack:** given player pos + attack type `{ radius, damage, staminaCost, hitChance }`, find enemies within radius, roll `hitChance` per enemy, apply damage. Pure fn in `combat.ts`.
- **Damage formula:** `damage = max(1, attack.damage + attacker.atk - target.def)` — clamped to ≥1 so a landed hit always stings; `def` mitigates.
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

## 12. Amendments
Deviations from the original §4/§5 design, recorded so the change — and its reason — is explicit. We started with the layout/model above; this is where it bends and why.

- **2026-06-14 (TQ-005) — enemy type, factory, and data consolidated into `src/game/enemy.ts`.** §4 originally split this across `game/entities.ts` (Enemy type + factory) and `data/enemies.ts` (the stat table). The TQ-005 data slice instead lands them in one new leaf module, `game/enemy.ts`.
  - *Why:* it keeps the slice a single, cohesive, dependency-free file — it touches no shared files (`entities.ts`/`update.ts`), so spawning, AI, and rendering can land in separate PRs without contention. Co-locating the `Enemy` shape with the `ENEMY_TYPES` it stamps keeps the type and its data in one place rather than two files that must stay in sync.
  - *Layer bet intact:* `enemy.ts` lives in the sim layer and imports nothing from `render/`; `glyph`/`color` are plain strings the renderer maps, so the sim→render isolation in §2 still holds.
  - *§5 Enemy model updated to match:* added `kind` (archetype/AI discriminant), `maxHp` (HUD bars + heal clamping), and `glyph`/`color` (data-driven appearance — the renderer reads these off the entity rather than a `sprites.ts` per-kind switch). Per-enemy AI bookkeeping is left off `Enemy` entirely — when the AI slice landed it became a separate `EnemyAi` struct rather than an `Enemy.aiState` field (see the next entry).
  - *Future entity types:* the `entities.ts` name was repurposed for the enemy-AI stepper (`stepEnemy`/`contactDamage`/`EnemyAi` + charge constants), so it no longer holds the original Player/Pickup/Boss factories. `Player` already lives in `state.ts` (the `Player` interface, part of `GameState` — see §5), so its home is mostly decided. Only the `Pickup`/`Boss` factories remain unhomed — a small `factories.ts` (or co-location in `state.ts`) is the natural call. `weapons.ts`/`bosses.ts` data still live under `data/`.

- **2026-06-16 (TQ-005) — AI bookkeeping landed as a separate `EnemyAi` struct, not an `Enemy.aiState` field.** The AI slice carries its per-enemy `{ moveBudget, phase }` in an `EnemyAi` struct the simulation owns one-of per live enemy (the stepper threads it alongside each `Enemy`), instead of hanging it on `Enemy`. That keeps `Enemy` a plain stats/position leaf and the AI's mutable bookkeeping a separate concern (see the `EnemyAi` doc comment in `entities.ts`). §5 updated to drop `aiState` from `Enemy` accordingly.

- **2026-06-16 (TQ-005) — charge is a speed *multiplier*, not a per-tick lunge.** The first cut of `entities.ts` implemented "switch to a direct charge" as a guaranteed one-tile step every tick while inside `CHARGE_RADIUS` (a movement *floor*). Review found that at 15 Hz **no** enemy kind banks a whole tile per tick (grunt 0.27, runner 0.53, brute 0.13), so the lunge fired every tick for every kind and clamped its cost to 0 — pinning all three to an identical 1 tile/tick (15 tiles/s) in charge range.
  - *Why it was wrong:* a floor *flattens* — it erased the speed stat exactly where the fight happens (a `speed: 2` brute charged as fast as a `speed: 8` runner, collapsing the `enemy.ts` balance triangle), and it re-coupled charge speed to the tick rate — the one thing the `speed * dt` move-budget exists to prevent (double the Hz and every charge doubles in speed).
  - *Fix:* charge now multiplies the enemy's `speed` by `CHARGE_SPEED_MULTIPLIER` (2) before the budget fills — a *gain*, not a floor. Charges are faster than advances, the per-kind speed spread is preserved (runner still out-charges brute), tick-rate independence is restored, and the special-case lunge code (plus its no-double-step guard) is deleted. `CHARGE_SPEED_MULTIPLIER` is the one tuning knob for charge intensity. Trade-off accepted: a brute now takes a few ticks to bank its first charge step instead of lurching instantly — a slight wind-up that reads fine.

- **2026-06-17 (TQ-011) — a boss is a tough `Enemy` with identity; no `defeated` flag; defeat is a counter.** §5 listed `Boss = Enemy + { id, name, defeated }`. The boss-sim slice keeps `id`/`name`/`signature` but **drops `defeated`**: live bosses ride inside `GameState.enemies[]` as ordinary `LiveEnemy`s (a `Boss` *is* an `Enemy`), so they reuse the existing movement, combat, contact-damage, XP, and render paths wholesale, and on death they are **culled** from that array exactly like any enemy. Defeat is therefore tracked by a `bossesDefeated` counter incremented in the cull step, with `bossesTotal` (the count actually placed) as the denominator and the win target — a single source of truth, with no per-boss boolean to keep in sync against the live set. Victory flips `status` (`'playing' | 'victory'`, new in `state.ts`) when `bossesDefeated >= bossesTotal > 0`.
  - *Enemy-kind union split:* `EnemyKind` became `SwarmKind | 'boss'` (`SwarmKind = 'grunt' | 'runner' | 'brute'`). `ENEMY_TYPES` and `createEnemy` narrow to `SwarmKind` so the swarm stat table stays exhaustive over only the kinds it stamps; bosses carry `kind: 'boss'` and are built by `createBoss` from `data/bosses.ts` (the `BOSS_ROSTER` — reaching 10 is appending data, not code).
  - *Signature behaviour:* data-selected as a discriminated union `BossSignature = { kind: 'none' } | { kind: 'enrage'; below; speedMultiplier }`. `enrage` rides the existing move-budget path — below the hp threshold the boss's `speed` is multiplied for the step calculation only (a transient copy in `update`), so its stored speed is unchanged and the boost never persists. `none` is a pure stat wall. New variants are the only part that needs code.
  - *State fields optional/defaulted:* `bossesDefeated?`/`bossesTotal?`/`status?` mirror the `enemies?`/`progress?` incremental-wiring convention — a state with no bosses omits them and `update` treats them as 0/`'playing'`, so no bosses ⇒ no spurious victory. The visible victory screen + loop halt land in a later TQ-011 PR.

- **2026-06-16 (TQ-005) — per-enemy move budget is clamped to one ready step.** The same review found the budget accumulated without bound whenever an enemy couldn't spend it (walled in, or already on the player): the spend loop breaks before decrementing, so the budget grew every tick and then released the whole hoard in a single frame when a path opened — a teleport (e.g. ~5 tiles in one 1/15 s frame after a 20-tick block). Fixed by clamping leftover budget to `<= 1` (`Math.min(budget, 1)`), so a blocked enemy keeps exactly one step ready and never hoards. This is the per-enemy twin of the loop-level "max-frame clamp (anti spiral-of-death)" already recorded in `DECISIONS.md` — same accumulator, same fix.

- **2026-06-17 — `config.ts` (§4) is deferred; balance/timing knobs co-locate with the module that owns them.** §4 listed a single `src/config.ts` for all tunables (fps, viewport, balance knobs); it does not exist yet, and we are not creating it now. Until a dedicated balance-tuning ticket lands it, each knob lives next to the only code that reads it — `SIM_DT` (tick rate) in `game/update.ts`, `MAX_FRAME_MS` (max-frame clamp) in `game/loop.ts`, `CHARGE_RADIUS`/`CHARGE_SPEED_MULTIPLIER` in `game/entities.ts`, and the cellular-gen knobs (`RANDOMIZE_PROBABILITY`, `SMOOTHING_PASSES`, …) in `game/world/generate.ts`.
  - *Why:* while the layer set is still small, every knob has exactly one reader, so co-locating the constant with its module keeps it where it is tuned and read — no indirection through a config file, and no shared file that every module must import (which would re-introduce the cross-module contention the §12 single-leaf-module decisions are trying to avoid). A premature `config.ts` would be a grab-bag of unrelated numbers owned by no module.
  - *When it consolidates:* a dedicated balance-tuning rollup ticket will gather these into `config.ts` once cross-module tuning makes a single knob file worthwhile — i.e. when the §11 "balance/numbers" risk bites and we want to sweep numbers across several modules from one place. Until then, deferral keeps each PR atomic and each constant honest about its single caller. (CLAUDE.md's "Balance knobs live in `config.ts`" line is aspirational under this amendment until that rollup lands.)

- **2026-06-16 (TQ-016) — held-direction input is a *fallback* tier; real key-release via the kitty keyboard protocol is the intended primary (deferred to TQ-019).** This is the input gotcha referenced from `src/input/input.ts` and the TQ-016 artifact.
  - *What we thought:* the foundational constraint was "terminals emit key-DOWN only — there is no key-up." Given that, the only way to keep a held key moving is to lean on the OS keyboard auto-repeat stream. That model has a built-in stall (the OS *initial-repeat delay* of ~250–500 ms before auto-repeat kicks in) and makes movement speed hostage to each user's OS keyboard settings — the exact beta-feel bug TQ-016 set out to kill.
  - *What we found during implementation:* "no key-up" is **no longer universally true.** Modern terminals implement the **[kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)**, an opt-in progressive-enhancement mode that reports real **key-release** (and distinguishes a genuine repeat from a fresh press). It's broadly supported in 2026 — kitty, WezTerm, Ghostty, iTerm2, Alacritty, foot, Rio, and Windows Terminal (Preview 1.25). With release events, "is this direction still held?" becomes a truthful live flag instead of a timeout guess, which removes the tuning window, the coast-after-release, and the reversal-ordering hazard entirely.
  - *So the design is now two tiers, not one,* both feeding the same `Intent` seam so the game loop never changes:
    - **Tier 1 (primary, TQ-019):** at startup, probe for kitty support (`CSI ? u`; silence = unsupported). If present, enable release reporting (`CSI = 2 u`) and drive the held-direction set from true press/release. Restore on exit so we never leave the user's terminal in enhanced mode after a crash.
    - **Tier 2 (fallback, TQ-016 — this work):** when the terminal doesn't support the protocol, infer release by timeout — a direction stays "held" for `HELD_WINDOW_MS` after its last key event. This is the correct, standard fallback for legacy terminals; it just can't escape the coast-after-release tradeoff that real key-up avoids.
  - *Why ship the fallback first:* `terminal-kit` (our input lib, §1) does **not** implement the kitty protocol — confirmed by inspection — so Tier 1 means handling the detection handshake + raw `CSI u` escape parsing + terminal teardown ourselves (or replacing the key path). That's a meaningfully larger, separable chunk, so it gets its own ticket (TQ-019) rather than bloating TQ-016. The held-direction state TQ-016 introduces is exactly the seam Tier 1 plugs into, and it also makes TQ-017 diagonals trivial (read which directions are live).
  - *Layer bet intact:* all of this stays inside the input layer (§2). The simulation still receives only `Intent`s and stays pure — whether a direction left the held-set via a real key-up (Tier 1) or a timeout (Tier 2), `drain()`/`update()` are identical.
