/**
 * Home base — the persistent meta-progression anchor as pure, deterministic
 * logic (prd §7: "a home that **grows** as you progress; the meta-progression
 * anchor"). The base is the Solo-Leveling "look how far I've come" feeling made
 * concrete: a place you return to between runs that visibly levels up — a higher
 * **tier** — as you defeat bosses, and grows a tangible **buff** (bonus max HP)
 * along the way. Death returns you here and you keep this growth (prd §7).
 *
 * The whole module is **pure** and **isolated** (the architecture bet, mirroring
 * `progression.ts` / `combat.ts`): no I/O, no rendering, no `Math.random`. Every
 * function returns a fresh object and never mutates its input. All growth rules
 * are the constants below, so the base curve can be re-tuned by playing without
 * touching the loop.
 *
 * **One economy, not two** (artifact constraint): growth is driven entirely by
 * the existing progress signal `bossesDefeated` — the same `0..TOTAL_BOSSES`
 * count the run already tracks (`state.ts` / `update.ts`). This module invents no
 * second currency; it derives the base's tier and buff from how many bosses have
 * fallen, so the base "grows as you progress" with zero new bookkeeping.
 *
 * Decoupling: this module imports no `Enemy`/`Player`/`World` types. It owns a
 * minimal {@link Base} value and a single `bossesDefeated` input, so the growth
 * math is fully unit-testable ahead of (and independent from) any state/save/
 * render wiring (deferred to a later, serialized PR).
 */

/**
 * The player's home base — pure value object, every field replaced wholesale and
 * never mutated. Its growth is fully a function of `bossesDefeated`, but the
 * derived `tier` is stored (not recomputed on read) so the save records exactly
 * what the player has earned and the renderer can show it without recomputation.
 */
export interface Base {
  /**
   * The base's current growth tier, starting at {@link BASE_START_TIER} (1) for
   * a fresh base and climbing as bosses fall. Higher tiers are a bigger home and
   * a bigger buff. Monotonic across a save: it only ever rises (see
   * {@link growBase}).
   */
  readonly tier: number;
  /**
   * Bosses defeated as of the last growth settle — the single progress signal the
   * tier is derived from. Carried on the value so {@link growBase} can be called
   * idempotently with the run's live count and only step the tier forward.
   */
  readonly bossesDefeated: number;
}

// TODO(config): these knobs are inline (mirroring `progression.ts` / `enemy.ts`,
// which also co-locate their constants). If a shared `config.ts` is later
// introduced for balance tuning, migrate the base's knobs alongside them in a
// dedicated refactor and bless the pattern in CLAUDE.md.

/** A fresh base's tier — the home you start with before any boss has fallen. */
export const BASE_START_TIER = 1;

/**
 * How many boss defeats advance the base by one tier. Tier is
 * `START + floor(bossesDefeated / BOSSES_PER_TIER)`, so every Nth boss is a
 * visible upgrade to the home. Raise to make the base grow more slowly.
 */
export const BOSSES_PER_TIER = 2;

/**
 * Bonus max HP granted **per tier above the starting tier** — the base's
 * tangible buff (prd §7: "ideally a tangible buff"). Tier 1 grants 0; each tier
 * gained adds this much head-room, so returning to a grown base means coming back
 * tougher. Additive with the player's own `maxHp` at wiring time.
 */
export const HP_BONUS_PER_TIER = 10;

/** A fresh base: starting tier, no bosses defeated yet. */
export function createBase(): Base {
  return {
    tier: BASE_START_TIER,
    bossesDefeated: 0,
  };
}

/** Clamp a boss count to a finite, non-negative integer (shared NaN guard). */
function normalizeBosses(bossesDefeated: number): number {
  return Number.isFinite(bossesDefeated) && bossesDefeated > 0
    ? Math.floor(bossesDefeated)
    : 0;
}

/**
 * The tier a base should be at for a given number of bosses defeated:
 * `START + floor(bossesDefeated / BOSSES_PER_TIER)`. Pure derivation — the
 * single source of the growth curve, shared by {@link growBase}.
 *
 * A non-finite or negative count clamps to 0 bosses (yields the starting tier)
 * rather than producing a `NaN`/negative tier that would poison the buff and the
 * renderer — mirroring the NaN guards in `progression.ts` / `combat.ts`.
 */
export function baseTierFor(bossesDefeated: number): number {
  return (
    BASE_START_TIER +
    Math.floor(normalizeBosses(bossesDefeated) / BOSSES_PER_TIER)
  );
}

/**
 * Settle the base against the run's live `bossesDefeated`, stepping its tier
 * forward to match. Monotonic: the tier and recorded count never *decrease*, so
 * passing a stale or lower count (e.g. a fresh run's 0 after a grown save loads)
 * is a safe no-op rather than a regression — the home you've grown stays grown.
 *
 * Pure: the input base is never mutated; a fresh {@link Base} is always returned.
 */
export function growBase(base: Base, bossesDefeated: number): Base {
  const settled = Math.max(
    base.bossesDefeated,
    normalizeBosses(bossesDefeated),
  );
  const tier = Math.max(base.tier, baseTierFor(settled));
  if (tier === base.tier && settled === base.bossesDefeated) {
    return { ...base };
  }
  return { tier, bossesDefeated: settled };
}

/**
 * The bonus max HP a base grants at its current tier: `HP_BONUS_PER_TIER` per
 * tier *above* the starting tier (tier 1 ⇒ 0). The tangible buff the loop adds
 * to the player's max HP at wiring time. Never negative — a tier at or below the
 * start yields 0.
 */
export function baseHpBonus(base: Base): number {
  return Math.max(0, base.tier - BASE_START_TIER) * HP_BONUS_PER_TIER;
}

/** Chebyshev radius of a fresh (tier-1) base's safe area — a 5×5 home. */
export const BASE_RADIUS_START = 2;

/**
 * Chebyshev radius of the base's safe area at its current tier: the *visible*
 * growth (prd §7 "a home that grows") — each tier extends the home by one ring.
 * Never below the starting radius — a tier at or below the start is the 5×5
 * fresh home (the same never-negative stance as {@link baseHpBonus}).
 */
export function baseRadius(base: Base): number {
  return BASE_RADIUS_START + Math.max(0, base.tier - BASE_START_TIER);
}
