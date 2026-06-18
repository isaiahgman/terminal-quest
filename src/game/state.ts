/**
 * Core game state. This is the single source of truth the simulation advances
 * and the renderer reads. Keep it plain data (serializable) — no methods, no
 * class instances — so save/load is trivial later (TQ-012).
 */

import type { Enemy } from './enemy.js';
import type { EnemyAi } from './entities.js';
import type { Progression } from './progression.js';
import { createProgression } from './progression.js';

export interface Vec2 {
  x: number;
  y: number;
}

export type Tile = 'floor' | 'wall';

export interface World {
  readonly width: number;
  readonly height: number;
  /** Row-major: tiles[y][x]. Deeply read-only — Render is read-only (see TDD). */
  readonly tiles: ReadonlyArray<ReadonlyArray<Tile>>;
  readonly seed: number;
}

export interface Player {
  pos: Vec2;
  /** Current health; chipped by enemy contact, floored at 0 (ceiling: progress.maxHp). */
  hp: number;
  /** Current stamina; spent by attacks, regenerated each tick (ceiling: progress.maxStamina). */
  stamina: number;
  /** Defensive power subtracted from incoming attack damage (a `Combatant.def`). */
  def: number;
  /**
   * Leveling state and the stat ceilings it raises (TQ-009): `maxHp`,
   * `maxStamina`, and `atk` all live here, so a level-up powers up attacks and
   * raises the hp/stamina caps. Optional while integration rolls in
   * incrementally — states that predate progression omit it, and the combat /
   * XP paths in {@link update} default a fresh level-1 progression.
   */
  progress?: Progression;
}

/**
 * A live enemy: pure `Enemy` stats/position paired with the per-enemy AI
 * bookkeeping the stepper carries between ticks (`entities.ts`). Two plain
 * objects so the whole thing stays serializable for save/load (TQ-012).
 */
export interface LiveEnemy {
  enemy: Enemy;
  ai: EnemyAi;
}

export interface GameState {
  world: World;
  player: Player;
  /**
   * Live enemies (TQ-005/006). Optional during incremental wiring — movement-only
   * states omit it. Each tick the simulation resolves attacks against them,
   * advances them toward the player, removes any whose `hp` has reached 0, and
   * converts the slain to player XP (TQ-009).
   */
  enemies?: readonly LiveEnemy[];
  /**
   * Bosses the player has defeated, of the {@link TOTAL_BOSSES} that are the win
   * condition (prd §7/F7). Optional during incremental wiring — the HUD reads
   * `0` until TQ-011 spawns bosses and makes this authoritative (TQ-008 wires the
   * field now so the HUD has a stable thing to display).
   */
  bossesDefeated?: number;
  /**
   * Set when the player tried to attack this tick but lacked the stamina — the
   * data behind the brief "too tired" cue. The HUD surfaces it (TQ-008); for now
   * it makes the stamina gate observable and testable.
   */
  tooTired: boolean;
  /** Monotonic simulation tick counter (set by the loop in TQ-002). */
  tick: number;
}

/**
 * A fresh player at `pos`: full hp/stamina drawn from a level-1 {@link
 * createProgression} (so the ceilings and the current values agree), no armour.
 */
export function createPlayer(pos: Vec2): Player {
  const progress = createProgression();
  return {
    pos: { x: pos.x, y: pos.y },
    hp: progress.maxHp,
    stamina: progress.maxStamina,
    def: 0,
    progress,
  };
}

/** Tile lookup that treats out-of-bounds as solid wall. */
export function tileAt(world: World, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 'wall';
  return world.tiles[y]![x]!;
}

export function isWalkable(world: World, x: number, y: number): boolean {
  return tileAt(world, x, y) === 'floor';
}
