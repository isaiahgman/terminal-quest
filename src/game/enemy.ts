/**
 * Enemy data model — pure data, no world/loop logic.
 *
 * This file owns the `Enemy` shape and a small, balanced table of enemy kinds.
 * Spawning, AI stepping, and rendering live elsewhere (PR-005 core / renderer)
 * so this module stays a dependency-free leaf the simulation can build on.
 *
 * Architecture note: the simulation layer must never import the render layer,
 * so `glyph`/`color` are kept as plain strings here (the renderer maps them to
 * a terminal-kit Glyph). Colors use terminal-kit color names, matching
 * `src/render/sprites.ts`.
 */

import type { Vec2 } from './state.js';

/** Discriminant tag identifying both the enemy archetype and its AI profile. */
export type EnemyKind = 'grunt' | 'runner' | 'brute';

/** A live enemy in the world. Plain, serializable data (no methods). */
export interface Enemy {
  /** Archetype / AI tag — what update() branches on to drive behavior. */
  readonly kind: EnemyKind;
  /** Grid position. Mutated by the AI step in the sim layer. */
  pos: Vec2;
  /** Current health; reaches 0 → dead. Mutated by combat (PR-006). */
  hp: number;
  /** Spawn health, for HUD bars and clamping heals. */
  readonly maxHp: number;
  /** Contact / attack damage dealt to the player. */
  readonly atk: number;
  /** Movement rate in tiles per second (consumed against the loop's dt). */
  readonly speed: number;
  /** Single-character map glyph (rendering happens in the render layer). */
  readonly glyph: string;
  /** terminal-kit color name for the glyph. */
  readonly color: string;
}

/** Immutable per-kind template: the stats `createEnemy` stamps onto instances. */
interface EnemyStats {
  readonly hp: number;
  readonly atk: number;
  readonly speed: number;
  readonly glyph: string;
  readonly color: string;
}

/**
 * Balance rationale — three kinds spread along the speed ↔ durability ↔ damage
 * triangle so no single player tactic answers all of them. Each kind spends a
 * comparable "threat budget": the runner trades health for speed, the brute
 * trades speed for health + damage, and the grunt is the baseline yardstick.
 *
 *   kind    hp  atk  speed   role
 *   grunt   10   2     4     baseline melee — the unit everything else is tuned against
 *   runner   5   1     8     fast & fragile — enforces "stand still and you die"; dies in one good hit
 *   brute   25   5     2     slow tank — punishes face-tanking; you must kite or out-position it
 *
 * Speed is in tiles/second; grunt's 4/s (a move every 0.25s) is the reference
 * pace. Numbers are deliberately small, round, and relative — concrete tuning
 * against player stats lands once enemies are wired into update() (PR-005 core)
 * and combat exists (PR-006).
 */
export const ENEMY_TYPES: Record<EnemyKind, EnemyStats> = {
  grunt: { hp: 10, atk: 2, speed: 4, glyph: 'g', color: 'green' },
  runner: { hp: 5, atk: 1, speed: 8, glyph: 'r', color: 'yellow' },
  brute: { hp: 25, atk: 5, speed: 2, glyph: 'B', color: 'red' },
};

/**
 * Build a fresh enemy of `kind` at `pos`. `hp` starts at `maxHp`. The position
 * is copied so the caller's `Vec2` is never aliased into the enemy.
 */
export function createEnemy(kind: EnemyKind, pos: Vec2): Enemy {
  const stats = ENEMY_TYPES[kind];
  return {
    kind,
    pos: { x: pos.x, y: pos.y },
    hp: stats.hp,
    maxHp: stats.hp,
    atk: stats.atk,
    speed: stats.speed,
    glyph: stats.glyph,
    color: stats.color,
  };
}
