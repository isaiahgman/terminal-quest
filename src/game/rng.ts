import { RNG } from 'rot-js';

/**
 * Deterministic seeded pseudo-random number generator.
 *
 * A thin wrapper over rot.js's `RNG` (an Alea generator), per TDD §4 — "wrap
 * rot.js RNG". The simulation must be reproducible from a seed (TDD §2, §9): the
 * same seed always yields the same stream, so saves can store the world seed
 * instead of the world, and combat/progression stay unit-testable. rot.js is
 * already the project's procedural-gen dependency, so reusing its generator keeps
 * the whole world derived from one RNG family instead of two. Never touches
 * `Math.random`.
 *
 * Each instance owns its own generator, cloned from the rot.js singleton so
 * instances never share global state, then re-seeded.
 */
export class Rng {
  /** This instance's own rot.js generator, independent of the global singleton. */
  private readonly rng = RNG.clone();

  constructor(seed: number) {
    // Coerce to an unsigned 32-bit integer so behaviour is identical regardless
    // of how the caller derived the seed (float, negative, etc.) and so integer
    // seeds bypass rot.js's `seed < 1 ? 1 / seed` reciprocal branch.
    this.rng.setSeed(seed >>> 0);
  }

  /**
   * Returns the generator's full internal state — persist this to restore the
   * exact stream mid-game. A save made mid-combat has already consumed part of
   * the stream, so the original seed alone would not reproduce it; the captured
   * state will. Pair with {@link setState}.
   */
  getState(): number[] {
    return this.rng.getState();
  }

  /** Restores a previously captured state so the stream continues from there. */
  setState(state: number[]): void {
    this.rng.setState(state);
  }

  /** Next float in the half-open interval [0, 1). */
  nextFloat(): number {
    return this.rng.getUniform();
  }

  /** Next integer in the half-open interval [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(
        `nextInt requires a positive integer bound, got ${maxExclusive}`,
      );
    }
    // getUniformInt's upper bound is inclusive, so map [0, maxExclusive) onto it.
    return this.rng.getUniformInt(0, maxExclusive - 1);
  }

  /** Picks a uniformly random element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('pick requires a non-empty array');
    }
    // rot.js `getItem` only reads the array; the cast bridges its mutable-array
    // parameter type. It returns null solely for an empty array (handled above),
    // and the explicit guard narrows `T | null` to `T` without an assertion.
    const item = this.rng.getItem(items as T[]);
    if (item === null) {
      throw new RangeError('pick requires a non-empty array');
    }
    return item;
  }
}
