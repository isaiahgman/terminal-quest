# PR-000 — Project scaffold
Status: ready · Depends on: none · Scope: ~S · Touches: package.json, tsconfig.json, src/cli.ts

## Context
Foundation for everything ([tdd §1,4](../tdd.md#1-stack)). Establishes the TS + terminal-kit + rot.js toolchain.

## Goal
Merged means: `pnpm dev` opens a full-screen terminal, draws a placeholder, and **restores the terminal cleanly** on `q`/Ctrl-C.

## Acceptance
- [ ] `pnpm install` succeeds with a committed lockfile
- [ ] deps: `terminal-kit`, `rot-js`; dev: `typescript`, `tsx`, `vitest`, `@types/node`
- [ ] scripts: `dev` (tsx src/cli.ts), `build` (tsc), `test` (vitest), `typecheck` (tsc --noEmit)
- [ ] `pnpm dev` enters fullscreen, prints "Terminal Quest", and on quit **restores the terminal** (cursor shown, screen normal — no garbled state)
- [ ] `pnpm typecheck` passes with `strict: true`
- [ ] `bin` field set for future `npx`

## Plan
1. `pnpm init`; add deps above.
2. `tsconfig.json`: strict, `module: nodenext`, `target: es2022`.
3. `src/cli.ts`: grab terminal, `fullscreen(true)`, draw text, listen for `q`/CTRL_C → `fullscreen(false)` + `processExit`.

## Constraints
- No game logic yet. The **terminal-restore-on-exit** path is mandatory — a crashing roguelike that leaves a broken terminal is unacceptable.

## Notes
- Wrap exit cleanup so it also runs on uncaught errors (process `exit`/`SIGINT` handlers).
