# TQ-024 — Author the full 10-boss roster

Depends on: TQ-011 (merged) · Scope: ~S · Touches: src/data/bosses.ts (pure data)

## Context

[prd §7/F7](../prd.md#7-world--progression): **10 bosses** scattered across the world are the win condition. TQ-011 deliberately shipped the _engine_ with a 2-boss roster and established (tdd §12) that "reaching 10 is appending data, not code": `TOTAL_BOSSES` is the roster length, placement/combat/XP/defeat-counting are all roster-generic, and the save (TQ-022) validates defeated ids against whatever the roster holds. The audit gap: no ticket ever owned actually authoring bosses 3–10, so the game's win condition sat at 2/10 of its spec.

## Goal

Merged means: `BOSS_ROSTER` holds 10 authored bosses on an ascending difficulty ladder, and every existing system (placement, HUD `n/10`, victory at 10, save validation) picks them up with zero code change.

## Acceptance

- [ ] `BOSS_ROSTER.length === 10`, unique ids, all stats in domain (positive hp/speed, non-negative atk/def)
- [ ] The ladder ascends: each boss's hp is ≥ its predecessor's (the "impossible → trivial" wall gets taller as you climb)
- [ ] Signatures are a mix (`none` stat-walls and varied `enrage` tunings) so late bosses aren't just bigger numbers
- [ ] No code change outside `data/bosses.ts` + its test (the TQ-011 "appending data" promise, kept honest)
- [ ] `npm run check` passes

## Plan

1. Append 8 `BossSpec` entries to the roster, hp ~120 → ~1500, atk 8 → ~30, distinct glyphs/colours.
2. Pin roster length (10) and the ascending-hp ladder in `bosses.test.ts`.

## Constraints

- Data only — if any other file needs touching, the TQ-011 design has failed and that's a separate bug.
- Balance numbers are deliberate starting points to tune by playing (same stance as TQ-011's first two).

## Notes

- Names/theme lean Solo-Leveling: gates, monarchs, shadows — each boss a named wall to eventually trivialise.
- `placeBosses` spacing degrades gracefully on cramped worlds; a real (terminal-sized ×2) world seats all 10.
