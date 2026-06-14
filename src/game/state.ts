/**
 * Core game state. This is the single source of truth the simulation advances
 * and the renderer reads. Keep it plain data (serializable) — no methods, no
 * class instances — so save/load is trivial later (PR-012).
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type Tile = 'floor' | 'wall';

export interface World {
  readonly width: number;
  readonly height: number;
  /** Row-major: tiles[y][x]. */
  readonly tiles: Tile[][];
  readonly seed: number;
}

export interface Player {
  pos: Vec2;
}

export interface GameState {
  world: World;
  player: Player;
  /** Monotonic simulation tick counter (set by the loop in PR-002). */
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
