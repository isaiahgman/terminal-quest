# Balance notes — computed, not vibed

Generated from the live tuning knobs by [`scripts/balance-report.ts`](../scripts/balance-report.ts)
(`npx tsx scripts/balance-report.ts`), which imports the **same pure modules
the game runs on** — no copied formulas to drift. Re-run it after touching any
knob in `progression.ts`, `attacks.ts`, `weapons.ts`, `enemy.ts`, or
`data/bosses.ts`, and re-read this file's claims against the fresh output.
Snapshot below is from 2026-07-01 (post TQ-024 roster).

## The headline: the PRD §2 delta is real and measurable

The whole product spec is one feeling — _impossible → trivial_ (prd §2, §13's
last box). The model shows it's actually in the numbers:

| Boss                      | L1 unarmed                   | L5 + sword | L15 + hammer |
| ------------------------- | ---------------------------- | ---------- | ------------ |
| The Gatekeeper (first)    | 22s                          | 4s         | **1.4s**     |
| The Shadow Monarch (last) | **WALL** (no realistic kill) | 69s        | **18s**      |

A fresh player literally cannot kill the late roster (sustained damage never
outpaces the hp pool within a sane fight), and a grown one deletes the early
roster in a jab or two. That is the game working as designed.

## How the run actually flows (model, kiting assumed)

- **Sustained DPS is stamina-bound**: long fights settle to
  `STAMINA_REGEN_PER_SEC / staminaCost` swings per second. Damage scales with
  `atk`, so as levels climb, the _cheap_ attack's damage-per-stamina runs away
  with single-target fights (see "smells" below).
- **The grind curve** (`xpToNext` geometric ×1.5, gains accelerating): L5 costs
  ~163 XP (≈ a dozen grunts), L8 ~644, L12 ~3.4k. Bosses pay their own way —
  the Gatekeeper is worth ~10 grunts, the Shadow Monarch ~112 — so climbing
  the ladder in roster order is self-accelerating: each kill funds a chunk of
  the levels needed for the next.
- **A full clear** at the L8-with-hammer pace is ≈ 4 minutes of pure boss DPS
  plus travel/grind — a 20–40 minute session to victory. Feels right for v1.

## Contact damage: the knife's edge (deliberate, but know the numbers)

Contact is per-tick at 15 Hz (`entities.ts`, the recorded TQ-023 invariant), so
overlap costs `atk × 15` hp/second:

- brute: 75 hp/s → a level-1 player (20 hp) dies in **0.27s** of overlap
- any boss: 120–480 hp/s → contact with a boss is effectively instant death
  at any level a player will realistically reach

This delivers the "stand still and you die" pressure (prd §5.1) and makes boss
fights pure kiting-DPS races (the player at 1 tile/tick out-runs every boss;
only the Shadow Monarch's ×3 enrage matches player speed). With defeat now
respawning at the base with growth kept, dying to a graze is roguelite-fair
rather than run-destroying. **If play-testing says one-frame grazes feel
cheap**, the knob to soften is a brief post-contact invulnerability window in
`update.ts` — not lowering `atk`, which would flatten the threat identity.

## Smells the model surfaced (tuning candidates, not bugs)

1. **Jab-spam dominance (single-target).** Damage-per-stamina:
   quick-jab `(2 + atk)/2` vs maelstrom `(10 + atk)/8`. The moment `atk`
   grows, the jab wins sustained single-target DPS outright — the maelstrom's
   identity is _crowd_ value (it multiplies by targets in radius) and burst,
   but against a lone boss the optimal play is mashing the cheapest button.
   If that reads as degenerate in play: give the heavy attacks a
   damage _multiplier_ on `atk` (e.g. maelstrom `damage + 1.5×atk`) instead of
   flat addition, so weight scales with growth.
2. **The dagger out-DPSes the sword for jab builds** (`staminaDelta: -1` makes
   jabs cost 1 → doubles jab rate; the sword's +0.5 radius does nothing for
   single-target). Fine if the dagger is meant to be the speed option; worth a
   conscious look.
3. **`def` barely matters.** Boss `def` 1–7 vs per-hit damage in the tens-to-
   hundreds: it shaves single-digit percents. Either grow `def` faster up the
   ladder (tank identity for the stat walls) or accept it as flavour.
4. **Weapon ladder saturates early.** The hammer (+8) is a rounding error next
   to L12's `atk` 80. Gear matters exactly in the mid-game window (L3–L8) —
   which may be the intent (PRD calls weapons the _second_ axis) — but
   "upgradeable" (prd §7/F6) remains future work if gear should stay relevant
   late (tracked as an explicit non-shipped stretch; see STATUS/plan).

## What this file is not

Not a promise. The model ignores movement skill, multi-target cleave value,
burst windows, and terror. It brackets reality from below (sustained floors)
— the real tuning loop is still _play it_ (`npm run dev`), this just tells you
where to look first.
