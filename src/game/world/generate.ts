import { RNG, Map as RotMap } from 'rot-js';
import type { Tile, World } from '../state.js';

/**
 * Procedural world generation (TQ-004, [plan](../../../docs/plan/TQ-004-procedural-world.md)).
 *
 * A cellular-automaton cave is grown with rot.js, then `connect()` carves
 * tunnels so every open tile belongs to a single traversable region — "open
 * world with cover," not a maze. Generation is **deterministic from the seed**:
 * we seed rot.js' RNG up front so the same seed always reproduces a
 * byte-identical world (we save the seed, not the tiles — see CLAUDE.md /
 * TQ-012). Note this reseeds rot.js' *global* RNG as a side effect — fine while
 * generation is the only RNG consumer; TQ-004b's `rng.ts` wrapper will localize
 * it so the output is pure, not just deterministic.
 *
 * This module is render/input-agnostic and returns a fresh `World`: it only
 * reads the `World`/`Tile` shapes and never mutates its inputs.
 */

/**
 * rot.js Cellular cell values. The automaton stores `0` for empty space and `1`
 * for filled space; we treat empty as walkable floor and filled as wall (the
 * "cover" scattered through the open ground).
 */
const FLOOR_VALUE = 0;

/**
 * Fraction of cells seeded as open before smoothing. ~0.45 with the default
 * born/survive rules settles into ~70–75% floor: open, with scattered cover.
 */
const RANDOMIZE_PROBABILITY = 0.45;

/** Smoothing generations — enough to form coherent caverns without closing up. */
const SMOOTHING_PASSES = 4;

/**
 * Generate a fully-traversable world deterministically from `seed`.
 *
 * `width` and `height` must be positive integers; non-integer, zero, negative,
 * or non-finite dimensions throw (left unchecked, rot.js either crashes or — for
 * `Infinity` — loops unbounded and exhausts memory).
 *
 * `seed` must be an integer. rot.js maps any seed `< 1` through `1/seed` before
 * use, so non-integer seeds alias (`0`, `NaN`, and `Infinity` all collapse to
 * the same stream, and `s` collides with `1/s`). Requiring an integer keeps the
 * seed→world mapping injective for the values we actually save (TQ-012 resume).
 *
 * Guarantees (covered by tests): identical output for identical seed, every
 * `'floor'` tile reachable from every other (no isolated pockets), exact
 * `width`×`height` dimensions, and only valid `Tile` values.
 */
export function generateWorld(
  width: number,
  height: number,
  seed: number,
): World {
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new RangeError(
      `generateWorld: width and height must be positive integers, got ${width}×${height}`,
    );
  }
  if (!Number.isInteger(seed)) {
    throw new RangeError(`generateWorld: seed must be an integer, got ${seed}`);
  }

  RNG.setSeed(seed);

  const cellular = new RotMap.Cellular(width, height);
  cellular.randomize(RANDOMIZE_PROBABILITY);
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    cellular.create();
  }

  // Start solid; `connect()` reports the final, fully-linked map cell by cell,
  // so anything it does not mark as floor stays wall.
  const tiles: Tile[][] = Array.from({ length: height }, () =>
    new Array<Tile>(width).fill('wall'),
  );
  cellular.connect((x, y, value) => {
    tiles[y]![x] = value === FLOOR_VALUE ? 'floor' : 'wall';
  }, FLOOR_VALUE);

  return { width, height, tiles, seed };
}
