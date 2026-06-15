import { describe, it, expect } from 'vitest';
import { generateWorld } from './generate.js';
import { isWalkable } from '../state.js';
import type { World } from '../state.js';

function firstFloor(world: World): { x: number; y: number } | undefined {
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (isWalkable(world, x, y)) return { x, y };
    }
  }
  return undefined;
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

/**
 * Count floor tiles reachable from the first floor tile via 4-directional
 * movement. Independent of rot.js' own `connect()` so the test actually
 * verifies traversability rather than trusting the generator. Compared against
 * {@link totalFloorCount} by the caller to assert every floor tile is reached.
 */
function reachableFloorCount(world: World): number {
  const start = firstFloor(world);
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
  return seen.size;
}

describe('generateWorld', () => {
  // Seed 0 is included deliberately: rot.js' RNG transforms any seed `< 1`, so a
  // falsy-seed regression (e.g. `setSeed(seed || fallback)`) would corrupt
  // reproducibility for seed 0 specifically — the value the save system is most
  // likely to hit — while leaving a truthy seed like 12345 green.
  it.each([0, 1, 12345])(
    'is deterministic: seed %i produces an identical map',
    (seed) => {
      const a = generateWorld(100, 50, seed);
      const b = generateWorld(100, 50, seed);
      expect(b).toEqual(a);
      // A fresh World each call — distinct array instances, not an aliased
      // reference (the docstring promises a non-shared return).
      expect(b.tiles).not.toBe(a.tiles);
      // Interleaving an unrelated generation must not perturb determinism, since
      // rot.js' RNG is global module state.
      generateWorld(64, 64, 999);
      const c = generateWorld(100, 50, seed);
      expect(c).toEqual(a);
    },
  );

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
        expect(['floor', 'wall']).toContain(tile);
      }
    }
  });

  it('is fully traversable with cover: all floor reachable, walls present (no isolated pockets, not all-floor)', () => {
    for (const seed of [0, 1, 42, 777, 12345, 99999]) {
      const world = generateWorld(100, 50, seed);
      const total = totalFloorCount(world);
      const walls = world.width * world.height - total;
      expect(total).toBeGreaterThan(0);
      // Walls must actually exist — guards against an "all-floor / cover-gone"
      // regression that the density band alone wouldn't catch.
      expect(walls).toBeGreaterThan(0);
      expect(reachableFloorCount(world)).toBe(total);
    }
  });

  it('reads as "open with cover", not a maze (density brackets the documented ~70–75%)', () => {
    const seeds = [0, 1, 42, 777, 12345, 99999];
    const ratios = seeds.map((seed) => {
      const world = generateWorld(100, 50, seed);
      return totalFloorCount(world) / (world.width * world.height);
    });
    // Tight enough to trip a real density regression (a 0.55 maze or a 0.94
    // near-all-floor both fail), loose enough to absorb per-seed variation.
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(0.65);
      expect(ratio).toBeLessThan(0.82);
    }
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(mean).toBeGreaterThan(0.7);
    expect(mean).toBeLessThan(0.8);
  });

  it('rejects degenerate dimensions instead of crashing rot.js', () => {
    // Left unchecked these throw opaque rot.js errors, or (Infinity) loop
    // unbounded and exhaust memory. The guard turns them into a clear error.
    for (const [w, h] of [
      [0, 10],
      [10, 0],
      [-5, 10],
      [100.5, 50],
      [10, 10.9],
      [Infinity, 10],
      [10, NaN],
    ] as const) {
      expect(() => generateWorld(w, h, 1)).toThrow(RangeError);
    }
  });

  it('rejects non-integer seeds that would silently alias', () => {
    // rot.js maps any seed `< 1` through `1/seed`, so these alias each other
    // (and 0/NaN/Infinity collapse to one stream). Reject them up front so the
    // saved-seed → world mapping stays injective.
    for (const seed of [1.5, -0.5, NaN, Infinity, -Infinity]) {
      expect(() => generateWorld(100, 50, seed)).toThrow(RangeError);
    }
    // Integer seeds — including 0 and negatives — remain valid.
    for (const seed of [0, -7, 12345]) {
      expect(() => generateWorld(20, 20, seed)).not.toThrow();
    }
  });
});
