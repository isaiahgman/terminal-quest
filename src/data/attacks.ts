/**
 * The player's named attacks — the signature risk/reward system (prd §6, F4).
 *
 * This is **data only**: each entry is an `AttackSpec` the pure combat engine
 * (`combat.ts`) already knows how to resolve. No combat math lives here — the
 * input layer turns a keypress into an `AttackIntent`, and `update()` looks the
 * spec up and hands it to `resolveAttack` (TQ-007 wiring).
 *
 * The three attacks sit on a single axis — cheap/small/reliable → expensive/
 * big/risky — so the player trades stamina economy against reach and burst:
 *
 *   id                   radius  damage  cost  hitChance   feel
 *   quick-jab              1.5      2      2      0.9      spam it; sips stamina, rarely whiffs
 *   wide-cleave             2       5      4      0.75     the workhorse; clears a cluster
 *   whirling-maelstrom      4      10      8      0.6      one big swing then you're spent — reposition
 *
 * Radii are **Euclidean** (the combat engine measures distance², `combat.ts`),
 * while enemy contact damage is Chebyshev (the 8-neighbourhood, `entities.ts`).
 * The cheap jab's radius is deliberately 1.5, not 1: 1.5² = 2.25 covers the
 * diagonal neighbours (distance² = 2) as well as the orthogonal ones (1), so it
 * reaches **exactly the eight cells an enemy can bite you from** — you can
 * always retaliate against anything in contact range, with no metric-mismatch
 * blind spot — while still excluding the next ring out (distance² = 4 > 2.25).
 *
 * Damage scales with the player's `atk` (a level-up stat, TQ-009), so the same
 * attack hits harder as you grow. With a starting `maxStamina` of 10 the gate is
 * felt immediately: ~5 jabs, or a single maelstrom, before you're blocked and
 * must back off while it regens.
 */

import type { AttackSpec } from '../game/combat.js';

/** Stable identifier for an attack — the discriminant carried by an intent. */
export type AttackId = 'quick-jab' | 'wide-cleave' | 'whirling-maelstrom';

// TODO(isaiah): finalize the attack names — these are evocative placeholders
// (the creative hook called out in the TQ-007 notes), not final copy.
export const ATTACKS: Record<AttackId, AttackSpec> = {
  'quick-jab': {
    name: 'Quick Jab',
    // 1.5 (not 1) so the Euclidean reach covers the full 8-neighbourhood — the
    // same cells an enemy contact-hits from. See the module header.
    radius: 1.5,
    damage: 2,
    staminaCost: 2,
    hitChance: 0.9,
  },
  'wide-cleave': {
    name: 'Wide Cleave',
    radius: 2,
    damage: 5,
    staminaCost: 4,
    hitChance: 0.75,
  },
  'whirling-maelstrom': {
    name: 'Whirling Maelstrom',
    radius: 4,
    damage: 10,
    staminaCost: 8,
    hitChance: 0.6,
  },
};

/**
 * Keyboard bindings → attack id, consumed by the input layer (`input.ts`).
 * The right-hand `j`/`k`/`l` cluster maps low → high risk, clear of the
 * movement keys (arrows / WASD) so the two never collide.
 */
export const ATTACK_KEYS: Record<string, AttackId> = {
  j: 'quick-jab',
  k: 'wide-cleave',
  l: 'whirling-maelstrom',
};
