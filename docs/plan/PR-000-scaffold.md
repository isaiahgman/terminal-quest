# PR-000 — Project scaffold
Status: ready · Depends on: none · Scope: ~S · Touches: package.json, tsconfig.json, src/cli.tsx, .npmrc

## Context
Foundation for every later PR. Establishes the TS + Ink toolchain from [tdd §1–3](../tdd.md#1-stack).

## Goal
Merged means: `pnpm dev` launches and renders a "Terminal Quest" placeholder screen via Ink.

## Acceptance
- [ ] `pnpm install` succeeds with a committed lockfile
- [ ] `package.json` has scripts: `dev` (tsx watch src/cli.tsx), `build` (tsc), `test` (vitest), `typecheck` (tsc --noEmit)
- [ ] `pnpm dev` renders a colored "Terminal Quest" line and exits cleanly on `q`/Ctrl-C
- [ ] `pnpm typecheck` passes with `strict: true`
- [ ] `bin` field points at the built entry so `npx` can run it later

## Plan
1. `pnpm init`; add deps: `ink`, `react`; dev: `typescript`, `tsx`, `vitest`, `@types/react`, `chalk`.
2. `tsconfig.json`: strict, `jsx: react-jsx`, `module: nodenext`, `target: es2022`.
3. `src/cli.tsx`: `#!/usr/bin/env node`, `render(<App/>)` where `App` shows a chalk-colored title + "press q to quit" (`useInput` + `useApp().exit`).
4. Add scripts + `bin`.

## Constraints
- Node ≥ 18 only. No bundler yet. Keep `App` trivial — real shell is PR-001.

## Notes
- `jsx: react-jsx` avoids needing `import React`.
- Commit `pnpm-lock.yaml`.
