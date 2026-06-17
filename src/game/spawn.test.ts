import { describe, it, expect } from 'vitest';
import { pickSpawn } from './spawn.js';
import { isWalkable } from './state.js';
import type { Tile, World } from './state.js';
import { Rng } from './rng.js';

/**
 * Hand-built 3×3 fixture with several known floor tiles, so the spawn-pick test
 * is isolated from world-gen behaviour: every walkable assertion is exact, and
 * there are enough floor tiles for distinct seeds to diverge.
 */
function makeWorld(): World {
  const F: Tile = 'floor';
  const W: Tile = 'wall';
  const tiles: Tile[][] = [
    [F, W, F],
    [W, F, W],
    [F, W, F],
  ];
  return { width: 3, height: 3, tiles, seed: 0 };
}

describe('pickSpawn', () => {
  it('always returns a floor tile', () => {
    const world = makeWorld();
    for (let seed = 0; seed < 50; seed++) {
      const spawn = pickSpawn(world, new Rng(seed));
      expect(isWalkable(world, spawn.x, spawn.y)).toBe(true);
    }
  });

  it('is deterministic: same seed yields the identical spawn', () => {
    const world = makeWorld();
    const a = pickSpawn(world, new Rng(12345));
    const b = pickSpawn(world, new Rng(12345));
    expect(a).toEqual(b);
  });

  it('varies: differing seeds yield differing spawns', () => {
    const world = makeWorld();
    // A single draw off the Alea stream scales roughly linearly with the seed,
    // so adjacent seeds (0, 1, 2, …) all land in the same bucket on a tiny
    // fixture; widely spaced seeds spread that single draw across the floor
    // tiles. Determinism is asserted strictly above; variation only loosely.
    const seeds = [...Array(20).keys()].map((i) => i * 1000);
    const spawns = seeds.map((seed) => pickSpawn(world, new Rng(seed)));
    const distinct = new Set(spawns.map((s) => `${s.x},${s.y}`));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
