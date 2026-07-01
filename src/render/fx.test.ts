import { describe, it, expect } from 'vitest';
import {
  createFx,
  spawnHitFx,
  advanceFx,
  elapsedFraction,
  riseOffset,
  shakeOffset,
  FLASH_TTL,
  DAMAGE_TTL,
  SHAKE_TTL,
  MAX_EFFECTS,
  type Fx,
  type FxState,
  type HitEvent,
  type DamageNumberFx,
  type ShakeFx,
} from './fx.js';

const hit = (over: Partial<HitEvent> = {}): HitEvent => ({
  pos: { x: 5, y: 5 },
  amount: 10,
  big: false,
  ...over,
});

describe('createFx', () => {
  it('starts empty', () => {
    expect(createFx().effects).toEqual([]);
  });
});

describe('spawnHitFx', () => {
  it('is a no-op for no events and returns the same state', () => {
    const s = createFx();
    expect(spawnHitFx(s, [])).toBe(s);
  });

  it('spawns a flash and a damage number per non-big event', () => {
    const s = spawnHitFx(createFx(), [hit({ amount: 7 })]);
    const flash = s.effects.find((e) => e.kind === 'flash');
    const damage = s.effects.find((e) => e.kind === 'damage');
    expect(s.effects).toHaveLength(2);
    expect(flash).toMatchObject({ remaining: FLASH_TTL, ttl: FLASH_TTL });
    expect(damage).toMatchObject({
      amount: 7,
      remaining: DAMAGE_TTL,
      ttl: DAMAGE_TTL,
    });
    expect(s.effects.some((e) => e.kind === 'shake')).toBe(false);
  });

  it('adds a shake for a big hit', () => {
    const s = spawnHitFx(createFx(), [hit({ big: true })]);
    const shake = s.effects.find((e) => e.kind === 'shake');
    expect(shake).toMatchObject({ remaining: SHAKE_TTL, ttl: SHAKE_TTL });
    expect(shake?.kind === 'shake' && shake.magnitude).toBeGreaterThan(0);
  });

  it('scales big-hit shake magnitude with damage, capping and flooring it', () => {
    const mag = (amount: number): number => {
      const shake = spawnHitFx(createFx(), [
        hit({ big: true, amount }),
      ]).effects.find((e): e is ShakeFx => e.kind === 'shake');
      expect(shake).toBeDefined();
      return shake!.magnitude;
    };
    // The base magnitude (SHAKE_MAGNITUDE = 1) at amount 0; the 2x cap reached
    // at amount >= 20. These are the externally observable knobs.
    const base = mag(0);
    const cap = mag(20);
    // Grows with damage between floor and cap.
    expect(mag(5)).toBeGreaterThan(base);
    expect(mag(10)).toBeGreaterThan(mag(5));
    // Clamps at the cap (= 2 * base) for large amounts — does not keep growing.
    expect(mag(1000)).toBe(cap);
    expect(cap).toBeCloseTo(base * 2, 6);
    // Floors at the base for zero / negative damage (Math.max(0, amount)).
    expect(mag(-50)).toBe(base);
    expect(mag(0)).toBe(base);
  });

  it('does not mutate the input state', () => {
    const s = createFx();
    spawnHitFx(s, [hit()]);
    expect(s.effects).toEqual([]);
  });

  it('copies the event position rather than aliasing it', () => {
    const pos = { x: 3, y: 4 };
    const s = spawnHitFx(createFx(), [{ pos, amount: 1, big: false }]);
    pos.x = 99;
    const flash = s.effects.find((e) => e.kind === 'flash');
    expect(flash?.pos).toEqual({ x: 3, y: 4 });
  });

  it('caps concurrent effects at MAX_EFFECTS, dropping the oldest', () => {
    // Each event spawns 2 effects; overshoot the cap well past it.
    const events = Array.from({ length: MAX_EFFECTS }, (_, i) =>
      hit({ amount: i }),
    );
    const s = spawnHitFx(createFx(), events);
    expect(s.effects.length).toBe(MAX_EFFECTS);
    // The survivors are the NEWEST: the very first damage number (amount 0)
    // should have been dropped, the last (amount MAX_EFFECTS-1) kept.
    const amounts = s.effects
      .filter((e): e is DamageNumberFx => e.kind === 'damage')
      .map((e) => e.amount);
    expect(amounts).toContain(MAX_EFFECTS - 1);
    expect(amounts).not.toContain(0);
  });
});

describe('advanceFx', () => {
  it('ages effects down by dt', () => {
    const s = spawnHitFx(createFx(), [hit()]);
    const next = advanceFx(s, 0.05);
    for (const e of next.effects) {
      expect(e.remaining).toBeCloseTo(e.ttl - 0.05, 6);
    }
  });

  it('drops effects once their lifetime elapses', () => {
    const s = spawnHitFx(createFx(), [hit({ big: true })]);
    // Advance well past the longest TTL.
    const next = advanceFx(s, DAMAGE_TTL + 1);
    expect(next.effects).toEqual([]);
  });

  it('ages the short flash out before the long damage number', () => {
    const s = spawnHitFx(createFx(), [hit()]);
    // dt between FLASH_TTL and DAMAGE_TTL: flash gone, damage survives.
    const next = advanceFx(s, (FLASH_TTL + DAMAGE_TTL) / 2);
    expect(next.effects.some((e) => e.kind === 'flash')).toBe(false);
    expect(next.effects.some((e) => e.kind === 'damage')).toBe(true);
  });

  it('is a no-op for non-positive or non-finite dt', () => {
    const s = spawnHitFx(createFx(), [hit()]);
    expect(advanceFx(s, 0)).toBe(s);
    expect(advanceFx(s, -1)).toBe(s);
    expect(advanceFx(s, Number.NaN)).toBe(s);
    expect(advanceFx(s, Number.POSITIVE_INFINITY)).toBe(s);
  });

  it('does not mutate the input state', () => {
    const s = spawnHitFx(createFx(), [hit()]);
    const before = s.effects.map((e) => e.remaining);
    advanceFx(s, 0.1);
    expect(s.effects.map((e) => e.remaining)).toEqual(before);
  });

  it('is deterministic: identical inputs yield identical output', () => {
    const seed: FxState = spawnHitFx(createFx(), [
      hit({ big: true }),
      hit({ amount: 3 }),
    ]);
    const a = advanceFx(seed, 0.05);
    const b = advanceFx(seed, 0.05);
    expect(a).toEqual(b);
  });
});

describe('elapsedFraction', () => {
  it('is 0 at spawn and approaches 1 at end of life', () => {
    const [flash] = spawnHitFx(createFx(), [hit()]).effects;
    expect(flash && elapsedFraction(flash)).toBe(0);
    const aged = advanceFx(spawnHitFx(createFx(), [hit()]), FLASH_TTL * 0.5);
    const f = aged.effects.find((e) => e.kind === 'flash');
    expect(f && elapsedFraction(f)).toBeCloseTo(0.5, 6);
  });

  it('returns 1 for a zero-ttl effect rather than dividing by zero', () => {
    const degenerate: Fx = {
      kind: 'flash',
      pos: { x: 0, y: 0 },
      remaining: 0,
      ttl: 0,
    };
    expect(elapsedFraction(degenerate)).toBe(1);
  });
});

describe('riseOffset', () => {
  it('rises monotonically from 0 as the number ages', () => {
    const damage = spawnHitFx(createFx(), [hit()]).effects.find(
      (e): e is DamageNumberFx => e.kind === 'damage',
    );
    expect(damage).toBeDefined();
    const at0 = riseOffset(damage!);
    const later = advanceFx(spawnHitFx(createFx(), [hit()]), DAMAGE_TTL * 0.5)
      .effects.filter((e): e is DamageNumberFx => e.kind === 'damage')
      .map(riseOffset)[0];
    expect(at0).toBe(0);
    expect(later).toBeGreaterThan(at0);
  });
});

describe('shakeOffset', () => {
  it('is zero with no shake effects', () => {
    const s = spawnHitFx(createFx(), [hit()]); // no big hit -> no shake
    expect(shakeOffset(s)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(createFx())).toEqual({ x: 0, y: 0 });
  });

  it('is non-zero right after a big hit', () => {
    const s = spawnHitFx(createFx(), [hit({ big: true, amount: 40 })]);
    const off = shakeOffset(s);
    expect(Math.abs(off.x) + Math.abs(off.y)).toBeGreaterThan(0);
  });

  it('is deterministic for a given FxState', () => {
    const s = spawnHitFx(createFx(), [hit({ big: true })]);
    expect(shakeOffset(s)).toEqual(shakeOffset(s));
  });

  it('decays to zero as the shake ages out', () => {
    const s = spawnHitFx(createFx(), [hit({ big: true })]);
    const aged = advanceFx(s, SHAKE_TTL + 0.01);
    expect(shakeOffset(aged)).toEqual({ x: 0, y: 0 });
  });

  it('rounds the offset to zero while the shake is still live in the pool', () => {
    // Default big hit: magnitude = 1.5; the rounded amplitude reaches 0 once
    // remaining drops below ~1/3 of the ttl, well before the effect expires.
    const s = spawnHitFx(createFx(), [hit({ big: true })]);
    const aged = advanceFx(s, SHAKE_TTL * 0.7);
    // The shake is still in the pool (not yet aged out)...
    expect(aged.effects.some((e) => e.kind === 'shake')).toBe(true);
    // ...yet its rounded contribution is already zero.
    expect(shakeOffset(aged)).toEqual({ x: 0, y: 0 });
  });

  it('flips x and y independently as it ages (a real 2-D jitter, not a y=x slide)', () => {
    let s = spawnHitFx(createFx(), [hit({ big: true })]);
    const xs = new Set<number>();
    const ys = new Set<number>();
    const pairs: { x: number; y: number }[] = [];
    // Sample across the live window where the amplitude rounds to >= 1.
    for (let i = 0; i < 6; i++) {
      const off = shakeOffset(s);
      if (Math.abs(off.x) + Math.abs(off.y) > 0) {
        xs.add(Math.sign(off.x));
        ys.add(Math.sign(off.y));
        pairs.push(off);
      }
      s = advanceFx(s, SHAKE_TTL / 8);
    }
    // Both axes flip sign over the shake's life...
    expect(xs).toContain(1);
    expect(xs).toContain(-1);
    expect(ys).toContain(1);
    expect(ys).toContain(-1);
    // ...and at some sample x and y disagree, proving they are decoupled
    // rather than locked to the y=x diagonal.
    expect(pairs.some((p) => Math.sign(p.x) !== Math.sign(p.y))).toBe(true);
  });

  it('lets the strongest (freshest) live shake dominate', () => {
    // Older shake fades for a while, then a fresh big hit lands on top.
    let s = spawnHitFx(createFx(), [hit({ big: true })]);
    s = advanceFx(s, SHAKE_TTL * 0.5);
    s = spawnHitFx(s, [hit({ big: true })]);
    // Two shakes are present; the fresher one has the greater `remaining`.
    const shakes = s.effects.filter((e): e is ShakeFx => e.kind === 'shake');
    expect(shakes).toHaveLength(2);
    const freshest = shakes.reduce((a, b) =>
      b.remaining > a.remaining ? b : a,
    );
    // The derived offset must match the offset of a pool holding only the
    // freshest shake — i.e. the selection picked it, not the older fading one.
    const onlyFreshest: FxState = { effects: [freshest] };
    expect(shakeOffset(s)).toEqual(shakeOffset(onlyFreshest));
    // And it is the full-strength fresh kick, not the decayed older one.
    expect(shakeOffset(s)).not.toEqual({ x: 0, y: 0 });
  });
});
