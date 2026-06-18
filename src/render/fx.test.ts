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
  type FxState,
  type HitEvent,
  type DamageNumberFx,
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
});
