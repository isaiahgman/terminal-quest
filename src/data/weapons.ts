/**
 * Weapons — the second progression axis (prd §7, F6): a single equipped weapon
 * that boosts your attacks. Found in the world, one slot, the new pickup
 * replacing the old (no inventory in v1).
 *
 * This is the **pure-logic leaf** (like `combat.ts`/`progression.ts`): weapon
 * *data* plus the one function that folds an equipped weapon into an attack. It
 * imports only the engine's `AttackSpec` type and never touches `GameState`,
 * the loop, or rendering, so the damage math is buildable and fully
 * unit-testable ahead of the entity/HUD wiring (the sequential integration
 * step, a later PR).
 *
 * How a weapon boosts damage — **reuse the combat path, never fork it**
 * (artifact Constraint). `combat.ts` deals `max(1, spec.damage + atk − def)`,
 * so a weapon expresses itself as a transform of the `AttackSpec` the engine is
 * about to resolve ({@link applyWeapon}): it raises the attack's base `damage`
 * (and may tweak `radius`/`staminaCost`), and the unchanged engine resolves the
 * boosted spec. Crucially the bonus is **additive and separate from `atk`** —
 * `atk` is the leveling stat (`progression.ts`); keeping gear out of it stops
 * weapons and the level curve from double-counting into one another.
 *
 * The catalogue sits on an ascending-power ladder: a heavier blade hits harder
 * (and reaches further / costs more stamina to swing) than a light one — the
 * "find a better weapon, feel stronger" beat. Weapons deliberately do **not**
 * touch `hitChance`: reliability is the attack's identity (the cheap jab rarely
 * whiffs, the maelstrom gambles), and gear shouldn't blur that axis.
 *
 * **Unarmed is the baseline, not a weapon.** The empty slot is modelled as
 * `undefined`, and {@link applyWeapon} with no weapon returns the attack
 * unchanged — so the first weapon you pick up is your first weapon, and every
 * downstream caller gets one well-defined "no gear" path.
 *
 * Purity contract (mirrors `combat.ts`): returns fresh objects, never mutates
 * inputs, no I/O, no `Math.random`. Non-finite modifiers are treated as zero so
 * a bad number can never poison the deterministic damage math.
 */

import type { AttackSpec } from '../game/combat.js';

/** Stable identifier for a weapon — the discriminant a pickup/slot carries. */
export type WeaponId = 'rusted-dagger' | 'iron-sword' | 'warhammer';

/**
 * A weapon's effect on your attacks: a flat boost to the attack's base
 * `damage`, with optional reach and swing-weight tweaks. Every field is a
 * *modifier* applied on top of the chosen {@link AttackSpec} — never an absolute
 * — so the same weapon scales whichever attack you throw. No `hitChance`: gear
 * changes power and weight, not an attack's reliability.
 */
export interface Weapon {
  /** Display name (e.g. "Iron Sword"); shown in the HUD once wired (TQ-008). */
  name: string;
  /** Added to the attack's base `damage` (before `atk`/`def`). The core boost. */
  damageBonus: number;
  /** Optional: added to the attack's `radius` (reach). A longer weapon swings wider. */
  radiusBonus?: number;
  /** Optional: added to the attack's `staminaCost` (+ heavier to swing, − lighter). */
  staminaDelta?: number;
}

// TODO(isaiah): finalize weapon names/numbers — evocative placeholders on a
// damage ladder, tuned by playing (knobs co-located here, mirroring attacks.ts).
export const WEAPONS: Record<WeaponId, Weapon> = {
  'rusted-dagger': {
    name: 'Rusted Dagger',
    // Light and quick: a small bite, no reach gain, a touch cheaper to swing.
    damageBonus: 2,
    staminaDelta: -1,
  },
  'iron-sword': {
    name: 'Iron Sword',
    // The honest middle: solid damage and a little extra reach at no swing cost.
    damageBonus: 4,
    radiusBonus: 0.5,
  },
  warhammer: {
    name: 'Warhammer',
    // Heavy hitter: big damage and reach, but each swing drains more stamina.
    damageBonus: 8,
    radiusBonus: 1,
    staminaDelta: 2,
  },
};

/** Treat a non-finite modifier as zero so it can't poison the damage math. */
function finite(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * Fold an equipped `weapon` into the `spec` the combat engine is about to
 * resolve, returning a **new** `AttackSpec`. Unarmed (`weapon` is `undefined`)
 * returns an unchanged copy — the well-defined "no gear" path.
 *
 * The weapon adds its `damageBonus` to the attack's base `damage` and its
 * optional `radiusBonus`/`staminaDelta` to `radius`/`staminaCost`. `radius` and
 * `staminaCost` are clamped to ≥ 0 (a negative swing-weight can lighten a swing
 * but never make it free or invert the reach); `damage` is left as-is because
 * `resolveAttack` already floors a landed hit at 1. `hitChance` is never touched.
 *
 * Pure: `spec` and `weapon` are not mutated; non-finite modifiers act as zero.
 */
export function applyWeapon(
  spec: AttackSpec,
  weapon: Weapon | undefined,
): AttackSpec {
  if (!weapon) return { ...spec };
  return {
    ...spec,
    damage: spec.damage + finite(weapon.damageBonus),
    radius: Math.max(0, spec.radius + finite(weapon.radiusBonus)),
    staminaCost: Math.max(0, spec.staminaCost + finite(weapon.staminaDelta)),
  };
}
