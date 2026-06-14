# Decisions & lessons

A running log of the meaningful choices and the lessons learned building Terminal Quest. The *what/how* lives in `prd.md`/`tdd.md`/`plan/`; this captures the *why* and the process learnings so they aren't lost.

## Product / design decisions
- **Genre: real-time terminal action-roguelike** (Vampire Survivors × Solo Leveling). The terminal is the *native* home for roguelikes, not a compromise.
- **The real spec is a feeling:** the Solo-Leveling "impossible → trivial" power delta (`prd.md` §2). Every system serves it.
- **Combat (revised by research):** stamina-gated *radius* attacks, but **auto-target within the radius** and a **low, shared stamina pool** (attacking vs. dodging draw from the same pool). Reward *timing/positioning*, not button-mashing — the genre auto-attacks on purpose to spend the player's attention on positioning. See `docs/research/findings.md` §4.
- **Power fantasy needs FIXED difficulty zones, not rubber-banding** — if the wall scales with you it's never trivial. Curve: `XP=50·L^1.8`, additive base stats + geometric ×1.06 damage + multiplicative weapon/perk milestones → a maxed build ≈ 20–50× a fresh one. See findings §5.

## Technical decisions
- **terminal-kit over Ink** — Ink's React reconcile model fits menus, not a 15-fps real-time game. terminal-kit's `ScreenBuffer` (delta draw) is the right tool.
- **rot.js for algorithms only** — do NOT use `ROT.Display`. Use `Map.Cellular` + `connect()`, seeded RNG, `Path.Dijkstra` (flow-field for the swarm), FOV.
- **Pure sim ⟂ read-only render ⟂ input** — the load-bearing bet. Pure modules are unit-tested; the renderer can be upgraded (juice) without touching game rules.
- **Determinism** — one injected seeded RNG, never `Math.random`. Save the **seed + RNG state**, not the tiles (the world regenerates from seed).
- **Loop** — fixed-timestep accumulator with a max-frame clamp (anti spiral-of-death); pass a constant `SIM_DT`, not wall-clock.
- **Input** — terminals have **no key-up event**, so movement is "repeat on press" (each keydown + OS auto-repeat enqueues one intent, drained per tick).
- **npm, not pnpm** — corepack's pnpm didn't activate on this machine; lockfile is `package-lock.json`.

## Process lessons (carry to the next project)
- **Scope planning artifacts SMALLER.** Ours each map to ~3–5 real PRs. Keep PRs tiny; one artifact → several small PRs; never combine artifacts; never ship a massive PR. (Mistake made & corrected: combining PR-002+003 into one PR.)
- **Strictest tooling, no hacks.** Fix the code, not the linter. No `eslint-disable`/`@ts-ignore`/`any`/speculative-unused code. (Mistake made & corrected: an eslint rule override to dodge an unused param.)
- **Isaiah merges every PR.** Agents open PRs and stop.
- **Stacked-PR footgun:** merging a PR and deleting its base branch auto-closes child PRs. So **base every PR on `main`**; build one → merge → next.
- **Parallelize the pure modules, integrate sequentially.** The shared files (`cli.ts`, `update.ts`, `renderer.ts`, `sprites.ts`, `state.ts`) are the chokepoint; pure `src/game/*` modules fan out cleanly across agents/worktrees.
- **Do the research first** — a parallel research pass (`docs/research/findings.md`) reshaped the combat, progression, save, and rendering plans *before* coding.
