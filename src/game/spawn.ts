import { type Vec2, type World, isWalkable } from './state.js';
import { Rng } from './rng.js';
import { BOSS_ROSTER, type Boss, createBoss } from '../data/bosses.js';

/**
 * Pick a walkable spawn tile deterministically. Draws from the injected
 * {@link Rng} (seeded off the world seed) rather than the global rot.js RNG, so
 * the choice reproduces alongside the map — but only at a fixed world size: the
 * walkable-tile list comes from a map sized to the terminal, so the same seed in
 * a differently-sized terminal yields a different map and a different spawn.
 * TQ-012 resume must therefore persist the world width/height alongside the
 * seed, not the seed alone.
 * `generateWorld` guarantees at least one floor tile, so the list is non-empty.
 */
export function pickSpawn(world: World, rng: Rng): Vec2 {
  const walkable: Vec2[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (isWalkable(world, x, y)) walkable.push({ x, y });
    }
  }
  return rng.pick(walkable);
}

/** Manhattan distance — the cheap spacing metric used for boss placement. */
function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Minimum Manhattan distance a boss is placed from the player's spawn. */
export const BOSS_MIN_PLAYER_DISTANCE = 20;
/** Minimum Manhattan distance enforced between two placed bosses. */
export const BOSS_MIN_SEPARATION = 15;

/**
 * Place every boss in {@link BOSS_ROSTER} at a fixed, seeded world location.
 * Deterministic from the injected {@link Rng} (seed it off the world seed, like
 * {@link pickSpawn}); each boss is set well away from the player spawn and
 * spread apart from the others, so bosses are "hard to reach", not a swarm
 * (prd §7).
 *
 * Spacing is enforced greedily and **degrades gracefully**: when no tile meets
 * the distance constraints (a small or cramped world), the next-best pool is
 * used so a boss is still placed rather than dropped — every roster boss must
 * exist for victory to be reachable. Returns the placed bosses in roster order;
 * the caller wraps each as a live enemy and records the count as `bossesTotal`.
 */
export function placeBosses(world: World, player: Vec2, rng: Rng): Boss[] {
  const walkable: Vec2[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (isWalkable(world, x, y)) walkable.push({ x, y });
    }
  }
  if (walkable.length === 0) return [];

  const far = walkable.filter(
    (t) => manhattan(t, player) >= BOSS_MIN_PLAYER_DISTANCE,
  );

  const placed: Boss[] = [];
  const taken: Vec2[] = [];
  for (const spec of BOSS_ROSTER) {
    // Prefer tiles far from the player AND from already-placed bosses; fall back
    // to merely-far, then to anywhere walkable, so every boss gets a home.
    let pool = far.filter((t) =>
      taken.every((p) => manhattan(t, p) >= BOSS_MIN_SEPARATION),
    );
    if (pool.length === 0) pool = far;
    if (pool.length === 0) pool = walkable;
    const pos = rng.pick(pool);
    taken.push(pos);
    placed.push(createBoss(spec, pos));
  }
  return placed;
}
