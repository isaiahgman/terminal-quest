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

  it('reports outcome.index by input position, not by outcome order', () => {
    // Out-of-radius target FIRST: its slot is skipped, so the in-radius target
    // at array index 1 must still report index 1 (not the outcomes length, 0).
    const result = resolveAttack(
      makeAttacker(),
      [makeTarget(3, 0), makeTarget(0, 0)],
      SPEC,
      scriptedRng([0.0]), // one roll only — the outside target spends none
    );
    expect(result.outcomes).toEqual([{ index: 1, hit: true, damage: 5 }]);
  });

  it('includes a target on the inclusive boundary off-axis (distance == radius)', () => {
    // (1,1) is distance √2 from the origin; radius √2 ⇒ exactly on the boundary.
    const result = resolveAttack(
      makeAttacker(),
      [makeTarget(1, 1)],
      { ...SPEC, radius: Math.SQRT2 },
      scriptedRng([0.0]),
    );
    expect(result.outcomes).toEqual([{ index: 0, hit: true, damage: 5 }]);
  });

  it('handles empty targets — deducts stamina, no roll, no outcomes', () => {
    const result = resolveAttack(makeAttacker(), [], SPEC, noRng);
    expect(result.blocked).toBe(false);
    expect(result.outcomes).toEqual([]);
    expect(result.attacker.stamina).toBe(7); // 10 − 3, cost still paid
  });

  it('fails closed on a negative radius — selects nobody, spends no roll', () => {
    const result = resolveAttack(
      makeAttacker(),
      [makeTarget(0, 0)], // would be dead-centre for any non-negative radius
      { ...SPEC, radius: -2 },
      noRng,
    );
    expect(result.outcomes).toEqual([]);
    expect(result.targets[0]!.hp).toBe(20);
  });

  it('fails closed on a NaN target coordinate — excluded, spends no roll', () => {
    const result = resolveAttack(
      makeAttacker(),
      [makeTarget(NaN, 0)],
      SPEC,
      noRng,
    );
    expect(result.outcomes).toEqual([]);
    expect(result.targets[0]!.hp).toBe(20);
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

  it('hitChance 0 never hits, even on the lowest possible roll', () => {
    const result = resolveAttack(
      makeAttacker(),
      [makeTarget(0, 0)],
      { ...SPEC, hitChance: 0 },
      scriptedRng([0.0]),
    );
    expect(result.outcomes[0]!.hit).toBe(false);
  });

  it('hitChance 1 always hits, even on the highest possible roll', () => {
    const result = resolveAttack(
      makeAttacker(),
      [makeTarget(0, 0)],
      { ...SPEC, hitChance: 1 },
      scriptedRng([0.999999]),
    );
    expect(result.outcomes[0]!.hit).toBe(true);
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

  it('never reduces stamina that already exceeds maxStamina', () => {
    // Defensive: nothing overfills today, but the contract is "never below the
    // current value" — regen must hold an over-max value, not clamp it down.
    expect(
      regenStamina(makeAttacker({ stamina: 15, maxStamina: 10 }), 3).stamina,
    ).toBe(15);
  });

  it('treats a non-finite amount as a no-op (NaN must not poison stamina)', () => {
    // Without the Number.isFinite guard the clamp yields NaN, and a NaN
    // stamina permanently disables the "too tired" gate (NaN < cost is false).
    const out = regenStamina(makeAttacker({ stamina: 6, maxStamina: 10 }), NaN);
    expect(out.stamina).toBe(6);
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
    // Nested pos must be a fresh object too — a shallow spread would alias it,
    // letting a downstream consumer mutate the original via result…pos.
    expect(result.attacker.pos).not.toBe(attacker.pos);
    expect(result.targets[0]!.pos).not.toBe(target.pos);
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

/** A seeded mulberry32 PRNG — fixed seed ⇒ a fixed roll stream, so this is deterministic. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('resolveAttack — hit-chance distribution (seeded)', () => {
  it('landed fraction over many seeded rolls tracks hitChance', () => {
    const rng = mulberry32(0x9e3779b9);
    const spec: AttackSpec = { ...SPEC, hitChance: 0.5 };
    const trials = 2000;
    let hits = 0;
    for (let i = 0; i < trials; i++) {
      const { outcomes } = resolveAttack(
        makeAttacker(),
        [makeTarget(0, 0)],
        spec,
        rng,
      );
      if (outcomes[0]!.hit) hits++;
    }
    // Deterministic for this seed; band proves rate-fidelity, not exact equality.
    expect(hits / trials).toBeGreaterThan(0.47);
    expect(hits / trials).toBeLessThan(0.53);
  });

  it('rolls each in-radius target independently (one roll per target)', () => {
    const result = resolveAttack(
      makeAttacker(),
      [makeTarget(0, 0), makeTarget(1, 0), makeTarget(0, 1)],
      { ...SPEC, hitChance: 0.5 },
      scriptedRng([0.1, 0.9, 0.1]),
    );
    // Distinct per-target rolls ⇒ distinct outcomes; a single shared roll could not.
    expect(result.outcomes.map((o) => o.hit)).toEqual([true, false, true]);
  });
});
