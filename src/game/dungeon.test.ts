import { describe, it, expect } from 'vitest';
import {
  DUNGEON_ENEMY_COUNT,
  DUNGEON_HEIGHT,
  DUNGEON_REWARD,
  DUNGEON_WIDTH,
  dungeonSeed,
  generateDungeon,
} from './dungeon.js';
import { isWalkable } from './state.js';
import { manhattan } from './spawn.js';

const WORLD_SEED = 0xc0ffee;
const ENTRANCE = { x: 42, y: 17 };

describe('dungeonSeed', () => {
  it('is deterministic and entrance-sensitive', () => {
    expect(dungeonSeed(WORLD_SEED, ENTRANCE)).toBe(
      dungeonSeed(WORLD_SEED, { x: 42, y: 17 }),
    );
    expect(dungeonSeed(WORLD_SEED, ENTRANCE)).not.toBe(
      dungeonSeed(WORLD_SEED, { x: 43, y: 17 }),
    );
    expect(dungeonSeed(WORLD_SEED, ENTRANCE)).not.toBe(
      dungeonSeed(WORLD_SEED + 1, ENTRANCE),
    );
  });

  it('always yields a 32-bit integer (generateWorld requires one)', () => {
    for (const e of [ENTRANCE, { x: 0, y: 0 }, { x: 9999, y: 9999 }]) {
      expect(Number.isInteger(dungeonSeed(WORLD_SEED, e))).toBe(true);
    }
  });
});

describe('generateDungeon', () => {
  const dungeon = generateDungeon(WORLD_SEED, ENTRANCE);

  it('reproduces byte-identically from the same world seed + entrance', () => {
    const again = generateDungeon(WORLD_SEED, ENTRANCE);
    expect(again.world.tiles).toEqual(dungeon.world.tiles);
    expect(again.spawn).toEqual(dungeon.spawn);
    expect(again.enemies.map(({ enemy }) => enemy.pos)).toEqual(
      dungeon.enemies.map(({ enemy }) => enemy.pos),
    );
    expect(again.pickups).toEqual(dungeon.pickups);
  });

  it('differs for a different entrance (each door its own dungeon)', () => {
    const other = generateDungeon(WORLD_SEED, { x: 5, y: 5 });
    expect(other.world.tiles).not.toEqual(dungeon.world.tiles);
  });

  it('is dungeon-sized with a walkable spawn tile', () => {
    expect(dungeon.world.width).toBe(DUNGEON_WIDTH);
    expect(dungeon.world.height).toBe(DUNGEON_HEIGHT);
    expect(isWalkable(dungeon.world, dungeon.spawn.x, dungeon.spawn.y)).toBe(
      true,
    );
  });

  it('packs the full dense swarm, all on walkable ground, none on the spawn', () => {
    expect(dungeon.enemies).toHaveLength(DUNGEON_ENEMY_COUNT);
    for (const { enemy } of dungeon.enemies) {
      expect(isWalkable(dungeon.world, enemy.pos.x, enemy.pos.y)).toBe(true);
      expect(enemy.pos).not.toEqual(dungeon.spawn);
    }
  });

  it('guarantees the reward, placed at the deepest walkable tile', () => {
    expect(dungeon.pickups).toHaveLength(1);
    const reward = dungeon.pickups[0]!;
    expect(reward.weaponId).toBe(DUNGEON_REWARD);
    expect(isWalkable(dungeon.world, reward.pos.x, reward.pos.y)).toBe(true);
    // Deepest: no walkable tile lies farther from the spawn than the reward.
    let deepest = 0;
    for (let y = 0; y < dungeon.world.height; y++) {
      for (let x = 0; x < dungeon.world.width; x++) {
        if (isWalkable(dungeon.world, x, y)) {
          deepest = Math.max(deepest, manhattan({ x, y }, dungeon.spawn));
        }
      }
    }
    expect(manhattan(reward.pos, dungeon.spawn)).toBe(deepest);
  });
});
