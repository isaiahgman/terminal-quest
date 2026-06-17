import { describe, it, expect } from 'vitest';
import {
  BASE_ATK,
  BASE_HP,
  BASE_STAMINA,
  applyLevelUp,
  createProgression,
  gainXp,
  xpForKill,
  xpToNext,
  type Progression,
} from './progression.js';

describe('createProgression', () => {
  it('starts at level 1 with no XP and the baseline stats', () => {
    expect(createProgression()).toEqual({
      level: 1,
      xp: 0,
      maxHp: BASE_HP,
      maxStamina: BASE_STAMINA,
      atk: BASE_ATK,
    });
  });
});

describe('xpToNext', () => {
  it('matches the geometric curve (1 → 2 costs BASE_XP)', () => {
    expect(xpToNext(1)).toBe(20);
    expect(xpToNext(2)).toBe(30);
    expect(xpToNext(3)).toBe(45);
    expect(xpToNext(4)).toBe(68);
    expect(xpToNext(5)).toBe(101);
  });

  it('is strictly increasing — the grind ramps every level (monotonicity)', () => {
    for (let level = 1; level < 20; level++) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
    }
  });

  it('never returns a non-positive threshold (would loop gainXp forever)', () => {
    for (let level = 1; level < 50; level++) {
      expect(xpToNext(level)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('gainXp', () => {
  it('banks XP toward the next level without levelling up below the threshold', () => {
    const next = gainXp(createProgression(), 5);
    expect(next.level).toBe(1);
    expect(next.xp).toBe(5);
    // Stats are untouched until a level-up.
    expect(next.maxHp).toBe(BASE_HP);
    expect(next.atk).toBe(BASE_ATK);
  });

  it('levels up once and carries the surplus XP', () => {
    const next = gainXp(createProgression(), 25);
    expect(next.level).toBe(2);
    expect(next.xp).toBe(5); // 25 - xpToNext(1)=20
    expect(next.maxHp).toBe(25); // +5
    expect(next.maxStamina).toBe(13); // +3
    expect(next.atk).toBe(5); // +2
  });

  it('lands the killing blow exactly on the threshold (boundary)', () => {
    const next = gainXp(createProgression(), 20);
    expect(next.level).toBe(2);
    expect(next.xp).toBe(0);
  });

  it('crosses several thresholds in a single gain (multi-level-up)', () => {
    const next = gainXp(createProgression(), 60);
    expect(next.level).toBe(3);
    expect(next.xp).toBe(10); // 60 - 20 - 30
    expect(next.maxHp).toBe(33); // 20 + 5 + 8
    expect(next.maxStamina).toBe(17); // 10 + 3 + 4
    expect(next.atk).toBe(8); // 3 + 2 + 3
  });

  it('is a no-op for non-positive or non-finite amounts', () => {
    const start = createProgression();
    for (const bad of [0, -5, NaN, Infinity, -Infinity]) {
      expect(gainXp(start, bad)).toEqual(start);
    }
  });

  it('is pure — never mutates its input', () => {
    const start = createProgression();
    const snapshot = { ...start };
    gainXp(start, 100);
    expect(start).toEqual(snapshot);
  });
});

describe('applyLevelUp', () => {
  it('bumps the level and grows every stat, leaving XP for gainXp to manage', () => {
    const start: Progression = { ...createProgression(), xp: 7 };
    const next = applyLevelUp(start);
    expect(next.level).toBe(2);
    expect(next.xp).toBe(7);
    expect(next.maxHp).toBe(25);
    expect(next.maxStamina).toBe(13);
    expect(next.atk).toBe(5);
  });

  it('grants accelerating gains — power growth is explosive (monotonicity)', () => {
    let current = createProgression();
    let prevHpGain = 0;
    let prevAtkGain = 0;
    for (let i = 0; i < 10; i++) {
      const next = applyLevelUp(current);
      const hpGain = next.maxHp - current.maxHp;
      const atkGain = next.atk - current.atk;
      if (i > 0) {
        expect(hpGain).toBeGreaterThan(prevHpGain);
        expect(atkGain).toBeGreaterThan(prevAtkGain);
      }
      prevHpGain = hpGain;
      prevAtkGain = atkGain;
      current = next;
    }
  });

  it('is pure — never mutates its input', () => {
    const start = createProgression();
    const snapshot = { ...start };
    applyLevelUp(start);
    expect(start).toEqual(snapshot);
  });
});

describe('xpForKill', () => {
  it('scales with toughness — harder enemies are worth more XP', () => {
    const runner = xpForKill({ maxHp: 5, atk: 1 });
    const grunt = xpForKill({ maxHp: 10, atk: 2 });
    const brute = xpForKill({ maxHp: 25, atk: 5 });
    expect(runner).toBe(7); // 5*1 + 1*2
    expect(grunt).toBe(14); // 10*1 + 2*2
    expect(brute).toBe(35); // 25*1 + 5*2
    expect(runner).toBeLessThan(grunt);
    expect(grunt).toBeLessThan(brute);
  });

  it('always awards at least 1 XP', () => {
    expect(xpForKill({ maxHp: 0, atk: 0 })).toBe(1);
  });
});
