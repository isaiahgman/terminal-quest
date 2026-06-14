# Terminal Quest ⚔️

A small, charming **turn-based fantasy RPG that runs in your terminal** — animated ASCII characters, real combat, and a boss to slay. Built to be delightful to play for ~10 minutes and a joy to read the code of.

> Status: **planning** — this repo currently holds the full planning trail. Code lands PR by PR.

## Play (once built)
```bash
npx terminal-quest      # or: pnpm dev
```

## How this project is built
This is a deliberate practice in **discovery-first development**: every line of code traces back to a planning artifact.

- [`docs/prd.md`](docs/prd.md) — what we're building and why
- [`docs/tdd.md`](docs/tdd.md) — how it's built (stack, architecture, decisions)
- [`docs/plan/`](docs/plan/) — the PRD/TDD decomposed into **atomic, per-PR planning artifacts**, each shippable on its own

## Stack
TypeScript · [Ink](https://github.com/vadimdemedes/ink) (React for the terminal) · vitest · pnpm
