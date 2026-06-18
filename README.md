# Terminal Quest ⚔️

A **real-time terminal action-roguelike** with **Solo-Leveling-style power progression**. Move through a big procedural world, get swarmed by enemies that hunt you on a clock, fight back with stamina-gated **radius attacks**, level up, find weapons, grow your base, and hunt down **10 bosses**. Persistent progression — you keep your power across sessions.

> Think **Vampire Survivors × Solo Leveling, in your terminal.**
>
> Status: **planning** — this repo holds the full planning trail. Code lands PR by PR.

## The feeling we're chasing
Solo Leveling is addictive because it shows you a wall you *cannot* beat — then, through grind, makes that same wall trivial. **That power-delta is the whole product.**

## Play (once built)
```bash
npx terminal-quest      # or: npm run dev
```

## How this is built — discovery-first
Every line of code traces back to a planning artifact:
- [`docs/prd.md`](docs/prd.md) — what & why (the feeling, the loop, the features)
- [`docs/tdd.md`](docs/tdd.md) — how (stack, the pure-sim ⟂ render architecture, decisions)
- [`docs/plan/`](docs/plan/) — the PRD/TDD decomposed into **atomic, per-PR planning artifacts**, sequenced in phases (prove the core loop, *then* add content)

## Stack
TypeScript · [terminal-kit](https://github.com/cronvel/terminal-kit) (real-time rendering + input) · [rot.js](https://ondras.github.io/rot.js/) (procedural gen, FOV, pathfinding) · vitest · npm
