# TQ-011 — Bosses + win condition
Depends on: TQ-007, TQ-009 · Scope: ~M (ships as ~3 small PRs) · Touches: src/data/bosses.ts (new), src/game/enemy.ts, src/game/state.ts, src/game/update.ts, src/game/spawn.ts; later PRs: src/cli.ts, src/render/

## Context
The goal of the game ([prd §7](../prd.md#7-world--progression)): 10 bosses scattered across the world; hard to reach, hard to beat; all of them down = win. Built **in parallel** with the in-flight HUD (TQ-008) and weapons (TQ-010) lanes — `state.ts` + `update.ts` are the known **reconciliation seams** when the lanes converge.

## Goal
Merged means: bosses exist as tough placed entities, defeating one increments progress, and clearing the whole roster triggers victory. (Ship with 1–2 real bosses + the framework for 10; the win target is the roster length, so reaching 10 is pure authoring.)

## Acceptance
- [ ] `bosses.ts` defines a data **roster** of bosses with id, name, high hp/damage, and a data-selected **signature behavior** (`signature: 'enrage' | 'none'`); a boss reusing an existing signature is pure data
- [ ] Bosses are placed at fixed/seeded world locations (not random swarm spawns) — far apart and far from the player spawn
- [ ] Defeating a boss increments `bossesDefeated`; **`GameState` exposes `bossesDefeated` + total** so the HUD (TQ-008) can render `n/total` (on-screen display is verified in the TQ-008 lane, not here)
- [ ] Defeating **all** bosses in the roster sets `status: 'victory'` (win target = roster length, design target 10); the visible victory screen ships in a **later TQ-011 PR**, sequenced after the HUD lane merges
- [ ] Adding the remaining bosses is pure data (no code change); `npm run check` passes

## Plan (3 small PRs)
1. **PR 1 — boss sim (pure):** `Boss = Enemy & { id, name, defeated }` + `BOSS_ROSTER` data + `createBoss` in `bosses.ts`; split `EnemyKind` into `SwarmKind | 'boss'` in `enemy.ts` so the swarm table stays clean; add `bossesDefeated?` + `status?: 'playing' | 'victory'` to `state.ts`; `placeBosses()` (pure, seeded) in `spawn.ts`; `update()` counts boss deaths, sets victory at full roster, applies one signature (`enrage` = speed ×mult below an hp threshold, reusing the move-budget/charge path). Unit-tested. **No render touch.**
2. **PR 2 — integration:** wire `placeBosses` into `cli.ts`; live bosses ride in `enemies[]` as `LiveEnemy` so they move/fight/render via the existing paths.
3. **PR 3 — victory screen:** render "YOU WIN" + halt the loop on `status: 'victory'` (after the HUD lane lands, to avoid `renderer.ts` contention).

## Constraints
- Bosses must be **data-driven** so reaching 10 is authoring, not engineering. Reuse enemy AI + combat engine; only the signature behavior is special. A new *kind* of signature is code; a boss reusing an existing one is data.
- Keep edits to the chokepoint files (`state.ts`, `update.ts`) small and additive — new fields optional/defaulted (mirroring `enemies?`/`progress?`), to minimize the reconciliation surface with the parallel lanes.

## Notes
- A boss is modelled as a very tough `Enemy` with identity, so it reuses movement, combat, contact, XP, and rendering for free — the only new logic is defeat-counting, the victory check, and the one signature behavior.
- Tune so an under-leveled player loses but a ground-out player wins — that's the Solo-Leveling payoff. Validate against the TQ-009 curve — **this play-tuning needs the HUD (TQ-008)** to see level/hp/boss-count, so balance lands at/after reconciliation, not in PR 1.
