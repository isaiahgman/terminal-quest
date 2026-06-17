/**
 * Core game state. This is the single source of truth the simulation advances
 * and the renderer reads. Keep it plain data (serializable) — no methods, no
 * class instances — so save/load is trivial later (TQ-012).
 */

import type { Enemy } from './enemy.js';
import type { Progression } from './progression.js';

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
  /**
   * Leveling state and the stat ceilings it raises (TQ-009). Optional while the
   * combat/loop integration rolls in incrementally: states that predate
   * progression simply omit it, and {@link update} defaults a fresh level-1
   * progression the first time XP is awarded.
   */
  progress?: Progression;
}

export interface GameState {
  world: World;
  player: Player;
  /**
   * Live enemies (TQ-005/006). Optional during incremental wiring — movement-only
   * states omit it. The simulation removes any whose `hp` has reached 0 and
   * converts them to player XP (TQ-009).
   */
  enemies?: readonly Enemy[];
  /** Monotonic simulation tick counter (set by the loop in TQ-002). */
  tick: number;
}

/** Tile lookup that treats out-of-bounds as solid wall. */
export function tileAt(world: World, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 'wall';
  return world.tiles[y]![x]!;
}

export function isWalkable(world: World, x: number, y: number): boolean {
  return tileAt(world, x, y) === 'floor';
}
