import { type Pickup, type Vec2, type World, isWalkable } from './state.js';
import { Rng } from './rng.js';
import { BOSS_ROSTER, type Boss, createBoss } from '../data/bosses.js';
import { WEAPONS, type WeaponId } from '../data/weapons.js';

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

/**
 * Manhattan distance — the cheap spacing metric used for boss placement.
 * Exported so the placement tests measure with the *same* metric the production
 * code spaces by (rather than a divergent copy).
 */
export function manhattan(a: Vec2, b: Vec2): number {
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
 * used — but every tier still excludes tiles already taken, so two bosses are
 * **never** placed on the same cell (no overlapping glyphs / 2-for-1 splash).
 * If no distinct tile remains, the world is too cramped to host the rest of the
 * roster and placement stops there rather than stacking. On a real (large) world
 * every roster boss lands, so kills can reach `TOTAL_BOSSES` and the run is
 * winnable; the cramped-world shortfall is a degenerate edge, not the live game.
 * Returns the placed bosses in roster order for the caller to add to `enemies[]`.
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
    const untaken = (t: Vec2): boolean =>
      taken.every((p) => manhattan(t, p) > 0);
    // Prefer tiles far from the player AND spaced from placed bosses; fall back
    // to merely-far, then anywhere walkable — but every tier excludes already-
    // taken cells so bosses never stack. (The spaced tier excludes taken tiles
    // implicitly, since distance 0 < BOSS_MIN_SEPARATION.)
    let pool = far.filter((t) =>
      taken.every((p) => manhattan(t, p) >= BOSS_MIN_SEPARATION),
    );
    if (pool.length === 0) pool = far.filter(untaken);
    if (pool.length === 0) pool = walkable.filter(untaken);
    if (pool.length === 0) break; // no distinct cell left — too cramped; stop.
    const pos = rng.pick(pool);
    taken.push(pos);
    placed.push(createBoss(spec, pos));
  }
  return placed;
}

/** The weapon ids that can drop in the world — the whole catalogue (`weapons.ts`). */
const WEAPON_IDS: readonly WeaponId[] = Object.keys(WEAPONS) as WeaponId[];

/** Minimum Manhattan distance a weapon pickup is placed from the player's spawn. */
export const WEAPON_MIN_PLAYER_DISTANCE = 6;

/**
 * Scatter `count` weapon pickups on walkable ground (TQ-010, prd §7/F6).
 * Deterministic from the injected {@link Rng} (seed it off the world seed, like
 * {@link pickSpawn}/{@link placeBosses}), so the same seed reproduces both the
 * map and where its loot lies. Each pickup draws a uniformly-random weapon from
 * the catalogue and a tile spaced from the player's spawn, so the run never opens
 * with a free weapon underfoot — the first pickup is something you walk to.
 *
 * Spacing **degrades gracefully**: when no tile is far enough (a small or cramped
 * world) the spacing filter is dropped and any walkable tile is used. Pickups may
 * share a tile with each other or an enemy (a one-slot pickup over a tile is
 * harmless — the latest stepped-onto wins), matching the swarm's loose placement;
 * tighter spacing is a later concern. Returns the placed pickups for the caller
 * to seed onto `pickups[]`.
 */
export function placeWeapons(
  world: World,
  player: Vec2,
  rng: Rng,
  count: number,
): Pickup[] {
  if (count <= 0 || WEAPON_IDS.length === 0) return [];

  const walkable: Vec2[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (isWalkable(world, x, y)) walkable.push({ x, y });
    }
  }
  if (walkable.length === 0) return [];

  // Prefer tiles away from the player so no weapon is underfoot at spawn; fall
  // back to anywhere walkable on a world too cramped to honour the spacing.
  const far = walkable.filter(
    (t) => manhattan(t, player) >= WEAPON_MIN_PLAYER_DISTANCE,
  );
  const pool = far.length > 0 ? far : walkable;

  const pickups: Pickup[] = [];
  for (let i = 0; i < count; i++) {
    pickups.push({ pos: rng.pick(pool), weaponId: rng.pick(WEAPON_IDS) });
  }
  return pickups;
}
