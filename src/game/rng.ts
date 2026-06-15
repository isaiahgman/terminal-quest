import { RNG } from 'rot-js';

/**
 * Deterministic seeded pseudo-random number generator.
 *
 * A thin wrapper over rot.js's `RNG` (an Alea generator), per TDD §4 — "wrap
 * rot.js RNG". The simulation must be reproducible from a seed (TDD §2, §9): the
 * same seed always yields the same stream, so saves can store the world seed
 * instead of the world, and combat/progression stay unit-testable. Reuses rot.js
 * (already the project's procedural-gen dependency) rather than a second hand-rolled
 * PRNG. Never touches `Math.random`.
 *
 * Each instance owns its own generator, cloned from the rot.js singleton so
 * instances never share global state, then re-seeded. This is the INJECTED RNG
 * for sim logic (combat/progression). Note it does NOT seed rot.js's *global*
 * `ROT.RNG` singleton, which rot.js map generators (e.g. `ROT.Map.Cellular`) read
 * directly — so world gen (PR-004) must seed that global from the same world seed
 * separately to make "same seed → same world" hold.
 */
export class Rng {
  /** This instance's own rot.js generator, independent of the global singleton. */
  private readonly rng = RNG.clone();

  constructor(seed: number) {
    // Coerce to an unsigned 32-bit integer so behaviour is identical regardless
    // of how the caller derived the seed (float, negative, etc.). Every non-zero
    // result then skips rot.js's `seed < 1 ? 1 / seed` reciprocal branch; seed 0
    // is the lone exception (1 / 0 → Infinity → a valid but degenerate stream).
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
    // Index directly rather than via rot.js `getItem`: getItem returns `null`
    // for BOTH an empty array and a picked element that is itself `null`, so it
    // would corrupt `pick<T | null>`. The draw is identical to getItem's
    // (`Math.floor(getUniform() * length)`). The index is in [0, length) by
    // construction; `noUncheckedIndexedAccess` widens the element to `T | undefined`,
    // so assert the proven invariant rather than runtime-checking (which would
    // mishandle a legitimately stored `undefined`).
    return items[this.nextInt(items.length)] as T;
  }
}
