import { describe, it, expect } from 'vitest';
import { ATTACKS, ATTACK_KEYS, type AttackId } from './attacks.js';

const IDS: AttackId[] = ['quick-jab', 'wide-cleave', 'whirling-maelstrom'];

describe('ATTACKS catalog', () => {
  it('defines 2–3 named attacks (prd §6: 1–3 types)', () => {
    const count = Object.keys(ATTACKS).length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
  });

  it('gives every attack a non-empty display name and sane roll/cost fields', () => {
    for (const id of IDS) {
      const spec = ATTACKS[id];
      expect(spec.name.trim().length).toBeGreaterThan(0);
      expect(spec.radius).toBeGreaterThan(0);
      expect(spec.damage).toBeGreaterThan(0);
      expect(spec.staminaCost).toBeGreaterThan(0);
      expect(spec.hitChance).toBeGreaterThan(0);
      expect(spec.hitChance).toBeLessThanOrEqual(1);
    }
  });

  it('orders the catalog along a real risk/reward axis', () => {
    // Reward (radius, damage, cost) climbs and reliability (hitChance) falls as
    // you move from the cheap jab to the expensive maelstrom — the whole point.
    const ordered = IDS.map((id) => ATTACKS[id]);
    for (let i = 1; i < ordered.length; i++) {
      const lo = ordered[i - 1]!;
      const hi = ordered[i]!;
      expect(hi.radius).toBeGreaterThan(lo.radius);
      expect(hi.damage).toBeGreaterThan(lo.damage);
      expect(hi.staminaCost).toBeGreaterThan(lo.staminaCost);
      expect(hi.hitChance).toBeLessThan(lo.hitChance);
    }
  });
});

describe('ATTACK_KEYS bindings', () => {
  it('binds keys only to real attack ids', () => {
    const bindings = Object.values(ATTACK_KEYS);
    expect(bindings.length).toBeGreaterThan(0);
    for (const id of bindings) expect(ATTACKS[id]).toBeDefined();
  });

  it('does not collide with the movement / quit keys', () => {
    const reserved = new Set([
      'UP',
      'DOWN',
      'LEFT',
      'RIGHT',
      'w',
      'a',
      's',
      'd',
      'q',
      'CTRL_C',
    ]);
    for (const key of Object.keys(ATTACK_KEYS)) {
      expect(reserved.has(key)).toBe(false);
    }
  });
});
