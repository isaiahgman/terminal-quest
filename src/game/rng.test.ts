import { describe, it, expect } from 'vitest';
import { Rng } from './rng.js';

describe('Rng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 100 }, () => a.nextFloat());
    const seqB = Array.from({ length: 100 }, () => b.nextFloat());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 20 }, () => a.nextFloat());
    const seqB = Array.from({ length: 20 }, () => b.nextFloat());
    expect(seqA).not.toEqual(seqB);
  });

  it('nextFloat stays within [0, 1)', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextInt stays within [0, maxExclusive)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextInt(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it('nextInt eventually covers every value in the range', () => {
    const rng = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      seen.add(rng.nextInt(4));
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });

  it('nextInt rejects non-positive or non-integer bounds', () => {
    const rng = new Rng(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-3)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
  });

  it('saving and restoring the state reproduces the stream', () => {
    const rng = new Rng(2024);
    // Advance the stream a few steps before snapshotting.
    rng.nextFloat();
    rng.nextFloat();

    const saved = rng.getState();
    const expected = Array.from({ length: 50 }, () => rng.nextFloat());

    // Restore into the same instance and replay.
    rng.setState(saved);
    const replayedSame = Array.from({ length: 50 }, () => rng.nextFloat());
    expect(replayedSame).toEqual(expected);

    // Restore into a fresh instance (the save-file path) and replay.
    const restored = new Rng(0);
    restored.setState(saved);
    const replayedFresh = Array.from({ length: 50 }, () =>
      restored.nextFloat(),
    );
    expect(replayedFresh).toEqual(expected);
  });

  it('getState returns an independent snapshot, not a live reference', () => {
    const rng = new Rng(1234);
    const snapshot = rng.getState();
    const snapshotCopy = [...snapshot];
    // Advancing the stream must not mutate an already-captured snapshot.
    rng.nextFloat();
    rng.nextFloat();
    expect(snapshot).toEqual(snapshotCopy);
  });

  it('pick returns an element of the array', () => {
    const rng = new Rng(5);
    const items = ['a', 'b', 'c', 'd'] as const;
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('pick is deterministic for a given seed', () => {
    const items = [10, 20, 30, 40, 50];
    const a = new Rng(808);
    const b = new Rng(808);
    const picksA = Array.from({ length: 30 }, () => a.pick(items));
    const picksB = Array.from({ length: 30 }, () => b.pick(items));
    expect(picksA).toEqual(picksB);
  });

  it('pick throws on an empty array', () => {
    const rng = new Rng(1);
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
