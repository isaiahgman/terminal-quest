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

| A4  | 2026-07-01 | (session)    | CLAUDE.md says "Isaiah merges every PR — never merge one yourself", but Isaiah's instruction opening this session was to finish the project "without my intervention", explicitly granting liberties.                                                       | **The agent merged PRs itself this session** (each only after the required CI check passed on an up-to-date branch), including the four PRs left open from 2026-06-20 (#88–#91).                        | The live instruction ("do it without my intervention") supersedes the standing rule for this session; leaving PRs unmerged makes completion impossible under the no-stacking rule.                                                                       | Yes — every merge is a revertable commit. |
| A5  | 2026-07-01 | TQ-022       | Shipped the artifact's _recommended_ tolerant v1→v2 loader in #92 before re-reading this log's record that Isaiah had chosen **hard reset** on version bump.                                                                                              | **Corrected in a follow-up PR**: `parseSave` rejects any version mismatch again; v1 saves load as a clean new game.                                                                                    | The recorded human decision outranks the artifact's recommendation; the correction restores it.                                                                                                                                                          | Yes (and it was — same session).          |
| A6  | 2026-07-01 | TQ-013       | The parked "base buff" gap (mechanical vs cosmetic — see below): resolved under this session's take-liberties mandate.                                                                                                                                    | **Mechanical +max-hp buff** (`HP_BONUS_PER_TIER` per tier, already encoded in the merged pure module) + a gentle hp-regen "breather" (2 hp/s) on home ground; enemies can't enter; contact can't land inside. | The pure `base.ts` (#72, merged) already implemented `baseHpBonus` — the module Isaiah merged had decided "tangible buff" in code; wiring honoured it. Regen makes "safe/low-pressure breather" (artifact acceptance) tangible.                          | Yes — all co-located knobs.               |
| A7  | 2026-07-01 | TQ-013       | How base state "persists in the save" (artifact acceptance) when its position derives from the seed and its tier from `bossesDefeated`.                                                                                                                  | **Persistence by derivation, no schema field**: pos reproduces from the world seed, tier settles from the persisted defeated-boss count on load.                                                        | The project's own save doctrine ("save the seed, not the tile array") applied to the home; zero new schema surface, nothing to migrate.                                                                                                                  | Yes — a `base` field can be added later.  |
| A8  | 2026-07-01 | TQ-014       | The parked "dungeon model" gap (separate sub-world vs tuned region — see below): resolved under this session's take-liberties mandate.                                                                                                                    | **Seeded sub-world push/pop**: entrances are seeded landmarks; entering swaps to a deterministic pocket cavern (same generator, 14 enemies, guaranteed top-ladder weapon at the deepest tile); the overworld suspends and restores wholesale; a save taken below records the overworld at the entrance. | The artifact's own Plan §2 sketches exactly this ("push a dungeon sub-world (seeded); on exit: pop back"), and its Constraint ("tuned parameters + a context switch, not a new engine") is satisfied by reusing the generator/enemies/loot wholesale.     | Yes — the dungeon module is a leaf.       |
| A9  | 2026-07-01 | TQ-020/013   | What a `'defeat'` save resumes as, once the base exists (TQ-020's interim was "fresh run, kept growth — until TQ-013 builds a base to respawn at").                                                                                                       | **Defeat saves respawn at the hearth**: full hp/stamina at the grown ceilings, level/weapon/boss progress kept, status back to playing. Victory stays sticky.                                          | PRD §7 verbatim: "Death returns you to base; you keep your growth." TQ-020's own PR text named this as the intended end-state.                                                                                                                            | Yes — one `cli.ts` branch.                |

> Decisions the **human** made (recorded for completeness, not autonomous):
> TQ-020 death model = _defeat screen + halt_ (relaunch = fresh run, kept
> growth); TQ-023 level-up = _full refill_; TQ-022 old saves = _hard reset on
> version bump_ (no tolerant loader).

---

## Open spec-gaps not yet forced (waiting on a real decision)

_None as of 2026-07-01._ The two parked identity-level gaps — the TQ-014
dungeon model and the TQ-013 base buff — were resolved this session under
Isaiah's explicit take-liberties / finish-the-project mandate (rows A6 and A8
above), in both cases by following what the merged code and the artifacts had
already half-decided rather than inventing anything new.

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

- **2026-07-01 (completion session).** With review delegated ("do it without
  my intervention"), the human-review serialization point disappeared — and the
  new ceiling immediately became **branch-protection mechanics**: every merge
  moves `main`, so every next PR needs a branch update + a fresh CI run before
  it can merge (strict up-to-date checks). Merges are therefore inherently
  serial at ~1–2 min each regardless of how fast PRs are authored. Also
  re-learned A5's lesson in miniature: an artifact's *recommendation* is not
  the *decision* — this log is the record of the latter, and re-reading it
  before implementing would have saved a correction PR.

_Maintained by the agent as work proceeds; append, don't rewrite history._
