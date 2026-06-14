/**
 * Deterministic seeded pseudo-random number generator.
 *
 * The simulation must be reproducible from a seed (see TDD §2, §9): the same
 * seed always yields the same stream, so saves can store the world seed instead
 * of the world, and combat/progression are unit-testable. This is a `mulberry32`
 * generator — a fast, well-distributed 32-bit PRNG whose entire state is a single
 * integer, which makes save/restore trivial. It never touches `Math.random`.
 */
export class Rng {
  /**
   * The generator's mutable internal state. Advancing the stream mutates it,
   * so capturing it via {@link getSeed} and later restoring it with
   * {@link setSeed} resumes the exact same sequence — that is what lets a save
   * file replay the world deterministically.
   */
  private state: number;

  constructor(seed: number) {
    // Coerce to an unsigned 32-bit integer so behaviour is identical regardless
    // of how the caller derived the seed (float, negative, etc.).
    this.state = seed >>> 0;
  }

  /** Returns the current internal state — persist this to restore the stream. */
  getSeed(): number {
    return this.state;
  }

  /** Restores a previously captured state so the stream continues from there. */
  setSeed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** Next float in the half-open interval [0, 1). */
  nextFloat(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next integer in the half-open interval [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(
        `nextInt requires a positive integer bound, got ${maxExclusive}`,
      );
    }
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  /** Picks a uniformly random element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('pick requires a non-empty array');
    }
    const index = this.nextInt(items.length);
    // Safe: index is in [0, length) by construction, but `noUncheckedIndexedAccess`
    // widens the element type to `T | undefined`, so assert the proven invariant.
    return items[index] as T;
  }
}
