# CLAUDE.md — Terminal Quest

A real-time terminal action-roguelike with Solo-Leveling power progression (Vampire Survivors × Solo Leveling, in a terminal). Also a deliberate practice of discovery-first, planning-artifact-driven development.

## Read these first

- `docs/prd.md` — what & why; **§2 is the real spec** (the "impossible → trivial" power delta we're chasing)
- `docs/tdd.md` — stack + the pure-sim ⟂ render ⟂ input architecture
- `docs/plan/README.md` — phased roadmap + atomic `TQ-NNN` artifacts (build in dependency order)

## Stack

TypeScript (strict) · **terminal-kit** (ScreenBuffer rendering + input) · **rot.js** (procedural gen, seeded RNG, FOV, pathfinding) · vitest · ESLint + Prettier · **npm** · Node ≥ 18.

## Commands

- `npm run dev` — run the game (tsx)
- `npm test` — vitest (pure sim/combat/progression)
- `npm run typecheck` — tsc --noEmit
- `npm run lint` / `npm run format` — ESLint / Prettier
- `npm run check` — **the feedback loop**: typecheck + lint + test (must be green before any PR)
- `npm run build` — compile to dist/

⚠️ We use **npm** (corepack's pnpm didn't activate); lockfile is `package-lock.json`, not pnpm.

## The architecture bet (do not violate)

Three isolated layers:

1. **Simulation** (`src/game/`) — pure `update(state, intents) → state` (add params like `dt`/`rng` only when actually used). No I/O, no drawing, no `Math.random`. Deterministic via an injected seeded RNG.
2. **Render** (`src/render/`) — reads state, draws to ScreenBuffer. **Read-only**, never mutates state.
3. **Input** (`src/input/`) — keypress → intents.

Keep combat/progression math in pure, tested modules (`combat.ts`, `progression.ts`). Never let game math leak into render/input. This is what keeps it testable and lets us add juice (TQ-015) safely.

## Execution workflow (how a ticket gets built)

**Never push to `main`.** All work goes through branches + PRs. To pick up a ticket (e.g. TQ-005):

1. **Branch + worktree** — `git worktree add ../terminal-quest-tq-005 -b tq-005-<slug>` and work there (isolated from main).
2. **Pick the planning artifact** — `docs/plan/TQ-005-*.md`.
3. **Breakdown / context-collection stage** — before coding: read the artifact + its `Depends on` PRs + the PRD/TDD sections it links + the existing code it touches. Restate the goal, list files to change, confirm the Acceptance boxes are objectively checkable, surface unknowns.
4. **Implement** to the acceptance criteria; run `npm run check` (typecheck + lint + test) — must be green.
5. **Commit** on the branch (co-author trailer) and push the **branch** (never `main`).
6. **Open a PR** via the GitHub MCP. **End the title with a `(TQ-NNN)` tag** (e.g. `feat(combat): named attack types (TQ-007)`) — this is how ticket status is derived; an untagged title leaves the ticket invisible to the tracker. PR body format is exactly:
   ```
   ## Summary
   <what & why, 1–3 sentences; link the planning artifact>
   ## Changes
   - <change 1>
   - <change 2>
   ```
7. **Don't hand-edit status.** It's derived from PRs — run `node scripts/status.mjs --write` to regenerate `docs/plan/STATUS.md`. Artifacts carry no `Status:` line.

> Skills (global): **`/status`** = where we are + the next ticket (dependency-aware, read-only). **`/pick-up TQ-NNN`** = the alignment phase — reads PRD+TDD+artifact, makes a plan, talks it through; stops there (no code). Implementation (steps 1, 3–7 above) is a separate step after the plan is agreed.

## Source of truth

**The repo is canonical** — `docs/plan/TQ-NNN` artifacts + `docs/prd.md` + `docs/tdd.md`. GitHub Issues are **thin pointers** that map 1:1 to artifact filenames (title + link, never a copy). Never duplicate artifact content into an issue — there must be exactly one place content can change.

> **Namespaces:** `TQ-NNN` = a plan artifact (canonical, in `docs/plan/`). `#N` = a GitHub pull request. One `TQ-NNN` normally ships as several `#N` PRs — they are **not** the same number (`TQ-004` ≠ `#4`). Say `TQ-NNN` for plan work, `#N` for PRs.

## Standards & PR discipline

- **Strictest ESLint + Prettier — no exceptions.** Never disable/loosen a rule; no `eslint-disable` / `@ts-ignore` / `any` / `_`-prefix tricks; no speculative unused code (add a param/field only when something uses it). Fix the code, not the config. `npm run check` must be green before every PR.
- **Tiny, atomic PRs.** One planning artifact normally maps to _several_ small PRs — that's expected. Never combine artifacts into one PR; never ship a massive PR; when unsure, split smaller.
- **Isaiah merges every PR — never merge one yourself.** Base every PR on `main` (no stacking: a deleted base branch auto-closes its child PRs).
- Don't start a PR until its Acceptance boxes are objectively checkable.
- **Phases matter:** prove the core dopamine loop (Phases 1–2) _before_ adding content (Phases 3–4).
- Balance knobs are **co-located with the module that reads them** (e.g. `SIM_DT` in `game/update.ts`, charge knobs in `game/entities.ts`, the curve in `game/progression.ts`) — tune by playing. A single `config.ts` is **deferred** until a balance-tuning rollup justifies it; see [`tdd.md` §12](docs/tdd.md). (This line previously said "live in `config.ts`," which never existed — corrected to match the §12 amendment.)

## Working in parallel (safe fan-out)

The **pure logic modules** in `src/game/` (e.g. `rng.ts`, `world/generate.ts`, `enemy.ts`, `combat.ts`) are independent — multiple agents can build them at once, each in its own worktree and its own file. **Integration** (wiring into the shared files: `cli.ts`, `game/update.ts`, `render/renderer.ts`, `render/sprites.ts`, `game/state.ts`) is the sequential chokepoint — do those one PR at a time to avoid conflicts.

## Gotchas

- Real-time + terminal: cap fps (~12–15), use ScreenBuffer **delta** draws (no full clears) to avoid flicker.
- **Always restore the terminal on exit** (incl. crashes) — handle SIGINT/exit. A broken terminal is a failed run.
- Save the **world seed**, not the tile array (world is deterministic from seed).

## Current status

**Status is derived, not hand-maintained here.** The single source of truth is [`docs/plan/STATUS.md`](docs/plan/STATUS.md), generated from PRs by `node scripts/status.mjs` (`--write` to update the file). It drove every batch's drift when kept by hand — so we don't anymore. For the phased order and dependencies, see [`docs/plan/README.md`](docs/plan/README.md).
