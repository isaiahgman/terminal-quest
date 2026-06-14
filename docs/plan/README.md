# Plan — atomic PR artifacts

The [PRD](../prd.md) and [TDD](../tdd.md) decomposed as far as it goes: each file below is **one shippable PR** with objective acceptance criteria. Build in dependency order. Each artifact follows [`TEMPLATE.md`](TEMPLATE.md).

## Roadmap (dependency order)

| PR | Title | Depends on | Ships |
|----|-------|-----------|-------|
| [000](PR-000-scaffold.md) | Project scaffold | — | pnpm + TS + Ink boot to a "Hello" screen |
| [001](PR-001-app-shell-state-machine.md) | App shell + state machine | 000 | store, reducer, screen router |
| [002](PR-002-title-screen.md) | Title screen | 001 | animated title + New Game/Quit menu |
| [003](PR-003-data-model-and-content.md) | Data model + class content | 001 | types + 3 classes |
| [004](PR-004-character-creation.md) | Character creation | 002, 003 | pick class → hero in state |
| [005](PR-005-combat-engine.md) | Combat engine (pure) | 003 | tested turn/damage/win-lose logic |
| [006](PR-006-battle-screen.md) | Battle screen UI | 004, 005 | a playable battle to win/lose |
| [007](PR-007-animation-system.md) | Animation system | 006 | attack frames + HP-bar tween |
| [008](PR-008-enemies-and-encounters.md) | Enemies + encounters | 005 | 3 enemies + 1 boss |
| [009](PR-009-exploration-map.md) | Exploration map | 004, 006, 008 | traverse 4 scenes, trigger fights |
| [010](PR-010-inventory-and-items.md) | Inventory + items | 006 | potions usable in/out of battle |
| [011](PR-011-end-screens-and-loop.md) | End screens + loop | 009, 010 | victory/defeat/game-over → restart |

## Dependency graph
```
000 ─ 001 ─┬─ 002 ─┐
           │       ├─ 004 ─┬─ 006 ─┬─ 007
           ├─ 003 ─┤       │       ├─ 010 ─┐
           │       └─ 005 ─┴───────┘       │
           │       005 ─ 008 ─┐            │
           │                  └─ 009 ──────┴─ 011
```

## MVP cut line
PRs **000–011** complete the PRD's MVP (F1–F8). Stretch items (save/load, more content, status effects, npm publish) become PR-012+ once MVP is green.

## Conventions
- One PR = one artifact = one branch (`pr-000-scaffold`) = one merge.
- A PR is **ready** only when its Acceptance boxes are objectively checkable.
- Update the PR's `Status` as it moves: `ready → in progress → merged`.
