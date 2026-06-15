import { describe, it, expect } from 'vitest';
import { tileAt, isWalkable } from './state.js';
import type { Tile, World } from './state.js';

function makeWorld(): World {
  // 2x2 fixture: top row floors, bottom row walls.
  const F: Tile = 'floor';
  const W: Tile = 'wall';
  const tiles: Tile[][] = [
    [F, F],
    [W, W],
  ];
  return { width: 2, height: 2, tiles, seed: 0 };
}

describe('tileAt', () => {
  it('returns the in-bounds tile (floor and wall) from the fixture', () => {
    const world = makeWorld();
    expect(tileAt(world, 0, 0)).toBe('floor');
    expect(tileAt(world, 1, 0)).toBe('floor');
    expect(tileAt(world, 0, 1)).toBe('wall');
    expect(tileAt(world, 1, 1)).toBe('wall');
  });

  it('treats every out-of-bounds edge as a solid wall', () => {
    const world = makeWorld();
    // Each of the four boundary comparisons in state.ts, exercised directly.
    expect(tileAt(world, -1, 0)).toBe('wall'); // x < 0
    expect(tileAt(world, 0, -1)).toBe('wall'); // y < 0
    expect(tileAt(world, world.width, 0)).toBe('wall'); // x >= width
    expect(tileAt(world, 0, world.height)).toBe('wall'); // y >= height
  });
});

describe('isWalkable', () => {
  it('is true on a floor tile and false on a wall tile', () => {
    const world = makeWorld();
    expect(isWalkable(world, 0, 0)).toBe(true);
    expect(isWalkable(world, 0, 1)).toBe(false);
  });

  it('is false at every out-of-bounds edge', () => {
    const world = makeWorld();
    expect(isWalkable(world, -1, 0)).toBe(false); // x < 0
    expect(isWalkable(world, 0, -1)).toBe(false); // y < 0
    expect(isWalkable(world, world.width, 0)).toBe(false); // x >= width
    expect(isWalkable(world, 0, world.height)).toBe(false); // y >= height
  });
});
