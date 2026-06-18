# TQ-012 — Save / autosave
Depends on: TQ-004, TQ-009 · Scope: ~M · Touches: src/save/save.ts, src/cli.ts, src/game/loop.ts

## Context
Persistence ([prd §8](../prd.md#8-save), [tdd §9](../tdd.md#9-save)): drop the player back exactly where they were, and make progression *persistent* (roguelite).

## Goal
Merged means: the game autosaves and, on relaunch, restores the player's location, current stats/level, and world (via seed) — dropping you back exactly where you were. Schema is **versioned and extensible** so weapon (TQ-010) and bosses-defeated (TQ-011) slot in later without a migration.

## Scope reconciliation (2026-06-17, during pick-up)
The original Goal/Acceptance named **weapon** and **bosses defeated**, but neither exists on `main`: TQ-010 (weapons) and TQ-011 (bosses) are `todo`, and bosses are explicitly **past the MVP cut line** (prd §11). Both *actual* deps (TQ-004 determinism #25, TQ-009 progression #34) are merged, so the foundation is ready. Decision: **build the save system now for the fields that exist, behind a versioned schema**; defer weapon/bosses to when those features land. This unblocks the MVP "progress persists" DoD ([prd §13](../prd.md#13-definition-of-done-v1--mvp)) without stalling on unbuilt features.

## Acceptance
- [ ] `save.ts` (pure leaf) serializes/deserializes the save shape to `~/.terminal-quest/save.json`: `version`, world `seed` **+ `width`/`height`**, player `pos`/`hp`/`stamina`/`def`/`progress`, `tick`
- [ ] **Autosave** on a throttled interval + a final synchronous write on quit/SIGINT + on level-up (the only real "key event" that exists today; boss-kill/weapon-equip triggers are added with TQ-010/TQ-011)
- [ ] On launch: valid save → resume (world rebuilt from seed+dims, player pos/stats restored); no/invalid save → new game
- [ ] World reconstructs deterministically from the saved seed **and dims** via `generateWorld(width, height, seed)` (relies on TQ-004 determinism; dims matter because map size + spawn depend on terminal size — see `cli.ts`)
- [ ] Corrupt/missing save handled gracefully (atomic write on save side; validating parse → fall back to new game on load side; no crash); `npm run check` passes

## Plan
1. Define the versioned serializable `SaveData` shape + a hand-rolled validator (returns `null` on any corruption / version mismatch); write/read JSON in `~/.terminal-quest/` with an **atomic** write (temp file + rename).
2. Load in `cli.ts` before starting (valid save → rebuild state, else new game); drive a throttled async autosave from cli (capture latest state via the existing `render` hook) + a final sync write in `shutdown()`, guarded so the two never overlap.
3. Rebuild world from seed + dims on load; respawn enemies fresh from the seed.

## Constraints
- Save **the seed + dims**, not the tile array, to keep saves small (world is deterministic). Never block the game loop on disk I/O (interval write is async/throttled; the only sync write is the final flush during teardown).
- Prefer to leave `loop.ts` untouched — keep the loop a pure scheduler; autosave lives in `cli.ts`.

## Notes
- **Enemies respawn from seed** on load (decided during pick-up) — don't persist `enemies[]`; only persist what resumes the *feel*.
- **RNG stream state is not persisted** — `simRng` is re-derived from the seed on load. Frame-exact combat-roll continuity isn't needed since enemies respawn anyway.
- "Current status" from prd §8 maps to `hp`/`progress` today; an explicit alive/dead status enum arrives with the death/HUD work (TQ-008), not here.
