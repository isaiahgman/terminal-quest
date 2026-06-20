# Autonomy log

This repo's real subject is not the game — it's **agentic coding**: how far an
autonomous agent gets on a backlog that a human shaped (the discovery, the PRD,
the TDD, the `TQ-NNN` artifacts) but then handed off to execute without
walking every step. This file is the audit trail for that hand-off.

Two things live here:

1. **Assumptions & spec-gaps resolved autonomously** — every time the spec
   didn't decide something and the agent picked a default instead of stopping,
   it's recorded below with the rationale and whether it's reversible. The bar
   for _stopping to ask_ is: would this change **what the game is**? Tuning
   knobs, glyphs, durations, and spec-resolvable reads are assumed and logged;
   identity-level forks are escalated.
2. **Notes on the experiment** — observations about the workflow itself.

---

## Assumptions & spec-gaps resolved autonomously

| #   | Date       | Ticket       | The gap (spec was silent/ambiguous)                                                                                                                                                                                                                                | Decision taken                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                     | Reversible?                               |
| --- | ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| A1  | 2026-06-20 | TQ-022       | PRD §8 says "bosses defeated" persists, but bosses **respawn from the world seed every launch** — so persisting a _count_ would over-count to a false victory. The model was undecided: do defeated bosses stay dead across sessions, or is boss progress per-run? | **A — defeated bosses stay dead.** Persist the set of defeated boss _ids_; `placeBosses` skips them on load.                                                                                           | PRD §7 calls progression roguelite ("you keep your growth") and §8 lists "bosses defeated" in the save; the win condition is "defeat all 10". A permanent, accumulating kill-set is the only reading where the save field and the win condition cohere. | Yes — drop the id-set, revert to per-run. |
| A2  | 2026-06-20 | TQ-023 (PR2) | Contact damage is flat-per-tick (tick-rate-coupled); spec didn't say what the rate _should_ be once decoupled.                                                                                                                                                     | Express contact as a rate `atk × CONTACT_RATE_HZ × dt`, with `CONTACT_RATE_HZ = 15` so behaviour at the current 15 Hz tick is **byte-identical** to today; only a future tick-rate change is affected. | Tick-independence is the stated invariant (tdd §12); preserving present feel makes it a safe refactor, not a balance change.                                                                                                                            | Yes — it's one co-located constant.       |
| A3  | 2026-06-20 | TQ-015       | "Hit flash" duration, damage-number lifetime, screen-shake trigger/magnitude were unspecified.                                                                                                                                                                     | Delegated to the implementing agent with bounds (flash 1–2 ticks; number lifetime ~0.5–1 s; shake on high-damage hits, ~1 cell). Final values recorded in that PR's `## Assumptions`.                  | Pure presentation tuning (prd §9); no rules impact; tune by playing.                                                                                                                                                                                    | Yes — render-only constants.              |

> Decisions the **human** made (recorded for completeness, not autonomous):
> TQ-020 death model = _defeat screen + halt_ (relaunch = fresh run, kept
> growth); TQ-023 level-up = _full refill_; TQ-022 old saves = _hard reset on
> version bump_ (no tolerant loader).

---

## Open spec-gaps not yet forced (waiting on a real decision)

These are genuinely identity-level and were **not** assumed — they change what
the game is, so they're parked for the human rather than guessed:

- **TQ-014 dungeons** — whether a dungeon is a separate seeded sub-world you
  push/pop, vs. a tuned region of the same map. (Analysis in flight.)
- **TQ-013 base buff** — whether the base grants a _mechanical_ buff (and what)
  vs. being purely cosmetic meta-progression. (Analysis in flight.)

---

## Notes on the experiment (agentic workflow)

- **The chokepoint thesis held.** The genuine limit on parallelism isn't agent
  count — it's the shared files (`state.ts`, `update.ts`, `cli.ts`,
  `renderer.ts`, `save.ts`). Work that touches them serializes no matter how
  many agents you spawn; only leaf modules (`fx.ts`, `weapons.ts`, `combat.ts`,
  world-gen) truly fan out. The artifacts that pre-split work into leaves paid
  off here; the ones that all funnel through `update.ts` did not.
- **"Built but unwired" was the dominant failure mode**, not bugs. The audit's
  biggest findings (weapons, fx, base, defeat) were all _complete, tested leaf
  modules with no caller_ — tickets marked merged on the strength of their pure
  core while the integration PR silently never landed. Lesson: "merged" should
  mean _wired into the live path_, not "the pure module exists."
- **Planning artifacts are the substrate that makes hand-off work.** Picking up
  a ticket cold was cheap precisely because the artifact already stated the
  goal, acceptance, and constraints. Where an artifact was thin (TQ-013/014),
  the agent had to do design, which is where escalation pressure appears.
- **Tagging discipline matters for the derived status.** PRs that _create_ a
  ticket artifact must NOT carry that ticket's trailing `(TQ-NNN)` tag, or the
  status tracker counts the planning doc as an implementation. The agent learned
  to title those `docs(plan): …` instead.
- **The reviewer is the real serialization point.** The agent can open PRs far
  faster than they can be reviewed/merged; the throughput ceiling is human
  review, and stacking dependent PRs (e.g. TQ-020 PR2 on PR1) only helps if the
  base merges promptly.

_Maintained by the agent as work proceeds; append, don't rewrite history._
