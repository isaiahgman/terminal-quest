import { describe, it, expect } from 'vitest';
import { sampleWorld } from './sampleMap.js';

describe('sampleWorld', () => {
  it('matches the requested dimensions', () => {
    const world = sampleWorld(60, 30);
    expect(world.width).toBe(60);
    expect(world.height).toBe(30);
    expect(world.tiles.length).toBe(30);
    expect(world.tiles.every((row) => row.length === 60)).toBe(true);
  });

  it('walls every border tile', () => {
    const world = sampleWorld(80, 40);
    const { width, height, tiles } = world;
    for (let x = 0; x < width; x++) {
      expect(tiles[0]![x]).toBe('wall');
      expect(tiles[height - 1]![x]).toBe('wall');
    }
    for (let y = 0; y < height; y++) {
      expect(tiles[y]![0]).toBe('wall');
      expect(tiles[y]![width - 1]).toBe('wall');
    }
  });

  it('keeps the center spawn tile and its 8 neighbors walkable', () => {
    const world = sampleWorld(80, 40);
    const cx = Math.floor(world.width / 2);
    const cy = Math.floor(world.height / 2);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(world.tiles[cy + dy]![cx + dx]).toBe('floor');
      }
    }
  });

  it('generates at least one interior wall (pillars) for a default world', () => {
    const world = sampleWorld();
    const { width, height, tiles } = world;
    let interiorWalls = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (tiles[y]![x] === 'wall') interiorWalls++;
      }
    }
    expect(interiorWalls).toBeGreaterThan(0);
  });
});
