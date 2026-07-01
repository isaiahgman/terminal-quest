# Plan — atomic `TQ-NNN` artifacts

The [PRD](../prd.md) and [TDD](../tdd.md) decomposed into **shippable slices** (`TQ-NNN` artifacts), each with objective acceptance criteria. Build in dependency order. Format: [`TEMPLATE.md`](TEMPLATE.md).

> **Two namespaces — don't conflate them.** `TQ-NNN` is a _plan artifact_ (this folder). `#N` is a _GitHub pull request_. They are different counters: one artifact normally ships as **several** small PRs (e.g. `TQ-004` → PRs `#12`, `#13`, `#25`), so `TQ-004` ≠ `#4`.

**Where we are:** [`STATUS.md`](STATUS.md) — a generated table of which tickets are merged / in progress / todo, derived from PRs (`node scripts/status.mjs`). The phase tables below are the _plan_; STATUS.md is the _state_.

Strategy: **prove the core dopamine loop before adding content.** Phases 1–2 deliver a _playable, addictive feel_; phases 3–4 add the full vision (10 bosses, base, dungeons, juice).

## Phase 1 — Engine & rendering foundation

| TQ                                | Title                                         | Depends on |
| --------------------------------- | --------------------------------------------- | ---------- |
| [000](TQ-000-scaffold.md)         | Project scaffold (TS + terminal-kit + rot.js) | —          |
| [001](TQ-001-tile-render.md)      | Tile renderer (ScreenBuffer)                  | 000        |
| [002](TQ-002-game-loop.md)        | Fixed-timestep game loop                      | 001        |
| [003](TQ-003-movement-camera.md)  | Player movement + following camera            | 002        |
| [004](TQ-004-procedural-world.md) | Procedural world gen + collision              | 003        |

## Phase 2 — Core combat loop (the dopamine core)

| TQ                                    | Title                                                       | Depends on |
| ------------------------------------- | ----------------------------------------------------------- | ---------- |
| [005](TQ-005-chasing-enemies.md)      | Enemies that hunt you on a clock                            | 004        |
| [006](TQ-006-combat-engine.md)        | Combat engine: radius + stamina + hit-chance (pure, tested) | 005        |
| [007](TQ-007-attack-types-stamina.md) | 1–3 named attack types (risk/reward) wired to input         | 006        |
| [008](TQ-008-hud.md)                  | HUD: health / stamina / level                               | 007        |
| [009](TQ-009-leveling-progression.md) | Leveling + power curve (pure, tested)                       | 006        |

**◆ MVP cut line** — after TQ-009 (+ a starting weapon from 010) the core loop is playable and _feels_ like the game.

## Phase 3 — Progression & content

| TQ                            | Title                                           | Depends on |
| ----------------------------- | ----------------------------------------------- | ---------- |
| [010](TQ-010-weapons.md)      | Weapons: slot, random drops, equip, damage      | 006, 009   |
| [011](TQ-011-bosses.md)       | Bosses (1 first, design for 10) + win condition | 007, 009   |
| [012](TQ-012-save-load.md)    | Save / autosave (resume where you were)         | 004, 009   |
| [013](TQ-013-growing-base.md) | Growing home base (persistent meta)             | 012        |

## Phase 4 — Depth & polish (stretch)

| TQ                               | Title                                            | Depends on |
| -------------------------------- | ------------------------------------------------ | ---------- |
| [014](TQ-014-dungeons.md)        | High-risk/high-reward dungeons                   | 011        |
| [015](TQ-015-juice-game-feel.md) | Juice: hit flashes, damage numbers, screen shake | 008        |

## Beta feedback — input feel (2026-06-15)

Surfaced by play-testing the merged movement build. All three touch the input layer (`src/input/input.ts`); 017 and 019 both build on 016's held-direction state (independently of each other). 019 was discovered _during_ 016 — see [`tdd.md` §12](../tdd.md). (019, not 018: TQ-018 was taken by visual-identity.)
| TQ | Title | Depends on |
|----|-------|-----------|
| [016](TQ-016-input-responsiveness.md) | Responsive held-direction movement (kill the OS key-repeat stall) — timeout fallback tier | 003 |
| [017](TQ-017-diagonal-movement.md) | Diagonal (8-direction) movement | 016 |
| [019](TQ-019-kitty-keyboard-release.md) | Real key-release via the kitty keyboard protocol (no-coast primary tier) | 016 |

## Phase 5 — Spec-gap closure (audit 2026-06-19)

Gaps an audit found between the PRD/TDD spec and tickets already marked **merged** — work the original tickets _deferred_ and then left unowned, plus two carried-forward balance decisions. **Not new scope:** closing the loop on what was already promised. Each artifact spells out the decisions it needs from Isaiah before it's picked up.
| TQ | Title | Depends on |
|----|-------|-----------|
| [020](TQ-020-run-end-states.md) | Run end-states: defeat + victory (+ loop halt) — the loop's missing stakes | 008, 011 |
| [021](TQ-021-weapon-integration.md) | Weapon integration: pickups, equip, damage, HUD, save (TQ-010's unshipped PR2) | 010, 012 |
| [022](TQ-022-save-schema-v2.md) | Save schema v2: persist boss progress + run status (PRD §8) | 011, 012 |
| [023](TQ-023-balance-reconciliation.md) | Balance reconciliation: level-up power surge + tick-independent contact damage | 005, 009 |

## Phase 6 — Completion sweep (2026-07-01)

The finish-the-project pass: with the engine, loop, and systems proven, the one
remaining gap between the PRD's promises and the shipped game was content — the
win condition said 10 bosses while the roster held 2, and no ticket owned the
difference.
| TQ | Title | Depends on |
|----|-------|-----------|
| [024](TQ-024-boss-roster.md) | Author the full 10-boss roster (pure data) | 011 |

## Dependency graph (spine)

```
000─001─002─003─004─005─006─┬─007─┬─008────────────┐
                            │     └─011             ├─015
                            ├─009─┴─010             │
                            └─(004,009)─012─013     │
                                         011─014────┘
```

## Conventions

- **`TQ-NNN` = one plan artifact = one branch family** (`tq-000-scaffold`). It does **not** map 1:1 to a GitHub PR — an artifact normally ships as several small PRs (`#N`), each tiny and atomic. Reference plan work as `TQ-NNN`; reference shipped/open code as `#N`.
- An artifact is **ready** only when its Acceptance boxes are objectively checkable.
- Keep the **simulation pure** and the **renderer read-only** — never let game math leak into render/input. This is the bet that keeps the whole thing testable and lets us add juice safely later.
- **Status is derived, never hand-written.** Artifacts carry no `Status:` line. Ticket state lives in one generated file — [`STATUS.md`](STATUS.md) — computed from PRs by `node scripts/status.mjs`. End every PR title with a `(TQ-NNN)` tag so its ticket's state updates automatically; a bare mention elsewhere in the title is prose, not an implementation.
