import { describe, it, expect } from 'vitest';
import { createEnemy, ENEMY_TYPES, type EnemyKind } from './enemy.js';

const KINDS = Object.keys(ENEMY_TYPES) as EnemyKind[];

describe('createEnemy', () => {
  it('stamps every table stat field onto the instance for every kind', () => {
    for (const kind of KINDS) {
      const stats = ENEMY_TYPES[kind];
      const enemy = createEnemy(kind, { x: 3, y: 7 });
      expect(enemy.kind).toBe(kind);
      expect(enemy.pos).toEqual({ x: 3, y: 7 });
      expect(enemy.maxHp).toBe(stats.hp);
      // Key-driven so the factory and the stat table can't silently drift: if a
      // field is added to the table and `createEnemy` forgets to copy it, this
      // fails instead of passing on a stale hand-written list.
      for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
        expect(enemy[key]).toBe(stats[key]);
      }
    }
  });

  it('starts at full health (hp === maxHp)', () => {
    const enemy = createEnemy('brute', { x: 0, y: 0 });
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('copies the position so the caller Vec2 is not aliased', () => {
    const spawn = { x: 1, y: 2 };
    const enemy = createEnemy('grunt', spawn);
    expect(enemy.pos).not.toBe(spawn);
    spawn.x = 99;
    expect(enemy.pos.x).toBe(1);
  });
});

describe('ENEMY_TYPES data-table integrity', () => {
  it('has at least two kinds', () => {
    expect(KINDS.length).toBeGreaterThanOrEqual(2);
  });

  it('gives every kind sane, positive combat stats', () => {
    for (const kind of KINDS) {
      const stats = ENEMY_TYPES[kind];
      expect(stats.hp).toBeGreaterThan(0);
      expect(stats.atk).toBeGreaterThan(0);
      expect(stats.speed).toBeGreaterThan(0);
    }
  });

  it('uses a single-character glyph and a non-empty color per kind', () => {
    for (const kind of KINDS) {
      const stats = ENEMY_TYPES[kind];
      expect(stats.glyph).toHaveLength(1);
      expect(stats.color.length).toBeGreaterThan(0);
    }
  });

  it('assigns a distinct glyph to each kind (no map collisions)', () => {
    const glyphs = KINDS.map((kind) => ENEMY_TYPES[kind].glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
