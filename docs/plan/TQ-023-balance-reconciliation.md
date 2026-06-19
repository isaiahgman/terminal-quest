# TQ-023 — Balance reconciliation: level-up power surge + tick-independent contact damage

Depends on: TQ-005, TQ-009 (merged); best landed with/after TQ-020 · Scope: ~S · Touches: src/game/update.ts (and possibly src/game/progression.ts, src/game/entities.ts)

## Context

Two balance TODOs that earlier tickets carried forward and never resolved. Each is a _decision_, not a bug — the code works — but each quietly undercuts a stated goal, and the audit (2026-06-19) flagged both.

**A. Level-up doesn't make you stronger _right now_ (the maxHp half).** [prd §2](../prd.md#2-the-feeling-were-chasing-the-real-spec) is the whole product: manufacture _impossible → trivial_. TQ-009 grows `maxHp`/`maxStamina`/`atk` per level. But in `update()`:

- `atk` **is** read live, so attacks hit harder the instant you level — good, this half works.
- `maxHp`/`maxStamina` only raise the _ceilings_. The player's **current** `hp` is never bumped on level-up, and there is **no hp regen anywhere**. So right after a level-up the HUD reads e.g. `18/40`: you gained headroom but no power you can feel, and that headroom only matters if something later heals you — which nothing does. (Stamina at least drifts up to its new cap via regen; hp does not.) The level-up "surge" — the core dopamine beat — is half-missing.

**B. Contact damage is coupled to the tick rate.** `contactDamage` (`entities.ts`) returns a flat `enemy.atk` **per tick**, while movement and stamina regen are `dt`-scaled. `update.ts` even comments: _"its effective DPS scales with the tick rate … reconcile when death/HUD lands (TQ-008)."_ It wasn't. At 15 Hz an adjacent grunt deals `atk × 15`/s; double the tick rate and the same enemy deals twice the DPS for the same stat. That's exactly the tick-rate coupling the `speed × dt` move-budget machinery exists to _prevent_ (tdd §12) — contact damage is the one mover that never got the `dt` treatment. Harmless while the tick rate is fixed; a latent rebalance the moment `SIM_DT` is ever tuned, and newly _urgent_ once death is live (TQ-020), because a flat-per-tick swarm is what will actually kill the player.

## Goal

Merged means: leveling up delivers a felt power surge (current survivability rises, not just the ceiling), and contact damage is expressed as a tick-rate-independent rate so enemy DPS no longer changes if the tick rate does — with both tuned by playing against the HUD.

## Decisions for Isaiah

1. **Should level-up heal, and how much?**
   - (a) **Full refill** on each level-up (`hp = maxHp`, `stamina = maxStamina`) — the classic, unambiguous "ding! surge." Strongest feel; most forgiving.
   - (b) **Add the gain** to current (`hp += ΔmaxHp`) — keeps the headroom _and_ gives an immediate partial heal, without a free full reset mid-fight.
   - (c) Leave headroom-only and just **document** that maxHp is a ceiling you fill by other means — only viable once a heal source exists (none does today).
   - Recommend **(a) or (b)** — §2 wants the surge. This is a feel knob; decide by playing.
2. **Add passive hp regen?** The PRD gives _stamina_ regen but is silent on hp. Recommend **no** — out-of-combat hp regen would blunt the positioning/risk pressure that makes the swarm scary. Make **level-up** (and later, the base / pickups) the heal moments instead. Confirm.
3. **Make contact damage tick-independent now?** Recommend **yes**, before TQ-020 makes death real: re-express contact as a DPS rate applied `× dt` (choose the rate so present 15 Hz feel is roughly preserved, then tune). The alternative is to keep it flat and accept "never change `SIM_DT`" as an invariant — cheaper but fragile, and it leaves `entities.ts` the lone un-`dt`-scaled mover. Your call on whether tick-rate independence is worth the small re-tune.

## Acceptance

- [ ] On level-up, current `hp`/`stamina` rise per decision #1 (clamped to the new ceilings), so the HUD visibly jumps on a level — unit-tested against the progression curve
- [ ] Contact damage is tick-rate independent per decision #3 (a `dt`-scaled rate), or, if declined, the flat-per-tick model is **documented as an explicit invariant** ("`SIM_DT` is fixed; contact DPS is `atk × tickRate`") and the stale "reconcile later" comment is removed
- [ ] No hp regen is introduced unless decision #2 says otherwise
- [ ] Sim stays pure and deterministic; `npm run check` passes; the balance constants stay co-located with their module (per the tdd §12 config.ts deferral)

## Plan (1–2 small PRs)

1. **PR 1 — level-up surge:** in `update()` (or a small `progression.ts` helper that returns the heal delta), detect a level increase across `gainXp` and raise current hp/stamina accordingly, clamped to the new caps. Tests: a kill that levels the player bumps current hp; a multi-level gain heals once to the final caps.
2. **PR 2 — contact `dt`:** turn `contactDamage` into a rate (`atk × CONTACT_DPS_FACTOR × dt`, knob co-located in `entities.ts`), or document the flat model and delete the stale comment. Re-tune by playing.

## Constraints

- Balance knobs stay **co-located with their module** (no premature `config.ts` — tdd §12). New knobs (`CONTACT_DPS_FACTOR`, any level-up heal policy) live next to their single reader.
- Keep progression **pure and tested** so the curve stays tunable without touching the loop — the whole point of the TQ-009 leaf.
- These are _tuning_ changes: land the mechanism, then set numbers by playing with the HUD — don't hard-tune blind.

## Notes

- Best sequenced **with or just after TQ-020**: death makes both of these matter (the surge is the reward for grinding; contact DPS is what the now-lethal swarm does). Tuning needs the HUD (TQ-008, merged) visible.
- This is the natural home for the eventual `config.ts` rollup (tdd §12) if cross-module balance tuning ever justifies it — but not in this ticket.
