import { describe, it, expect } from 'vitest';
import { BOSS_ROSTER, createBoss, type BossSpec } from './bosses.js';

describe('BOSS_ROSTER', () => {
  it('authors at least one boss', () => {
    expect(BOSS_ROSTER.length).toBeGreaterThan(0);
  });

  it('uses unique ids', () => {
    const ids = BOSS_ROSTER.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('makes every boss far tougher than the toughest swarm enemy (brute hp 25)', () => {
    for (const spec of BOSS_ROSTER) {
      expect(spec.hp).toBeGreaterThan(25);
    }
  });

  it('gives every enrage signature sane tuning', () => {
    for (const spec of BOSS_ROSTER) {
      if (spec.signature.kind === 'enrage') {
        expect(spec.signature.below).toBeGreaterThan(0);
        expect(spec.signature.below).toBeLessThanOrEqual(1);
        expect(spec.signature.speedMultiplier).toBeGreaterThan(1);
      }
    }
  });
});

describe('createBoss', () => {
  const spec: BossSpec = {
    id: 'test',
    name: 'Test Boss',
    hp: 100,
    atk: 9,
    def: 1,
    speed: 3,
    glyph: 'X',
    color: 'red',
    signature: { kind: 'none' },
  };

  it('stamps a boss-kind enemy at full health with its identity', () => {
    const boss = createBoss(spec, { x: 5, y: 7 });
    expect(boss.kind).toBe('boss');
    expect(boss.hp).toBe(spec.hp);
    expect(boss.maxHp).toBe(spec.hp);
    expect(boss.atk).toBe(spec.atk);
    expect(boss.id).toBe('test');
    expect(boss.name).toBe('Test Boss');
    expect(boss.pos).toEqual({ x: 5, y: 7 });
  });

  it('copies the position so the caller vector is never aliased', () => {
    const pos = { x: 1, y: 2 };
    const boss = createBoss(spec, pos);
    pos.x = 99;
    expect(boss.pos.x).toBe(1);
  });
});
