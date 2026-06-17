/**
 * Leveling + power curve — the dopamine engine as pure, deterministic logic
 * (prd §2, "the feeling we're chasing"). Kills grant XP, XP crosses a rising
 * threshold to level you up, and each level-up grows your stats. This is where
 * the Solo-Leveling "impossible → trivial" delta is manufactured.
 *
 * The whole module is **pure** and **isolated** (the architecture bet): no I/O,
 * no rendering, no `Math.random`. Every function returns fresh objects and never
 * mutates its inputs. All tuning knobs live as the constants below so the curve
 * can be re-balanced by playing without touching the loop — exactly the point of
 * keeping progression math in its own tested leaf (mirrors `combat.ts`).
 *
 * Decoupling, like `combat.ts`: this module never imports `Enemy`/`Player`. It
 * grows a minimal {@link Progression} value and reads the minimal slice it needs
 * off a slain combatant ({@link xpForKill}), so the math is fully unit-testable
 * ahead of (and independent from) the loop wiring.
 *
 * The intended *feel* ("earned then explosive"):
 *  - The **XP curve climbs geometrically** ({@link xpToNext}) — each level costs
 *    more than the last, so the early game is a real grind.
 *  - The **stat gains accelerate** ({@link applyLevelUp}) — each level grants a
 *    bigger jump than the last, so once you push through the grind your power
 *    spikes. Total stats grow super-linearly in level; the threshold grows too,
 *    but the payoff per level outpaces the early slog.
 */

/**
 * A player's progression: current level, XP banked toward the *next* level, and
 * the stat ceilings that level-ups raise. `atk` is the same offensive stat
 * `combat.ts` reads (a `Combatant.atk`), so leveling directly powers up attacks.
 * Pure value object — every field is replaced wholesale, never mutated.
 */
export interface Progression {
  /** Current level; a fresh player starts at 1. */
  readonly level: number;
  /**
   * XP banked toward the next level. After {@link gainXp} settles this is always
   * strictly less than `xpToNext(level)` — surplus is carried, not lost.
   */
  readonly xp: number;
  /** Maximum hit points; raised on each level-up. */
  readonly maxHp: number;
  /** Maximum stamina; raised on each level-up. */
  readonly maxStamina: number;
  /** Offensive power (a `combat.ts` `Combatant.atk`); raised on each level-up. */
  readonly atk: number;
}

/** Level-1 starting stats — the baseline every other number is tuned against. */
export const BASE_HP = 20;
export const BASE_STAMINA = 10;
export const BASE_ATK = 3;

/** XP required for the *first* level-up (1 → 2). The grind's starting cost. */
export const BASE_XP = 20;
/**
 * Geometric growth of the XP threshold per level: `xpToNext` is multiplied by
 * this each level, so later levels cost progressively more (the "grind ramp").
 * Above 1 ⇒ strictly increasing thresholds — the curve's monotonicity.
 */
export const XP_GROWTH = 1.5;

/**
 * Per-level stat gains, as `base + accel * (level - 2)` for the level being
 * *reached* (≥ 2). The `accel` term is what makes growth "explosive": every
 * level grants more than the previous one, so cumulative stats rise faster than
 * linearly. Raise the accel knobs for a steeper late-game power spike.
 */
export const HP_GAIN_BASE = 5;
export const HP_GAIN_ACCEL = 3;
export const STAMINA_GAIN_BASE = 3;
export const STAMINA_GAIN_ACCEL = 1;
export const ATK_GAIN_BASE = 2;
export const ATK_GAIN_ACCEL = 1;

/** How a slain enemy's stats convert to XP — tougher kills are worth more. */
export const XP_PER_MAX_HP = 1;
export const XP_PER_ATK = 2;

/** A fresh level-1 progression with the baseline stats. */
export function createProgression(): Progression {
  return {
    level: 1,
    xp: 0,
    maxHp: BASE_HP,
    maxStamina: BASE_STAMINA,
    atk: BASE_ATK,
  };
}

/**
 * XP needed to advance from `level` to `level + 1`. Geometric in `level`, so the
 * threshold strictly increases — the grind ramps as you climb. Floored at 1 so
 * the threshold is always positive (a non-positive threshold would let
 * {@link gainXp} loop forever). Defined for `level >= 1`.
 */
export function xpToNext(level: number): number {
  return Math.max(1, Math.round(BASE_XP * Math.pow(XP_GROWTH, level - 1)));
}

/** Stat gain for *reaching* `level` (≥ 2): `base + accel * (level - 2)`. */
function gainFor(level: number, base: number, accel: number): number {
  return base + accel * (level - 2);
}

/**
 * Advance exactly one level: bump `level` and grow every stat by its gain for
 * the level reached. Does **not** touch `xp` — {@link gainXp} owns the XP ledger
 * (it pays the threshold before calling this). Pure: returns a fresh object.
 */
export function applyLevelUp(progress: Progression): Progression {
  const level = progress.level + 1;
  return {
    ...progress,
    level,
    maxHp: progress.maxHp + gainFor(level, HP_GAIN_BASE, HP_GAIN_ACCEL),
    maxStamina:
      progress.maxStamina + gainFor(level, STAMINA_GAIN_BASE, STAMINA_GAIN_ACCEL),
    atk: progress.atk + gainFor(level, ATK_GAIN_BASE, ATK_GAIN_ACCEL),
  };
}

/**
 * Award `amount` XP, levelling up as many times as the new total allows and
 * carrying any surplus toward the next level. A single large gain can cross
 * several thresholds in one call (multi-level-up), each applying its stat growth.
 *
 * A non-finite or non-positive `amount` is a no-op (mirrors `combat.ts`'s NaN
 * guards) — it would otherwise poison `xp` to `NaN` (`NaN >= threshold` is
 * always false, silently freezing progression) or subtract XP. Pure: the input
 * is never mutated; a fresh progression is always returned.
 */
export function gainXp(progress: Progression, amount: number): Progression {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ...progress };
  }

  let current: Progression = { ...progress, xp: progress.xp + amount };
  while (current.xp >= xpToNext(current.level)) {
    current = applyLevelUp({
      ...current,
      xp: current.xp - xpToNext(current.level),
    });
  }
  return current;
}

/**
 * XP awarded for slaying an enemy, from the minimal stat slice this needs
 * (structurally an `Enemy`): tougher and harder-hitting enemies are worth more.
 * Floored at 1 so every kill grants progress.
 */
export function xpForKill(slain: { maxHp: number; atk: number }): number {
  return Math.max(
    1,
    Math.round(slain.maxHp * XP_PER_MAX_HP + slain.atk * XP_PER_ATK),
  );
}
