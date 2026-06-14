# CLAUDE.md — Terminal Quest

A turn-based fantasy micro-RPG in the terminal (animated ASCII combat). This project is also a deliberate practice of discovery-first, planning-artifact-driven development.

## Read these first
- `docs/prd.md` — what & why
- `docs/tdd.md` — stack, architecture, key decisions
- `docs/plan/README.md` — the roadmap + atomic per-PR artifacts (build in dependency order)

## Stack
TypeScript (strict) · Ink (React for terminal) · vitest · pnpm · Node ≥ 18.

## Commands (once PR-000 lands)
- `pnpm dev` — run the game (tsx watch)
- `pnpm test` — vitest (engine)
- `pnpm typecheck` — tsc --noEmit
- `pnpm build` — compile to dist/

## How we work here
- **One PR = one artifact in `docs/plan/` = one branch = one merge.** Branch names: `pr-000-scaffold`, etc.
- Don't start a PR until its Acceptance boxes are objectively checkable. Update the artifact's `Status` (`ready → in progress → merged`) as you go.
- Keep the **engine pure** (`src/engine/`, no React, injectable RNG) and **screens dumb** (no game math). This separation is the core architectural bet — preserve it.
- Content lives as typed data in `src/data/`; abilities/items are data-driven effects so the engine stays generic.

## Conventions / gotchas
- `jsx: react-jsx` (no `import React` needed).
- Always clear animation timers on unmount.
- Commit `pnpm-lock.yaml`.

## Current status
Planning complete (PRD + TDD + PR-000…011). No code yet — **next step is implementing PR-000 (scaffold).**
