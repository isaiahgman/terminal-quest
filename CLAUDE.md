# CLAUDE.md — Terminal Quest

A real-time terminal action-roguelike with Solo-Leveling power progression (Vampire Survivors × Solo Leveling, in a terminal). Also a deliberate practice of discovery-first, planning-artifact-driven development.

## Read these first
- `docs/prd.md` — what & why; **§2 is the real spec** (the "impossible → trivial" power delta we're chasing)
- `docs/tdd.md` — stack + the pure-sim ⟂ render ⟂ input architecture
- `docs/plan/README.md` — phased roadmap + atomic per-PR artifacts (build in dependency order)

## Stack
TypeScript (strict) · **terminal-kit** (ScreenBuffer rendering + input) · **rot.js** (procedural gen, seeded RNG, FOV, pathfinding) · vitest · pnpm · Node ≥ 18.

## Commands (once PR-000 lands)
- `pnpm dev` — run the game (tsx)
- `pnpm test` — vitest (pure sim/combat/progression)
- `pnpm typecheck` — tsc --noEmit
- `pnpm build` — compile to dist/

## The architecture bet (do not violate)
Three isolated layers:
1. **Simulation** (`src/game/`) — pure `update(state, intents, dt, rng) → state`. No I/O, no drawing. Deterministic via injected seeded RNG.
2. **Render** (`src/render/`) — reads state, draws to ScreenBuffer. **Read-only**, never mutates state.
3. **Input** (`src/input/`) — keypress → intents.

Keep combat/progression math in pure, tested modules (`combat.ts`, `progression.ts`). Never let game math leak into render/input. This is what keeps it testable and lets us add juice (PR-015) safely.

## Execution workflow (how a ticket gets built)
**Never push to `main`.** All work goes through branches + PRs. To pick up a ticket (e.g. PR-005):
1. **Branch + worktree** — `git worktree add ../terminal-quest-pr-005 -b pr-005-<slug>` and work there (isolated from main).
2. **Pick the planning artifact** — `docs/plan/PR-005-*.md`.
3. **Breakdown / context-collection stage** — before coding: read the artifact + its `Depends on` PRs + the PRD/TDD sections it links + the existing code it touches. Restate the goal, list files to change, confirm the Acceptance boxes are objectively checkable, surface unknowns.
4. **Implement** to the acceptance criteria; run `pnpm typecheck` + `pnpm test`.
5. **Commit** on the branch (co-author trailer) and push the **branch** (never `main`).
6. **Open a PR** via the GitHub MCP. PR body format is exactly:
   ```
   ## Summary
   <what & why, 1–3 sentences; link the planning artifact>
   ## Changes
   - <change 1>
   - <change 2>
   ```
7. Update the artifact's `Status` (`ready → in progress → merged`).

> Skills (global): **`/status`** = where we are + the next ticket (dependency-aware, read-only). **`/pick-up PR-NNN`** = the alignment phase — reads PRD+TDD+artifact, makes a plan, talks it through; stops there (no code). Implementation (steps 1, 3–7 above) is a separate step after the plan is agreed.

## Source of truth
**The repo is canonical** — `docs/plan/PR-NNN` artifacts + `docs/prd.md` + `docs/tdd.md`. GitHub Issues are **thin pointers** that map 1:1 to artifact filenames (title + link, never a copy). Never duplicate artifact content into an issue — there must be exactly one place content can change.

## Other conventions
- One PR = one artifact in `docs/plan/` = one branch = one merge.
- Don't start a PR until its Acceptance boxes are objectively checkable.
- **Phases matter:** prove the core dopamine loop (Phases 1–2) *before* adding content (Phases 3–4).
- Balance knobs live in `config.ts` — tune by playing.

## Gotchas
- Real-time + terminal: cap fps (~12–15), use ScreenBuffer **delta** draws (no full clears) to avoid flicker.
- **Always restore the terminal on exit** (incl. crashes) — handle SIGINT/exit. A broken terminal is a failed run.
- Save the **world seed**, not the tile array (world is deterministic from seed).

## Current status
Planning complete (PRD + TDD + PR-000…015 across 4 phases). No code yet — **next step is implementing PR-000 (scaffold).**
