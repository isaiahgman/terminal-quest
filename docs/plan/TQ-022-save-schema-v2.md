# TQ-022 — Save schema v2: persist boss progress + run status

Depends on: TQ-011, TQ-012 (merged); coordinates with TQ-020, TQ-021 · Scope: ~S/M · Touches: src/save/save.ts, src/cli.ts

## Context

[prd §8](../prd.md#8-save) lists what a save must hold so you "drop back exactly where you left off": player stats/level, **location**, **current status**, **equipped weapon**, world seed, **base state**, and **bosses defeated**. TQ-012 shipped the save _mechanism_ well — versioned schema, atomic temp+rename writes, validating parse, world rebuilt from seed+dims — but the v1 `SaveData` persists only `world(seed,w,h)`, `player(pos,hp,stamina,def,progress)`, and `tick`. Missing vs §8: **bossesDefeated, status, weapon, base**.

TQ-012 deliberately deferred weapon/boss fields behind the version mechanism ("can be added later behind a version bump"). The audit (2026-06-19) notes that rationale has now partly expired: **TQ-011 is merged**, so the data exists on `GameState` and `cli.ts` even carries an explicit comment admitting _"a quit-and-resume erases boss progress."_ A player who downs 1 of 2 bosses, quits, and relaunches returns to 0/N with the full roster respawned — the win condition cannot survive a session. That's the cheapest, highest-value field to add, and it's blocked on nothing.

## Goal

Merged means: boss progress (`bossesDefeated`) and run `status` survive save/resume, so the win condition and a finished run persist across sessions — without breaking existing saves.

## Scope split (what this ticket adds vs. what its siblings add)

- **This ticket:** `bossesDefeated` + `status` (both already on `GameState`, both depend only on the merged TQ-011).
- **TQ-021** adds `weapon` to the same schema when weapon integration lands.
- **TQ-013** adds `base` when the base exists.
- To avoid three separate version bumps, prefer **one v2 bump** that the siblings extend additively (a tolerant loader, below, makes additive growth cheap).

## Decisions for Isaiah

1. **Back-compat vs. hard bump.** Today `parseSave` rejects any `version !== SAVE_VERSION`, so bumping `1 → 2` would make every existing save load as a _new game_ (players lose progress at the upgrade). Since the new fields default safely (`bossesDefeated = 0`, `status = 'playing'`), the kinder option is a **tolerant loader**: accept v1, fill the new fields with defaults, treat as v2. Recommended — preserves player progress across the bump. (Pure hard-reject is simpler but user-hostile here.) Your call.
2. **Does a won/lost run resume as ended?** Once `status` persists, a `'victory'`/`'defeat'` save will resume in that end-state (pairs with TQ-020's halt). Recommended yes — a finished run should stay finished. If instead relaunch should always start a fresh playable run, we'd persist `bossesDefeated` but **not** `status`. Decide alongside TQ-020.
3. **Combat RNG stream — persist or not?** `rng.ts` ships `getState`/`setState` precisely so a mid-combat save could reproduce the exact roll stream, but TQ-012 intentionally **doesn't** persist it (enemies/bosses respawn from seed on load anyway — "resume the feel, not the frame"). Recommend keeping it a deliberate non-goal and _documenting_ it as such; flip only if you ever want frame-exact combat continuity. (Listed here so it's a decision, not an omission.)

## Acceptance

- [ ] `SAVE_VERSION` bumped to 2; `SaveData` gains `bossesDefeated` and `status`
- [ ] `serialize()` writes them from `GameState` (`bossesDefeated ?? 0`, `status ?? 'playing'`); `cli.ts` restores them into the initial state on resume
- [ ] `isSaveData`/`parseSave` validate the new fields (status ∈ the `GameStatus` union; bossesDefeated a non-negative integer)
- [ ] Back-compat per decision #1 (recommended: a v1 save still loads, with the new fields defaulted) — covered by a round-trip + an old-version-load test
- [ ] A resume after defeating a boss shows the **same** `bossesDefeated` (no reset); `npm run check` passes
- [ ] The deliberate non-persistence of RNG stream state is documented in `save.ts` (decision #3)

## Plan (1–2 small PRs)

1. **PR 1 — persist boss progress + status:** bump `SAVE_VERSION`; extend `SaveData`, `serialize`, validators, and the `cli.ts` resume path; add the tolerant v1 loader (if chosen). Tests: v2 round-trip, v1→v2 upgrade, boss-progress survives resume.
2. _(folded later)_ TQ-021's `weapon` field and TQ-013's `base` extend the same v2 shape additively.

## Constraints

- Keep the schema **plain JSON** and every field **validated for domain, not just type** (the existing `save.ts` discipline — a hand-edited/truncated save must degrade to a clean new game, never a broken sim).
- Writes stay atomic (temp + rename); don't touch that path.
- Additive only — the tolerant loader means later siblings (weapon/base) don't each need a new version.

## Notes

- This is mostly the part of TQ-012 that §8 always required; the "deferred" note on `SaveData` (and the apologetic comment in `cli.ts`) are the breadcrumbs.
- Sequence with **TQ-020**: persisting `status` is only meaningful once a run can actually _reach_ `'defeat'`/`'victory'` and the loop halts on it. Land them together or TQ-020 first.
