import { describe, it, expect } from 'vitest';
import { resolveAttack, regenStamina } from './combat.js';
import type { Combatant, AttackSpec, Rng } from './combat.js';

/**
 * A deterministic, scriptable RNG: yields the queued values in order and
 * throws if drained — so a test fails loudly if combat consumes more rolls
 * than expected (e.g. rolling for out-of-radius targets).
 */
function scriptedRng(values: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= values.length)
      throw new Error('scriptedRng drained — unexpected extra roll');
    return values[i++]!;
  };
}

/** RNG that fails on any call — proves a code path consumes no randomness. */
const noRng: Rng = () => {
  throw new Error('rng must not be called');
};

function makeAttacker(overrides: Partial<Combatant> = {}): Combatant {
  return {
    pos: { x: 0, y: 0 },
    hp: 100,
    stamina: 10,
    maxStamina: 10,
    atk: 0,
    def: 0,
    ...overrides,
  };
}

function makeTarget(
  x: number,
  y: number,
  overrides: Partial<Combatant> = {},
): Combatant {
  return {
    pos: { x, y },
    hp: 20,
    stamina: 0,
    maxStamina: 0,
    atk: 0,
    def: 0,
    ...overrides,
  };
}

const SPEC: AttackSpec = {
  name: 'Test Slash',
  radius: 2,
  damage: 5,
  staminaCost: 3,
  hitChance: 0.5,
};

describe('resolveAttack — radius selection', () => {
  it('only targets combatants within the (inclusive) radius', () => {
    const inside = makeTarget(2, 0); // distance 2 == radius → inside
    const outside = makeTarget(3, 0); // distance 3 > radius → outside
    // One value only: a roll for the outside target would drain and throw.
    const result = resolveAttack(
      makeAttacker(),
      [inside, outside],
      SPEC,
      scriptedRng([0.0]),
    );

    expect(result.outcomes).toEqual([{ index: 0, hit: true, damage: 5 }]);
    expect(result.targets[1]!.hp).toBe(20); // untouched, no roll spent
  });

  it('consumes a roll for every in-radius target, in input order', () => {
    const a = makeTarget(0, 0);
    const b = makeTarget(1, 1);
    const result = resolveAttack(
      makeAttacker(),
      [a, b],
      SPEC,
      scriptedRng([0.9, 0.1]),
    );

    expect(result.outcomes.map((o) => o.hit)).toEqual([false, true]);
  });
});

describe('resolveAttack — hit chance', () => {
  it('lands when the roll is below hitChance and misses when at/above it', () => {
    const target = makeTarget(0, 0);
    expect(
      resolveAttack(makeAttacker(), [target], SPEC, scriptedRng([0.49]))
        .outcomes[0]!.hit,
    ).toBe(true);
    expect(
      resolveAttack(makeAttacker(), [target], SPEC, scriptedRng([0.5]))
        .outcomes[0]!.hit,
    ).toBe(false);
  });

  it('a miss deals no damage and leaves hp unchanged', () => {
    const target = makeTarget(0, 0);
    const result = resolveAttack(
      makeAttacker(),
      [target],
      SPEC,
      scriptedRng([0.99]),
    );
    expect(result.outcomes[0]).toEqual({ index: 0, hit: false, damage: 0 });
    expect(result.targets[0]!.hp).toBe(20);
  });
});

describe('resolveAttack — damage math', () => {
  it('damage = base + attacker.atk − target.def', () => {
    const attacker = makeAttacker({ atk: 4 });
    const target = makeTarget(0, 0, { hp: 30, def: 2 });
    const result = resolveAttack(attacker, [target], SPEC, scriptedRng([0.0]));
    // 5 + 4 − 2 = 7
    expect(result.outcomes[0]!.damage).toBe(7);
    expect(result.targets[0]!.hp).toBe(23);
  });

  it('clamps a landed hit to a minimum of 1 even against high defense', () => {
    const target = makeTarget(0, 0, { hp: 30, def: 999 });
    const result = resolveAttack(
      makeAttacker(),
      [target],
      SPEC,
      scriptedRng([0.0]),
    );
    expect(result.outcomes[0]!.damage).toBe(1);
    expect(result.targets[0]!.hp).toBe(29);
  });
});

describe('resolveAttack — stamina', () => {
  it('deducts the stamina cost when the attack lands', () => {
    const attacker = makeAttacker({ stamina: 10 });
    const result = resolveAttack(
      attacker,
      [makeTarget(0, 0)],
      SPEC,
      scriptedRng([0.9]),
    );
    expect(result.blocked).toBe(false);
    expect(result.attacker.stamina).toBe(7); // 10 − 3
  });

  it('blocks the attack when stamina is below cost — unchanged, no roll spent', () => {
    const attacker = makeAttacker({ stamina: 2 }); // cost is 3
    const target = makeTarget(0, 0);
    const result = resolveAttack(attacker, [target], SPEC, noRng);

    expect(result.blocked).toBe(true);
    expect(result.outcomes).toEqual([]);
    expect(result.attacker.stamina).toBe(2);
    expect(result.targets[0]!.hp).toBe(20);
  });

  it('allows the attack when stamina exactly equals cost', () => {
    const attacker = makeAttacker({ stamina: 3 });
    const result = resolveAttack(
      attacker,
      [makeTarget(0, 0)],
      SPEC,
      scriptedRng([0.9]),
    );
    expect(result.blocked).toBe(false);
    expect(result.attacker.stamina).toBe(0);
  });
});

describe('regenStamina', () => {
  it('adds stamina up to maxStamina', () => {
    expect(
      regenStamina(makeAttacker({ stamina: 4, maxStamina: 10 }), 3).stamina,
    ).toBe(7);
  });

  it('clamps at maxStamina', () => {
    expect(
      regenStamina(makeAttacker({ stamina: 9, maxStamina: 10 }), 5).stamina,
    ).toBe(10);
  });

  it('never reduces stamina (non-positive amount is a no-op)', () => {
    expect(
      regenStamina(makeAttacker({ stamina: 6, maxStamina: 10 }), -4).stamina,
    ).toBe(6);
  });
});

describe('purity — inputs are never mutated', () => {
  it('resolveAttack returns fresh objects and leaves frozen inputs intact', () => {
    const attacker = Object.freeze(
      makeAttacker({ pos: Object.freeze({ x: 0, y: 0 }) }),
    );
    const target = Object.freeze(
      makeTarget(0, 0, { pos: Object.freeze({ x: 0, y: 0 }) }),
    );
    const targets = Object.freeze([target]);

    // Frozen inputs → any in-place mutation throws in strict mode (ESM is strict).
    const result = resolveAttack(attacker, targets, SPEC, scriptedRng([0.0]));

    expect(result.attacker).not.toBe(attacker);
    expect(result.targets[0]).not.toBe(target);
    expect(attacker.stamina).toBe(10); // unchanged
    expect(target.hp).toBe(20); // unchanged
  });

  it('regenStamina returns a fresh object and leaves the frozen input intact', () => {
    const input = Object.freeze(makeAttacker({ stamina: 4, maxStamina: 10 }));
    const out = regenStamina(input, 3);
    expect(out).not.toBe(input);
    expect(input.stamina).toBe(4);
  });
});
