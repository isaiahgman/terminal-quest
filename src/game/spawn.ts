import { type Vec2, type World, isWalkable } from './state.js';
import { Rng } from './rng.js';

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
