import { describe, it, expect } from 'vitest';
import {
  BASE_START_TIER,
  BOSSES_PER_TIER,
  HP_BONUS_PER_TIER,
  baseHpBonus,
  baseTierFor,
  createBase,
  growBase,
  type Base,
} from './base.js';

describe('createBase', () => {
  it('starts at the starting tier with no bosses defeated', () => {
    expect(createBase()).toEqual({
      tier: BASE_START_TIER,
      bossesDefeated: 0,
    });
  });

  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = createBase();
    const b = createBase();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('baseTierFor', () => {
  it('is the starting tier until the first per-tier threshold', () => {
    for (let bosses = 0; bosses < BOSSES_PER_TIER; bosses++) {
      expect(baseTierFor(bosses)).toBe(BASE_START_TIER);
    }
  });

  it('advances one tier per BOSSES_PER_TIER defeats', () => {
    expect(baseTierFor(BOSSES_PER_TIER)).toBe(BASE_START_TIER + 1);
    expect(baseTierFor(BOSSES_PER_TIER * 2)).toBe(BASE_START_TIER + 2);
    expect(baseTierFor(BOSSES_PER_TIER * 5)).toBe(BASE_START_TIER + 5);
  });

  it('is non-decreasing as bosses fall (monotonic growth)', () => {
    for (let bosses = 0; bosses < 40; bosses++) {
      expect(baseTierFor(bosses + 1)).toBeGreaterThanOrEqual(
        baseTierFor(bosses),
      );
    }
  });

  it('floors fractional counts to whole bosses', () => {
    expect(baseTierFor(BOSSES_PER_TIER + 0.9)).toBe(BASE_START_TIER + 1);
    expect(baseTierFor(BOSSES_PER_TIER - 0.1)).toBe(BASE_START_TIER);
  });

  it('clamps non-finite / negative counts to the starting tier', () => {
    expect(baseTierFor(Number.NaN)).toBe(BASE_START_TIER);
    expect(baseTierFor(Number.POSITIVE_INFINITY)).toBe(BASE_START_TIER);
    expect(baseTierFor(-5)).toBe(BASE_START_TIER);
  });
});

describe('growBase', () => {
  it('steps the tier forward to match the live boss count', () => {
    const grown = growBase(createBase(), BOSSES_PER_TIER);
    expect(grown).toEqual({
      tier: BASE_START_TIER + 1,
      bossesDefeated: BOSSES_PER_TIER,
    });
  });

  it('does not mutate its input (pure)', () => {
    const base = createBase();
    const snapshot: Base = { ...base };
    growBase(base, BOSSES_PER_TIER * 3);
    expect(base).toEqual(snapshot);
  });

  it('always returns a fresh object', () => {
    const base = createBase();
    expect(growBase(base, 0)).not.toBe(base);
  });

  it('is idempotent for the same boss count', () => {
    const once = growBase(createBase(), BOSSES_PER_TIER * 2);
    const twice = growBase(once, BOSSES_PER_TIER * 2);
    expect(twice).toEqual(once);
  });

  it('never regresses on a stale / lower count (grown home stays grown)', () => {
    const grown = growBase(createBase(), BOSSES_PER_TIER * 3);
    // A fresh run reloads a grown save and reports 0 bosses so far.
    const afterReload = growBase(grown, 0);
    expect(afterReload).toEqual(grown);
  });

  it('crosses several tiers in one settle (big jump)', () => {
    const grown = growBase(createBase(), BOSSES_PER_TIER * 4);
    expect(grown.tier).toBe(BASE_START_TIER + 4);
    expect(grown.bossesDefeated).toBe(BOSSES_PER_TIER * 4);
  });

  it('clamps a non-finite live count rather than poisoning the base', () => {
    const grown = growBase(createBase(), Number.NaN);
    expect(grown).toEqual({ tier: BASE_START_TIER, bossesDefeated: 0 });
  });
});

describe('baseHpBonus', () => {
  it('grants no bonus at the starting tier', () => {
    expect(baseHpBonus(createBase())).toBe(0);
  });

  it('grants HP_BONUS_PER_TIER per tier above the start', () => {
    const grown = growBase(createBase(), BOSSES_PER_TIER * 3);
    expect(grown.tier).toBe(BASE_START_TIER + 3);
    expect(baseHpBonus(grown)).toBe(HP_BONUS_PER_TIER * 3);
  });

  it('rises in lockstep with the tier (the tangible buff)', () => {
    let base = createBase();
    let prev = baseHpBonus(base);
    for (let bosses = 1; bosses <= BOSSES_PER_TIER * 5; bosses++) {
      base = growBase(base, bosses);
      const bonus = baseHpBonus(base);
      expect(bonus).toBeGreaterThanOrEqual(prev);
      expect(bonus).toBe((base.tier - BASE_START_TIER) * HP_BONUS_PER_TIER);
      prev = bonus;
    }
  });

  it('never goes negative for a degenerate sub-start tier', () => {
    const degenerate: Base = { tier: BASE_START_TIER - 5, bossesDefeated: 0 };
    expect(baseHpBonus(degenerate)).toBe(0);
  });
});
