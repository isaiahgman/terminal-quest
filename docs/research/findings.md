# Research findings — Terminal Quest

Synthesis of 8 parallel research streams (rendering, rot.js/algorithms, architecture, horde design, progression math, meta/loot, game juice, prior art). Purpose: de-risk the build and ground our design in best practices before writing code. Sources are linked per section.

---

## TL;DR — what this research changes about our plan

1. **Biggest design risk found:** our *manual, stamina-gated* attack diverges from the genre, where auto-attack exists **specifically to prevent button-mash fatigue**. Fix: low stamina pool, **auto-target within the radius**, share stamina between attacking and dodging, reward *timing/positioning* over mashing. (Updates PRD §6, PR-006/007.)
2. **Terminals have NO key-release events.** Real-time "hold to move" is impossible — design input as repeat-on-press with a decay timer or explicit stop. (Updates PR-003.)
3. **Rendering recipe is settled:** one full-screen terminal-kit `ScreenBuffer`, `noFill`, **one `draw({delta:true})` per frame wrapped in DEC-2026 synchronized output**, render only the camera viewport, render only on change. (Updates PR-001/TDD §1.)
4. **Game loop:** accumulator loop with a **max-frame clamp** (anti "spiral of death"); pass a **constant `SIM_DT`** into `update`, never wall-clock. Skip interpolation (discrete grid). (Updates PR-002/TDD §3.)
5. **RNG:** one seeded generator is the single source of truth; **never `Math.random()`** in the sim. Save the **RNG state + seed**, not the tiles. (Updates PR-004/012, TDD §8/9.)
6. **The "impossible → trivial" delta requires FIXED difficulty zones, not rubber-banding** — if the wall scales with you it's never trivial. Concrete curve: `XP = 50·L^1.8`, additive HP/stamina + geometric ×1.06 damage, stacked with multiplicative weapon/perk milestones → a maxed build is **20–50× a fresh one**. (Updates PR-009/011, TDD §8.)
7. **Don't use `ROT.Display`** — use rot.js for algorithms only (`Map.Cellular` + `connect()`, `RNG`, `Path.Dijkstra` as a shared flow-field, `FOV`), render with terminal-kit. (Updates TDD §1/§7, PR-004/005.)
8. **Study three repos before coding:** `term-survivors` (terminal VS-clone), `typescript-action-roguelike`/COPONGO (sim⟂render architecture), and the Klepinger rot.js+TS tutorial.

---

## 1. Rendering & game loop (engine)

- **terminal-kit `ScreenBuffer` already does delta drawing** — `draw({delta:true})` emits only changed cells. Use one full-screen buffer with `noFill:true`; write all cells with `put()`, then **one** draw per frame. Never interleave `console.log`/stray writes (the #1 flicker cause).
- **Synchronized output (DEC private mode 2026):** wrap each flush in `ESC[?2026h … ESC[?2026l` so supported terminals composite atomically (no tearing). Unsupported terminals ignore it. (This is exactly how Claude Code itself fixed flicker.)
- **Render only the camera viewport** (cost ∝ screen, not world) and **only when state changed**. Hide the cursor during play. Cache per-tile attribute objects.
- **Loop:** do **not** use bare `setInterval` (drifts, coalesces on overrun). Use an accumulator at `SIM_DT = 1000/15`, clamp `min(now-last, 250ms)` before accumulating (spiral-of-death guard), `while (acc >= SIM_DT) update()`, render after. Pass the **constant** `SIM_DT` to `update` (determinism). Skip Gaffer's interpolation — grid cells are discrete.
- **Lifecycle:** `fullscreen(true)` + `hideCursor()` + `grabInput()` on start; **restore on every exit path** (`CTRL_C`, `SIGINT`, `SIGTERM`, `uncaughtException`, `exit`) via `fullscreen(false)` + `grabInput(false)` + show cursor. A crashed game must not leave a broken terminal.
- **Resize:** listen for `resize`, `screen.resize(...)`, force full redraw; enforce a **minimum size** (pause + "terminal too small" message below it).
- **Library choice confirmed:** terminal-kit (frame-level control + delta) over blessed (retained-mode widgets) and Ink (React reconciler) for a real-time game.

Sources: terminal-kit [ScreenBuffer](https://github.com/cronvel/terminal-kit/blob/master/doc/ScreenBuffer.md) · [docs](https://github.com/cronvel/terminal-kit/blob/master/doc/documentation.md) · [flicker/DEC-2026 (HN)](https://news.ycombinator.com/item?id=46699072) · [accurate Node loop](https://timetocode.tumblr.com/post/71512510386/an-accurate-nodejs-game-loop-inbetween-settimeout) · [Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/) · [building terminal UIs](https://blog.openreplay.com/building-terminal-interfaces-nodejs/)

## 2. World gen & algorithms (rot.js)

- **Map:** `ROT.Map.Cellular` (not Digger/Uniform — those make rooms+corridors that funnel a swarm single-file). `randomize(0.45)` (0.40–0.50 = open-with-cover), 3–5 `create()` smoothing passes, then **always `connect()`** (or you strand enemies/loot on islands).
- **RNG:** `ROT.RNG` is a shared seeded (Alea) generator that all rot.js gen uses — make it the single source. **Hash string seeds → positive int** (string/0/negative seeds are silently mishandled). No avalanche: adjacent seeds look identical, so don't use seed N vs N+1 for "different" worlds. Persist `RNG.getState()`/`setState()` for exact mid-run resume.
- **Pathfinding for the swarm:** build **one `ROT.Path.Dijkstra` flow-field toward the player per tick**; every enemy reads its next step in O(1). Do **not** run per-enemy A* each frame (O(N·map) → stutter). Greedy "step toward player" only as a fast fallback with clear LOS. `ROT.Path` treats all edges as cost 1.
- **FOV:** ship **without** fog-of-war first (full viewport = readable action). Add `RecursiveShadowcasting` later, recomputed only when the player's tile changes — never per-enemy.
- **Skip `ROT.Scheduler`/`Engine`** (turn-based, lock-based) — roll our own fixed-timestep loop; model entity speed as cooldown counters advanced by `dt`.
- **`rot-js` is TS-native** (types included). Import `import * as ROT from "rot-js"`; use `moduleResolution: "bundler"`/`"node16"` for clean ESM resolution.

Sources: [rot.js manual](https://ondras.github.io/rot.js/manual/) · [path manual](https://github.com/ondras/rot.js/blob/master/manual/pages/path.html) · [cellular](https://github.com/ondras/rot.js/blob/master/manual/pages/map/cellular.html) · [RNG seeding caveats](https://github.com/ondras/rot.js/issues/184) · [Dijkstra flow-maps vs A*](https://pwmarcz.pl/blog/making-grass-4/) · [LogRocket rot.js](https://blog.logrocket.com/building-a-roguelike-game-with-rot-js/)

## 3. Architecture, determinism & save

- **Hard split: pure `core/` vs impure `shell/`.** `core/` has `update(state, intents, dt, rng) -> state`, world-gen-from-seed, entity logic — **no fs, no `Date.now()`, no `Math.random()`**. `shell/` owns the loop, terminal renderer, input, save I/O, clock. This makes vitest trivial.
- **Determinism = seed + same RNG-call order + fixed iteration order + fixed timestep.** Doubles as a replay/debug system: a session = `{seed, initial state, ordered intents}`. Add a **golden replay test** (run N ticks → hash final state).
- **RNG:** inject a tiny seedable PRNG (Mulberry32, ~5 lines) *or* use `ROT.RNG` as the one source — pick one and route **all** randomness through it. Store its state in the save.
- **Entities:** plain arrays/structs, **not ECS** (ECS only pays off at ~1k+ entities; we have dozens). Stable iteration order for determinism.
- **State:** one `GameState`; reducer-shaped `update` with controlled mutation *inside* (don't deep-clone every frame; don't use Immer in the hot loop). Never mutate the object the renderer currently holds.
- **Save:** envelope `{saveVersion, schema, timestamp, data}`; **save seed + RNG state + entity/player/progress, not tiles** (regenerate world from seed); **atomic write** (temp file → `rename`); throttled async autosave (never block the loop); stepwise migration runner; store via `env-paths` (XDG/macOS/Windows aware), not hardcoded `~/.app`.

Sources: [Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/) · [Mulberry32](https://emanueleferonato.com/2026/01/08/understanding-how-to-use-mulberry32-to-achieve-deterministic-randomness-in-javascript/) · [no seedable Math.random](https://healeycodes.com/creating-randomness) · [ECS: when it's worth it](https://www.josephodowd.com/blog/8) · [practical save systems](https://arcadeonstudios.co.uk/blog/a-practical-save-system-for-indie-games-versioned-portable-testable)

## 4. Combat & horde design (the core loop)

- **The genre's addiction is a 3-act *spiral* per run** (underdog → "the squeeze" → godlike), ~15–25 min, with **relentless reward cadence** (something good every few seconds) and **level-up *choices*** for self-expression.
- **⚠ Our stamina-gated manual attack is the biggest divergence and risk.** Auto-attack in VS exists to spend the player's attention on *positioning*, not mashing. To keep ours engaging: **low max stamina** (each attack matters), **share the stamina pool between attacking and repositioning/dodging** (built-in risk/reward), **auto-target within the radius** (keep aiming automatic), add a **post-attack no-regen recovery beat** + **soft exhaustion lock**, and **allow overspend** (players can't judge exact thresholds). Reward *when/which*, not *how fast*.
- **Spawning:** spawn **off-camera**, despawn fled enemies; **never blind-instakill** (VS's mid-screen Death at 30:00 is the canonical mistake) — telegraph any central spawn 1–2 beats early. Ramp **density and stat-scaling separately** (~1 new wave/min). Use **spike waves** to reset tension.
- **Readability (ASCII is an advantage):** categorical glyphs (letters=monsters, punctuation=pickups), **color = threat priority only**, low-contrast terrain so threats pop, **square grid aspect** so distance reads equally, draw threats on top of pickups, **telegraph your own attack radius**.

Sources: [VS power-fantasy analysis](https://www.kokutech.com/blog/gamedev/design-patterns/power-fantasy/vampire-survivors) · [the spiral loop](https://www.lostatticgames.com/post/how-vampire-survivors-made-me-rethink-the-concept-of-the-core-gameplay-loop) · [stamina design](https://www.hedberggames.com/blog/design-thinking-stamina-in-action-games) · [bullet-hell info/fairness](https://abstractinggames.com/2021/06/20/297/) · [Cogmind ASCII vs tiles](https://www.gridsagegames.com/blog/2015/02/ascii-vs-tiles/) · [Brotato wave numbers](https://brotato.wiki.spellsandguns.com/Waves)

## 5. Progression math (the dopamine engine)

- **Two separate knobs:** XP curve = *how often* you ding; power curve = *how strong* each ding feels. Solo-Leveling feel = shallow XP curve (frequent dings) + steepening power.
- **XP:** polynomial `XP_to_next(L) = round(50 · L^1.8)` — snappy early (levels 1–8 in the first ~10 min), earned tail. Keep `XP_per_kill ≈ 50 · zone_level` so kills-per-level stays ~8–25.
- **Power:** additive, readable base early — `HP = 100 + 15(L-1)`, `Stamina = 100 + 8(L-1)`, `Damage = 10 · 1.06^(L-1)` — then **stack multiplicative milestones**: weapon tiers (×1.5 each) + milestone perks at L5/10/15/… (multipliers/new mechanics, not flat stats). Effective late build = **20–50× fresh**.
- **The "wall → trivial" moment needs FIXED difficulty zones** (enemy HP ≈ `80·1.35^N`, dmg ≈ `8·1.25^N`), **gate bosses by effective power**, tune to **TTK targets** (trash 0.5–1.5s, elite 5–10s, boss 45–120s when appropriately powered; a returning over-powered player kills a beaten boss in <10s — that collapse *is* the payoff). **Never rubber-band** a wall you've beaten.
- **Reward cadence:** feedback every 30–90s, a telegraphed milestone (~per session), known-milestone + variable-reward combos. Keep every constant **data-driven** in `config.ts` and tune from playtest TTK.

Sources: [RPG level math](https://www.davideaversa.it/blog/gamedesign-math-rpg-level-based-progression/) · [power progression](https://www.gamedeveloper.com/design/power-progression-in-games-crafting-rewarding-player-experiences) · [enemy scaling techniques](https://medium.com/@dalemensik413/my-favorite-enemy-scaling-techniques-in-video-games-be27f1bf22ed) · [make the grind feel good](https://www.wayline.io/blog/make-the-grind-feel-good-designing-engaging-progression-systems)

## 6. Meta-progression, loot & world structure

- **Roguelite persistence = die→invest→return stronger** (failure feels productive). Its failure mode: early game drifts trivial, first win becomes a **grind-check not a skill-check**. Guard against it.
- **Meta-progression should add OPTIONS, not numbers** (Hades/Dead Cells): unlock new weapons into the pool, new access, new loadouts — reserve flat +stats for a small capped slice. **Gate difficulty tiers behind boss kills** (Dead Cells "Stem Cell" ladder — our 10 bosses = a natural 10-rung ladder). **Cap meta power so skill stays decisive.** **Rising upgrade costs** (Rogue Legacy 2) force prioritization. **Every death pays out** something.
- **Single weapon slot is an asset:** every drop is a keep/swap decision — but only if weapons have **identity** (range/pattern/on-hit), not just higher DPS; rarity raises ceiling + adds quirks, never strictly-better. **Weapon upgrades = commitment mechanic** (sink currency into the equipped weapon → a new drop is a real gamble). Avoid dead/strictly-dominated drops.
- **World (Elden Ring lessons):** use **geography as the difficulty signpost** (distance-from-base ≈ difficulty), flexible boss order with a small mandatory subset/threshold to reach the finale, **gentle power gains** (a +upgrade helps but never carries a fight), dungeons = opt-in high-risk/high-reward (best weapons + upgrade mats + base resources).

Sources: [roguelike vs roguelite](https://pudgycat.io/roguelike-vs-roguelite-difference-explained/) · [Hades narrative rewards](https://www.gamedeveloper.com/design/how-supergiant-weaves-narrative-rewards-into-i-hades-i-cycle-of-perpetual-death) · [Elden Ring open-world design](https://game-wisdom.com/critical/elden-ring-ignores-20-years-open-world-design) · [Gungeon variety](https://www.cbr.com/enter-the-gungeon-variety-indie-roguelike/) · [stat-meta-progression pitfalls](https://www.resetera.com/threads/im-starting-to-feel-that-stat-based-meta-progression-is-starting-to-ruin-roguelites-generally-speaking.1509337/page-2)

## 7. Game juice / feel (render-only)

- **Architecture:** sim emits **fire-and-forget events** (`HIT`, `DEATH`, `WINDUP`, `STAMINA_EMPTY`); a **render-side effects layer** turns them into effects with **frame-lifetimes** (ttl in frames). Sim stays pure; cosmetic RNG uses a separate stream. Make effect params **data-driven** (Cogmind-style).
- **Highest impact-vs-effort, ranked:** (1) **hit-stop** — freeze 1–2 frames on a meaningful hit; nearly free at 15 fps and textbook game-feel; (2) **hit flash** — 1–2 frame glyph/color swap on the struck cell; (3) **floating damage numbers** (rise + color-ramp by magnitude); (4) **screen shake** — offset the *viewport* ±1 cell, decay in ~3 frames, **big hits only**; (5) color ramps; (6) **glyph particles**; (7) **attack windup telegraph**; (8) HUD garble on player hit; (9) low-HP/stamina border glow.
- **Make the heavy/risky attack feel heavy:** telegraph windup, give it the *full* juice stack (2-frame hit-stop, big shake, bold number, more particles) vs a minimal flash for light attacks — contrast sells weight.
- **Constraints:** readability is sacred (glyphs carry meaning — don't occlude threats), short particle ttls (3–6 frames; fade in place, don't teleport), small consistent color language, **toggles** for shake/flash (accessibility), never let juice leak into the sim.

Sources: [Art of Screenshake](https://www.youtube.com/watch?v=AJdEqssNZ-U) · [Juice it or lose it](https://www.youtube.com/watch?v=Fy0aCDmgnxg) · [Cogmind particle engine](https://www.gridsagegames.com/blog/2014/03/particle-effects/) · [Cogmind GUI feedback](https://www.gridsagegames.com/blog/2013/11/gui-animation/) · [telegraphing](https://www.gamedeveloper.com/design/enemy-attacks-and-telegraphing)

## 8. Prior art to study (before coding)

| Project | Why |
|---|---|
| [kimulaco/term-survivors](https://github.com/kimulaco/term-survivors) (Rust) | Nearest neighbor — terminal VS-clone with auto-fire, pause, saves, and a **headless `simulate` mode** for auto-tuning difficulty (steal this). |
| [Mustafa-Kum/typescript-action-roguelike (COPONGO)](https://github.com/Mustafa-Kum/typescript-action-roguelike) | Best **architecture** match: fixed-tick `GameEngine` ⟂ renderer ⟂ UI, system-per-domain (Director/Wave/Weapon/Collision…), spatial grid + object pooling. Swap Pixi for terminal-kit. |
| [Klepinger rot.js + TypeScript + Vite tutorial](https://klepinger.dev/rotjs-tutorial) (13 parts) | Our exact stack for algorithms — entities, gen, FOV, combat, save/load, leveling, equipment. |
| [xi/survivor](https://github.com/xi/survivor) (Rust) | Real-time terminal, 30fps fixed loop, sub-cell positioning — and the **no-key-release-events** gotcha. |
| [Cogmind: Turn/Time systems](https://www.gridsagegames.com/blog/2019/04/turn-time-systems/) | Model actor speed as time-unit costs even in real-time. |

**Cautionary tales:** terminals have **no key-up events** (design input around it); **full-screen redraws flicker** (diff/delta is mandatory); **compute scales with window size** (cap the playfield); **monolithic engines rot** (keep systems narrow, sim pure).

---

## Impacts on our planning artifacts

| Artifact | Change to fold in |
|---|---|
| `prd.md` §6 | Reframe combat: low-stamina + auto-target + shared offense/defense pool; reward timing/positioning not mashing |
| `tdd.md` §1,3,7,8,9 | terminal-kit delta + DEC-2026; accumulator loop + constant SIM_DT; rot.js algorithms only (no Display); single seeded RNG; save seed+RNG-state via env-paths + atomic write |
| PR-002 | Accumulator loop w/ max-frame clamp; render-on-change |
| PR-003 | **No key-release** input model (repeat-on-press + decay / stop key); square-grid aspect |
| PR-004 | `Map.Cellular` + `connect()`; hash string seed→int; determinism rules |
| PR-005 | Dijkstra flow-field per tick (not per-enemy A*); spawn off-camera + telegraph |
| PR-006/007 | Stamina model fix; auto-target in radius; overspend + recovery beat; attack windup |
| PR-009/011 | `XP=50·L^1.8`; additive base + ×1.06 dmg + multiplicative milestones; **fixed zones, no rubber-band**; boss gating by effective power; TTK targets |
| PR-010 | Weapon **identity** + upgrade-as-commitment; no strictly-dominated drops |
| PR-012 | Save seed + RNG state (not tiles); atomic temp→rename; env-paths; throttled async |
| PR-013 | Meta = options not numbers; rising costs; every death pays out |
| PR-015 | Event-buffer effects w/ frame-ttl; hit-stop + flash + numbers + ±1 shake; toggles |
| New: PR-0xx | Consider a **headless sim/replay mode** (à la term-survivors) for automated balance tuning |
