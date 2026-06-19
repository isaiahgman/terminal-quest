import { describe, it, expect } from 'vitest';
import {
  pickSpawn,
  placeBosses,
  walkableTiles,
  manhattan,
  BOSS_MIN_PLAYER_DISTANCE,
  BOSS_MIN_SEPARATION,
} from './spawn.js';
import { isWalkable } from './state.js';
import type { Tile, World } from './state.js';
import { Rng } from './rng.js';
import { BOSS_ROSTER } from '../data/bosses.js';

/** A fully-open square floor — plenty of room for spaced boss placement. */
function openWorld(size: number): World {
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, (): Tile => 'floor'),
  );
  return { width: size, height: size, tiles, seed: 0 };
}

/** An all-wall square — no walkable ground at all. */
function wallWorld(size: number): World {
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, (): Tile => 'wall'),
  );
  return { width: size, height: size, tiles, seed: 0 };
}

/** Distinct-cell count for a set of placed bosses. */
function distinctCells(
  bosses: readonly { pos: { x: number; y: number } }[],
): number {
  return new Set(bosses.map((b) => `${b.pos.x},${b.pos.y}`)).size;
}

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

describe('walkableTiles', () => {
  it('returns exactly the floor cells in row-major order', () => {
    // makeWorld's floors are the 4 corners + the centre of a 3×3 checkerboard.
    expect(walkableTiles(makeWorld())).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
    ]);
  });

  it('is empty when there is no floor', () => {
    expect(walkableTiles(wallWorld(4))).toEqual([]);
  });
});

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

describe('placeBosses', () => {
  const player = { x: 0, y: 0 };

  it('places one boss per roster entry on walkable ground', () => {
    const world = openWorld(60);
    const bosses = placeBosses(world, player, new Rng(7));
    expect(bosses).toHaveLength(BOSS_ROSTER.length);
    for (const boss of bosses) {
      expect(isWalkable(world, boss.pos.x, boss.pos.y)).toBe(true);
      expect(boss.kind).toBe('boss');
    }
  });

  it('keeps every boss far from the player spawn', () => {
    const world = openWorld(60);
    const bosses = placeBosses(world, player, new Rng(7));
    for (const boss of bosses) {
      expect(manhattan(boss.pos, player)).toBeGreaterThanOrEqual(
        BOSS_MIN_PLAYER_DISTANCE,
      );
    }
  });

  it('spreads bosses apart from one another', () => {
    const world = openWorld(60);
    const bosses = placeBosses(world, player, new Rng(7));
    for (let i = 0; i < bosses.length; i++) {
      for (let j = i + 1; j < bosses.length; j++) {
        expect(
          manhattan(bosses[i]!.pos, bosses[j]!.pos),
        ).toBeGreaterThanOrEqual(BOSS_MIN_SEPARATION);
      }
    }
  });

  it('is deterministic and places one boss per roster entry, in order', () => {
    const world = openWorld(60);
    const a = placeBosses(world, player, new Rng(123));
    const b = placeBosses(world, player, new Rng(123));
    expect(a.map((boss) => boss.pos)).toEqual(b.map((boss) => boss.pos));
    // Order matters: the HUD count and victory rely on roster-ordered placement,
    // so a stable-position-but-scrambled-order regression must still fail here.
    expect(a.map((boss) => boss.id)).toEqual(
      BOSS_ROSTER.map((spec) => spec.id),
    );
  });

  it('still places every boss on distinct walkable tiles when the world is too cramped to space them', () => {
    // 5×5: max Manhattan distance (8) is below both the player-distance and the
    // separation floors, so all three fallback tiers are exercised — yet every
    // boss must still land, on its own cell (no stacking).
    const world = openWorld(5);
    const bosses = placeBosses(world, { x: 2, y: 2 }, new Rng(3));
    expect(bosses).toHaveLength(BOSS_ROSTER.length);
    expect(distinctCells(bosses)).toBe(bosses.length);
    for (const boss of bosses) {
      expect(isWalkable(world, boss.pos.x, boss.pos.y)).toBe(true);
    }
  });

  it('never stacks two bosses on the same cell even when only one tile is free', () => {
    // A lone walkable cell in an otherwise solid world: only one boss can be
    // placed distinctly; the rest are dropped rather than stacked on it.
    const tiles: Tile[][] = Array.from({ length: 5 }, (): Tile[] =>
      Array.from({ length: 5 }, (): Tile => 'wall'),
    );
    tiles[2]![2] = 'floor';
    const world: World = { width: 5, height: 5, tiles, seed: 0 };
    const bosses = placeBosses(world, { x: 0, y: 0 }, new Rng(9));
    expect(bosses).toHaveLength(1);
    expect(bosses[0]!.pos).toEqual({ x: 2, y: 2 });
  });

  it('returns no bosses when the world has no walkable ground', () => {
    expect(placeBosses(wallWorld(5), { x: 0, y: 0 }, new Rng(1))).toEqual([]);
  });
});
