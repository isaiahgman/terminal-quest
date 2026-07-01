import { describe, it, expect } from 'vitest';
import { inBase, tileAt, isWalkable } from './state.js';
import type { HomeBase, Tile, World } from './state.js';
import { BASE_RADIUS_START } from './base.js';

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

  it('falls back to wall for NaN/fractional coords and a ragged tiles row', () => {
    const world = makeWorld();
    // NaN slips past every </>= comparison, so the nullish fallback (not the
    // bounds check) is what keeps these from throwing on tiles[NaN].
    expect(tileAt(world, NaN, 0)).toBe('wall');
    expect(tileAt(world, 0.5, 0)).toBe('wall');
    // An in-bounds index into a short/ragged row also degrades to wall.
    const ragged: World = { width: 2, height: 2, tiles: [['floor']], seed: 0 };
    expect(tileAt(ragged, 1, 0)).toBe('wall'); // tiles[0][1] is missing
    expect(tileAt(ragged, 0, 1)).toBe('wall'); // tiles[1] is missing
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

describe('inBase (TQ-013)', () => {
  const home: HomeBase = {
    pos: { x: 10, y: 10 },
    growth: { tier: 1, bossesDefeated: 0 },
  };

  it('contains the center and the full Chebyshev square out to the radius', () => {
    expect(inBase(home, 10, 10)).toBe(true);
    // Corners of the square are exactly radius away in both axes — inside.
    const r = BASE_RADIUS_START;
    expect(inBase(home, 10 + r, 10 + r)).toBe(true);
    expect(inBase(home, 10 - r, 10 - r)).toBe(true);
  });

  it('excludes the first ring past the radius', () => {
    const r = BASE_RADIUS_START;
    expect(inBase(home, 10 + r + 1, 10)).toBe(false);
    expect(inBase(home, 10, 10 - r - 1)).toBe(false);
  });

  it('widens with the tier (the visible growth)', () => {
    const grown: HomeBase = { ...home, growth: { tier: 2, bossesDefeated: 2 } };
    const justOutsideFresh = 10 + BASE_RADIUS_START + 1;
    expect(inBase(home, justOutsideFresh, 10)).toBe(false);
    expect(inBase(grown, justOutsideFresh, 10)).toBe(true);
  });
});
