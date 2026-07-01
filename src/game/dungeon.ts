/**
 * Dungeons — high-risk/high-reward pockets (TQ-014, prd §7/F10). A dungeon is
 * deliberately **not a new engine**: it is the same world generator, the same
 * enemies, the same combat and loot systems, run with tighter, meaner
 * parameters behind a context switch (the artifact's core constraint). This
 * module is the pure "content assembler": given the overworld seed and the
 * entrance stepped on, it deterministically builds the dungeon's world, its
 * denser swarm, and its guaranteed reward.
 *
 * Determinism: everything derives from {@link dungeonSeed} — the overworld
 * seed mixed with the entrance's coordinates — so the same entrance in the
 * same world always yields the same dungeon (and a *different* entrance yields
 * a different one). Re-entering re-generates it fresh: enemies respawn, the
 * same reward waits — consistent with the save doctrine that only the seed
 * persists ("resume the feel, not the frame").
 *
 * Purity contract (mirrors `spawn.ts`): no I/O, no `Math.random` — randomness
 * comes from a locally-seeded {@link Rng}. (`generateWorld` reseeds rot.js'
 * global RNG as a documented side effect of generation — deterministic, and
 * world gen is that RNG's only consumer.)
 */

import { type LiveEnemy, type Pickup, type Vec2, type World } from './state.js';
import { generateWorld } from './world/generate.js';
import { Rng } from './rng.js';
import { type SwarmKind, createEnemy } from './enemy.js';
import { createEnemyAi } from './entities.js';
import { manhattan, pickSpawn, walkableTiles } from './spawn.js';
import type { WeaponId } from '../data/weapons.js';

/**
 * Dungeon dimensions — a tight pocket, not a second overworld. Small enough
 * that the denser swarm is unavoidable, big enough to lose line of retreat.
 */
export const DUNGEON_WIDTH = 36;
export const DUNGEON_HEIGHT = 24;

/**
 * How many enemies a dungeon packs. The overworld seeds 8 into a world four
 * times this size — this is the "higher enemy density" lever (several times
 * the overworld's enemies-per-tile), tuned by playing like every balance knob.
 */
export const DUNGEON_ENEMY_COUNT = 14;

/**
 * The dungeon swarm mix, weighted mean: brutes twice as likely as the others.
 * Same kinds, same stats, no bespoke dungeon enemies — density and composition
 * are the risk, per the "tuned parameters, not a new engine" constraint.
 */
const DUNGEON_ENEMY_KINDS: readonly SwarmKind[] = [
  'brute',
  'brute',
  'runner',
  'grunt',
];

/** Keep dungeon enemies at least this far (Manhattan) from the entry tile. */
const DUNGEON_ENEMY_MIN_SPAWN_DISTANCE = 6;

/**
 * The guaranteed reward: the top of the weapon ladder (`weapons.ts`), waiting
 * at the deepest point. This is what makes the risk worth it (the artifact's
 * "a guaranteed good weapon drop makes dungeons worth the risk").
 */
export const DUNGEON_REWARD: WeaponId = 'warhammer';

/**
 * The seed a given entrance's dungeon generates from: the overworld seed mixed
 * with the entrance coordinates (distinct large primes per axis, folded to a
 * 32-bit integer for `generateWorld`). Same world + same entrance ⇒ same
 * dungeon; different entrances ⇒ different dungeons.
 */
export function dungeonSeed(worldSeed: number, entrance: Vec2): number {
  return (worldSeed ^ (entrance.x * 73856093) ^ (entrance.y * 19349663)) | 0;
}

/** Everything `update` needs to swap the player into a dungeon. */
export interface DungeonContext {
  readonly world: World;
  /** Where the player materialises — also the exit tile back to the overworld. */
  readonly spawn: Vec2;
  readonly enemies: readonly LiveEnemy[];
  /** The guaranteed reward, placed at the dungeon's deepest walkable tile. */
  readonly pickups: readonly Pickup[];
}

/**
 * Deterministically assemble the dungeon behind `entrance`: a seeded cavern,
 * a spawn/exit tile, a dense swarm kept off the player's entry, and the
 * guaranteed reward at the walkable tile *farthest* from the spawn — the
 * deeper you push, the better it gets, by construction.
 */
export function generateDungeon(
  worldSeed: number,
  entrance: Vec2,
): DungeonContext {
  const seed = dungeonSeed(worldSeed, entrance);
  const world = generateWorld(DUNGEON_WIDTH, DUNGEON_HEIGHT, seed);
  const rng = new Rng(seed);
  const spawn = pickSpawn(world, rng);

  const open = walkableTiles(world);
  // Swarm placement: prefer tiles a breath away from the entry so the run-in
  // isn't an instant pile-on; a cramped cavern degrades to any non-spawn tile
  // (the same graceful-degradation stance as the overworld placers).
  const far = open.filter(
    (t) => manhattan(t, spawn) >= DUNGEON_ENEMY_MIN_SPAWN_DISTANCE,
  );
  const offSpawn = open.filter((t) => t.x !== spawn.x || t.y !== spawn.y);
  const pool = far.length > 0 ? far : offSpawn;
  const enemies: LiveEnemy[] = [];
  if (pool.length > 0) {
    for (let i = 0; i < DUNGEON_ENEMY_COUNT; i++) {
      const kind =
        DUNGEON_ENEMY_KINDS[rng.nextInt(DUNGEON_ENEMY_KINDS.length)]!;
      enemies.push({
        enemy: createEnemy(kind, rng.pick(pool)),
        ai: createEnemyAi(),
      });
    }
  }

  // The reward sits at the deepest point — the walkable tile farthest
  // (Manhattan) from the spawn, ties resolved by scan order (deterministic).
  let deepest = spawn;
  let best = -1;
  for (const t of open) {
    const d = manhattan(t, spawn);
    if (d > best) {
      best = d;
      deepest = t;
    }
  }
  const pickups: Pickup[] =
    best > 0
      ? [{ pos: { x: deepest.x, y: deepest.y }, weaponId: DUNGEON_REWARD }]
      : [];

  return { world, spawn, enemies, pickups };
}
