import { describe, it, expect } from 'vitest';
import { generateWorld } from './generate.js';
import { isWalkable } from '../state.js';
import type { World } from '../state.js';

/**
 * Count floor tiles reachable from the first floor tile via 4-directional
 * movement. Independent of rot.js' own `connect()` so the test actually
 * verifies traversability rather than trusting the generator.
 */
function reachableFloorCount(world: World): number {
  let start: { x: number; y: number } | undefined;
  let totalFloor = 0;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (isWalkable(world, x, y)) {
        totalFloor++;
        start ??= { x, y };
      }
    }
  }
  if (!start) return 0;

  const seen = new Set<number>();
  const key = (x: number, y: number): number => y * world.width + x;
  const stack = [start];
  seen.add(key(start.x, start.y));
  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (isWalkable(world, nx, ny) && !seen.has(key(nx, ny))) {
        seen.add(key(nx, ny));
        stack.push({ x: nx, y: ny });
      }
    }
  }
  // Returned alongside total so the caller can assert "all floor reached".
  expect(seen.size).toBeLessThanOrEqual(totalFloor);
  return seen.size;
}

function totalFloorCount(world: World): number {
  let n = 0;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (isWalkable(world, x, y)) n++;
    }
  }
  return n;
}

describe('generateWorld', () => {
  it('is deterministic: same seed produces an identical map', () => {
    const a = generateWorld(100, 50, 12345);
    const b = generateWorld(100, 50, 12345);
    expect(a).toEqual(b);
    // Interleaving an unrelated generation must not perturb determinism, since
    // rot.js' RNG is global module state.
    generateWorld(64, 64, 999);
    const c = generateWorld(100, 50, 12345);
    expect(c).toEqual(a);
  });

  it('different seeds produce different maps', () => {
    const a = generateWorld(100, 50, 1);
    const b = generateWorld(100, 50, 2);
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it('has the exact requested dimensions', () => {
    const world = generateWorld(120, 60, 7);
    expect(world.width).toBe(120);
    expect(world.height).toBe(60);
    expect(world.seed).toBe(7);
    expect(world.tiles).toHaveLength(60);
    for (const row of world.tiles) {
      expect(row).toHaveLength(120);
    }
  });

  it('contains only valid tile values', () => {
    const world = generateWorld(80, 40, 42);
    for (const row of world.tiles) {
      for (const tile of row) {
        expect(tile === 'floor' || tile === 'wall').toBe(true);
      }
    }
  });

  it('is fully traversable: every floor tile is reachable (no isolated pockets)', () => {
    for (const seed of [0, 1, 42, 777, 12345, 99999]) {
      const world = generateWorld(100, 50, seed);
      const total = totalFloorCount(world);
      expect(total).toBeGreaterThan(0);
      expect(reachableFloorCount(world)).toBe(total);
    }
  });

  it('reads as "open with cover", not a maze', () => {
    const world = generateWorld(120, 60, 314);
    const floorRatio = totalFloorCount(world) / (world.width * world.height);
    expect(floorRatio).toBeGreaterThan(0.5);
    expect(floorRatio).toBeLessThan(0.95);
  });
});
