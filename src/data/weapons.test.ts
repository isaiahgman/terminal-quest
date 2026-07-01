import { describe, it, expect } from 'vitest';
import { WEAPONS, applyWeapon, type WeaponId, type Weapon } from './weapons.js';
import {
  resolveAttack,
  type AttackSpec,
  type Combatant,
} from '../game/combat.js';

const IDS: WeaponId[] = ['rusted-dagger', 'iron-sword', 'warhammer'];

/** A plain attack to fold weapons into; cheap and reliable so tests are exact. */
const BASE_SPEC: AttackSpec = {
  name: 'Test Swing',
  radius: 2,
  damage: 5,
  staminaCost: 4,
  hitChance: 1,
};

describe('WEAPONS catalog', () => {
  it('defines several weapons, each with a name and a real damage boost', () => {
    expect(Object.keys(WEAPONS).length).toBeGreaterThanOrEqual(2);
    for (const id of IDS) {
      const w = WEAPONS[id];
      expect(w.name.trim().length).toBeGreaterThan(0);
      expect(w.damageBonus).toBeGreaterThan(0);
    }
  });

  it('orders the catalog along an ascending damage ladder', () => {
    const ordered = IDS.map((id) => WEAPONS[id]);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.damageBonus).toBeGreaterThan(
        ordered[i - 1]!.damageBonus,
      );
    }
  });
});

describe('applyWeapon', () => {
  it('unarmed (undefined) returns the spec unchanged, as a fresh object', () => {
    const out = applyWeapon(BASE_SPEC, undefined);
    expect(out).toEqual(BASE_SPEC);
    expect(out).not.toBe(BASE_SPEC); // no aliasing — callers may mutate the copy
  });

  it('folds damage / radius / stamina modifiers into the attack', () => {
    const weapon: Weapon = {
      name: 'Test',
      damageBonus: 3,
      radiusBonus: 1,
      staminaDelta: 2,
    };
    const out = applyWeapon(BASE_SPEC, weapon);
    expect(out.damage).toBe(8); // 5 + 3
    expect(out.radius).toBe(3); // 2 + 1
    expect(out.staminaCost).toBe(6); // 4 + 2
  });

  it('leaves hitChance and name untouched (gear changes power, not reliability)', () => {
    const out = applyWeapon(BASE_SPEC, WEAPONS.warhammer);
    expect(out.hitChance).toBe(BASE_SPEC.hitChance);
    expect(out.name).toBe(BASE_SPEC.name);
  });

  it('applies a missing optional modifier as zero', () => {
    const out = applyWeapon(BASE_SPEC, { name: 'Dmg Only', damageBonus: 1 });
    expect(out.radius).toBe(BASE_SPEC.radius);
    expect(out.staminaCost).toBe(BASE_SPEC.staminaCost);
  });

  it('clamps radius and staminaCost to >= 0 when a modifier would push them negative', () => {
    const out = applyWeapon(BASE_SPEC, {
      name: 'Featherlight',
      damageBonus: 1,
      radiusBonus: -10,
      staminaDelta: -10,
    });
    expect(out.radius).toBe(0);
    expect(out.staminaCost).toBe(0);
  });

  it('does NOT clamp damage — a negative damageBonus can lower it below the unarmed value', () => {
    // Asymmetric on purpose: radius/staminaCost clamp to >= 0, but damage is
    // left un-floored because resolveAttack already floors a *landed hit* at 1.
    // Pins the contract so a future Math.max(0, ...) "fix" can't slip in.
    const out = applyWeapon(BASE_SPEC, { name: 'Frail', damageBonus: -2 });
    expect(out.damage).toBe(3); // 5 - 2, not clamped to 0 or up to 5
  });

  it('treats non-finite modifiers as zero so they cannot poison the damage math', () => {
    const out = applyWeapon(BASE_SPEC, {
      name: 'Cursed',
      damageBonus: NaN,
      radiusBonus: Infinity,
      staminaDelta: -Infinity,
    });
    expect(out.damage).toBe(BASE_SPEC.damage);
    expect(out.radius).toBe(BASE_SPEC.radius);
    expect(out.staminaCost).toBe(BASE_SPEC.staminaCost);
  });

  it('does not mutate the input spec or weapon', () => {
    const spec = { ...BASE_SPEC };
    const weapon: Weapon = {
      name: 'Test',
      damageBonus: 3,
      radiusBonus: 1,
      staminaDelta: 2,
    };
    applyWeapon(spec, weapon);
    expect(spec).toEqual(BASE_SPEC);
    expect(weapon).toEqual({
      name: 'Test',
      damageBonus: 3,
      radiusBonus: 1,
      staminaDelta: 2,
    });
  });
});

describe('applyWeapon ∘ resolveAttack — the engine actually deals more', () => {
  // Prove the modifier flows through the real combat path: same attacker,
  // target, and a hitChance of 1 (always lands), so any damage delta is the
  // weapon's doing — not a fork of the engine.
  const attacker: Combatant = {
    pos: { x: 0, y: 0 },
    hp: 30,
    stamina: 100,
    maxStamina: 100,
    atk: 3,
    def: 0,
  };
  const target = (): Combatant => ({
    pos: { x: 1, y: 0 },
    hp: 100,
    stamina: 0,
    maxStamina: 0,
    atk: 0,
    def: 0,
  });
  const rng = () => 0; // always < hitChance(1) ⇒ guaranteed hit

  it('an equipped weapon raises the damage the engine deals', () => {
    const unarmed = resolveAttack(
      attacker,
      [target()],
      applyWeapon(BASE_SPEC, undefined),
      rng,
    );
    const armed = resolveAttack(
      attacker,
      [target()],
      applyWeapon(BASE_SPEC, WEAPONS.warhammer),
      rng,
    );
    expect(unarmed.outcomes[0]!.damage).toBe(8); // 5 + atk 3 - def 0
    expect(armed.outcomes[0]!.damage).toBe(16); // (5 + 8) + 3 - 0
    expect(armed.outcomes[0]!.damage).toBeGreaterThan(
      unarmed.outcomes[0]!.damage,
    );
  });

  it("a weapon's radiusBonus extends who the engine can actually hit", () => {
    // A target straddling the reach gap: dist² = 6.25 sits outside the unarmed
    // radius² (2² = 4) but inside the warhammer-armed radius² (3² = 9). So the
    // *engine's own target selection* — not just the pinned radius number —
    // must let the armed swing reach it while the unarmed swing whiffs.
    const farTarget = (): Combatant => ({
      pos: { x: 2.5, y: 0 }, // dist² from (0,0) = 6.25
      hp: 100,
      stamina: 0,
      maxStamina: 0,
      atk: 0,
      def: 0,
    });
    const unarmed = resolveAttack(
      attacker,
      [farTarget()],
      applyWeapon(BASE_SPEC, undefined),
      rng,
    );
    const armed = resolveAttack(
      attacker,
      [farTarget()],
      applyWeapon(BASE_SPEC, WEAPONS.warhammer),
      rng,
    );
    expect(unarmed.outcomes).toHaveLength(0); // out of reach unarmed
    expect(armed.outcomes).toHaveLength(1); // brought into reach by the weapon
    expect(armed.outcomes[0]!.hit).toBe(true);
  });
});
