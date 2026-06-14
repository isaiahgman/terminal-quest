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

## How we work here
- **One PR = one artifact in `docs/plan/` = one branch (`pr-000-scaffold`) = one merge.**
- Don't start a PR until its Acceptance boxes are objectively checkable. Update its `Status` (`ready → in progress → merged`).
- **Phases matter:** prove the core dopamine loop (Phases 1–2) *before* adding content (Phases 3–4).
- Balance knobs live in `config.ts` — tune by playing.

## Gotchas
- Real-time + terminal: cap fps (~12–15), use ScreenBuffer **delta** draws (no full clears) to avoid flicker.
- **Always restore the terminal on exit** (incl. crashes) — handle SIGINT/exit. A broken terminal is a failed run.
- Save the **world seed**, not the tile array (world is deterministic from seed).

## Current status
Planning complete (PRD + TDD + PR-000…015 across 4 phases). No code yet — **next step is implementing PR-000 (scaffold).**
