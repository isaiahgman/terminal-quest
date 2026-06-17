# Plan — atomic PR artifacts

The [PRD](../prd.md) and [TDD](../tdd.md) decomposed into **shippable PRs**, each with objective acceptance criteria. Build in dependency order. Format: [`TEMPLATE.md`](TEMPLATE.md).

Strategy: **prove the core dopamine loop before adding content.** Phases 1–2 deliver a *playable, addictive feel*; phases 3–4 add the full vision (10 bosses, base, dungeons, juice).

## Phase 1 — Engine & rendering foundation
| PR | Title | Depends on |
|----|-------|-----------|
| [000](PR-000-scaffold.md) | Project scaffold (TS + terminal-kit + rot.js) | — |
| [001](PR-001-tile-render.md) | Tile renderer (ScreenBuffer) | 000 |
| [002](PR-002-game-loop.md) | Fixed-timestep game loop | 001 |
| [003](PR-003-movement-camera.md) | Player movement + following camera | 002 |
| [004](PR-004-procedural-world.md) | Procedural world gen + collision | 003 |

## Phase 2 — Core combat loop (the dopamine core)
| PR | Title | Depends on |
|----|-------|-----------|
| [005](PR-005-chasing-enemies.md) | Enemies that hunt you on a clock | 004 |
| [006](PR-006-combat-engine.md) | Combat engine: radius + stamina + hit-chance (pure, tested) | 005 |
| [007](PR-007-attack-types-stamina.md) | 1–3 named attack types (risk/reward) wired to input | 006 |
| [008](PR-008-hud.md) | HUD: health / stamina / level | 007 |
| [009](PR-009-leveling-progression.md) | Leveling + power curve (pure, tested) | 006 |

**◆ MVP cut line** — after PR-009 (+ a starting weapon from 010) the core loop is playable and *feels* like the game.

## Phase 3 — Progression & content
| PR | Title | Depends on |
|----|-------|-----------|
| [010](PR-010-weapons.md) | Weapons: slot, random drops, equip, damage | 006, 009 |
| [011](PR-011-bosses.md) | Bosses (1 first, design for 10) + win condition | 007, 009 |
| [012](PR-012-save-load.md) | Save / autosave (resume where you were) | 004, 009 |
| [013](PR-013-growing-base.md) | Growing home base (persistent meta) | 012 |

## Phase 4 — Depth & polish (stretch)
| PR | Title | Depends on |
|----|-------|-----------|
| [014](PR-014-dungeons.md) | High-risk/high-reward dungeons | 011 |
| [015](PR-015-juice-game-feel.md) | Juice: hit flashes, damage numbers, screen shake | 008 |

## Beta feedback — input feel (2026-06-15)
Surfaced by play-testing the merged movement build. All three touch the input layer (`src/input/input.ts`); 017 and 018 both build on 016's held-direction state (independently of each other). 018 was discovered *during* 016 — see [`tdd.md` §12](../tdd.md).
| PR | Title | Depends on |
|----|-------|-----------|
| [016](PR-016-input-responsiveness.md) | Responsive held-direction movement (kill the OS key-repeat stall) — timeout fallback tier | 003 |
| [017](PR-017-diagonal-movement.md) | Diagonal (8-direction) movement | 016 |
| [018](PR-018-kitty-keyboard-release.md) | Real key-release via the kitty keyboard protocol (no-coast primary tier) | 016 |

## Dependency graph (spine)
```
000─001─002─003─004─005─006─┬─007─┬─008────────────┐
                            │     └─011             ├─015
                            ├─009─┴─010             │
                            └─(004,009)─012─013     │
                                         011─014────┘
```

## Conventions
- One PR = one artifact = one branch (`pr-000-scaffold`) = one merge.
- A PR is **ready** only when its Acceptance boxes are objectively checkable.
- Keep the **simulation pure** and the **renderer read-only** — never let game math leak into render/input. This is the bet that keeps the whole thing testable and lets us add juice safely later.
- Update each artifact's `Status` (`ready → in progress → merged`) as it moves.
