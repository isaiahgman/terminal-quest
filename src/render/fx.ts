/**
 * fx — the pure "juice" layer for hit feedback (prd §9, TQ-015): enemy hit
 * flashes, floating damage numbers, and a screen shake on big hits.
 *
 * Architecture bet (TDD §2): this is the *render* layer's data model, kept as a
 * pure, total, deterministic transform so it stays unit-testable exactly like
 * `combat.ts`/`progression.ts`. It owns NO terminal-kit, NO ScreenBuffer, and
 * NEVER touches game state — it only ingests transient "hit events" (plain data
 * the sim emits) and ages a small pool of effects over `dt`. A later, serialized
 * PR wires the *rendering* of these effects into the renderer; this PR is the
 * pure logic only.
 *
 * The model is a single immutable {@link FxState} advanced by {@link advanceFx}
 * and grown by {@link spawnHitFx}. Each effect carries a remaining lifetime in
 * seconds; `advanceFx` ages every effect and drops the expired ones, so effects
 * naturally age-out. The screen-shake offset is a *derived*, deterministic
 * function of the live shake effects (no RNG), so the same FxState always yields
 * the same offset — important for reproducible snapshot rendering.
 */

/** A 2-D integer-ish offset in world/screen cells. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * A transient "hit happened" event — the only input the sim feeds the fx layer.
 * Pure data: a world position, how much damage to show, and whether the hit was
 * "big" (high-damage / high-risk) and so should also kick off a screen shake.
 */
export interface HitEvent {
  /** Where the hit landed, in world cells. */
  pos: Vec2;
  /** Damage dealt — rendered as the floating number; also scales shake. */
  amount: number;
  /** True for high-damage / high-risk hits that should shake the screen. */
  big: boolean;
}

/** A brief flash/blink anchored to an enemy's cell. */
export interface FlashFx {
  readonly kind: 'flash';
  readonly pos: Vec2;
  /** Seconds of life left; ages to 0 then drops. */
  readonly remaining: number;
  /** Lifetime this effect started with — lets the renderer derive intensity. */
  readonly ttl: number;
}

/** A damage number that rises and fades from the hit location. */
export interface DamageNumberFx {
  readonly kind: 'damage';
  /** Spawn cell; the renderer offsets upward by elapsed fraction (see {@link riseOffset}). */
  readonly pos: Vec2;
  /** The number to draw. */
  readonly amount: number;
  readonly remaining: number;
  readonly ttl: number;
}

/** A screen-shake impulse; its magnitude decays with `remaining`. */
export interface ShakeFx {
  readonly kind: 'shake';
  /** Peak displacement in cells at spawn; scales down as it ages. */
  readonly magnitude: number;
  readonly remaining: number;
  readonly ttl: number;
}

export type Fx = FlashFx | DamageNumberFx | ShakeFx;

/** The whole effect pool — a single immutable value the renderer reads. */
export interface FxState {
  readonly effects: readonly Fx[];
}

/** Lifetimes (seconds) and tuning knobs. Tune the *feel* here. */
export const FLASH_TTL = 0.18;
export const DAMAGE_TTL = 0.7;
export const SHAKE_TTL = 0.22;

/** How far (cells) a damage number rises across its whole lifetime. */
const DAMAGE_RISE_CELLS = 2;

/** Peak shake displacement (cells) for a big hit. */
const SHAKE_MAGNITUDE = 1;

/**
 * Hard cap on concurrent effects (artifact: "Cap concurrent effects for
 * performance"). When spawning would exceed it, the OLDEST effects are dropped
 * so the newest, most relevant feedback always survives.
 */
export const MAX_EFFECTS = 64;

/** An empty effect pool — the renderer's starting fx state. */
export function createFx(): FxState {
  return { effects: [] };
}

/**
 * Spawn the effects for one batch of hit events, returning a NEW {@link FxState}
 * (the input is never mutated). Each event yields a flash + a damage number, and
 * a `big` event additionally yields a shake whose magnitude scales gently with
 * the damage shown. The pool is trimmed to {@link MAX_EFFECTS}, dropping the
 * oldest first.
 */
export function spawnHitFx(
  state: FxState,
  events: readonly HitEvent[],
): FxState {
  if (events.length === 0) return state;

  const spawned: Fx[] = [];
  for (const ev of events) {
    spawned.push({
      kind: 'flash',
      pos: { x: ev.pos.x, y: ev.pos.y },
      remaining: FLASH_TTL,
      ttl: FLASH_TTL,
    });
    spawned.push({
      kind: 'damage',
      pos: { x: ev.pos.x, y: ev.pos.y },
      amount: ev.amount,
      remaining: DAMAGE_TTL,
      ttl: DAMAGE_TTL,
    });
    if (ev.big) {
      spawned.push({
        kind: 'shake',
        // Bigger hits shake a touch harder, but cap so it never gets nauseating.
        magnitude:
          SHAKE_MAGNITUDE * Math.min(2, 1 + Math.max(0, ev.amount) / 20),
        remaining: SHAKE_TTL,
        ttl: SHAKE_TTL,
      });
    }
  }

  const combined = [...state.effects, ...spawned];
  // Drop the oldest (front of the array) when over the cap.
  const trimmed =
    combined.length > MAX_EFFECTS
      ? combined.slice(combined.length - MAX_EFFECTS)
      : combined;
  return { effects: trimmed };
}

/**
 * Age every effect by `dt` seconds and drop any that have expired, returning a
 * NEW {@link FxState}. Pure and total: a non-finite or non-positive `dt` is a
 * no-op (returns the input unchanged) rather than producing `NaN` lifetimes, so
 * a stalled or rewound clock can never corrupt the pool.
 */
export function advanceFx(state: FxState, dt: number): FxState {
  if (!Number.isFinite(dt) || dt <= 0) return state;

  const next: Fx[] = [];
  for (const fx of state.effects) {
    const remaining = fx.remaining - dt;
    if (remaining <= 0) continue;
    next.push({ ...fx, remaining });
  }
  // Nothing aged out and the array is identical in length — but we still return
  // a fresh object so callers can treat FxState as immutable without aliasing.
  return { effects: next };
}

/** Fraction of an effect's life already elapsed, in `[0, 1]`. */
export function elapsedFraction(fx: Fx): number {
  if (fx.ttl <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - fx.remaining / fx.ttl));
}

/**
 * How far (cells) a damage number has risen from its spawn cell, derived purely
 * from how much of its life has elapsed — so rendering needs no extra state.
 * Returns a non-negative number that grows toward {@link DAMAGE_RISE_CELLS}.
 */
export function riseOffset(fx: DamageNumberFx): number {
  return elapsedFraction(fx) * DAMAGE_RISE_CELLS;
}

/**
 * The current screen-shake offset derived from all live shake effects — a pure,
 * deterministic function of `state` (NO RNG), so the same FxState always yields
 * the same offset. Each shake contributes a decaying displacement whose x and y
 * directions alternate *independently* with its remaining lifetime (a cheap,
 * reproducible 2-D jitter — x and y flip on different quanta, so the kick is not
 * locked to a single diagonal); the strongest live shake dominates. With no live
 * shakes the offset is `{ x: 0, y: 0 }`.
 */
export function shakeOffset(state: FxState): Vec2 {
  let best: ShakeFx | undefined;
  for (const fx of state.effects) {
    if (fx.kind !== 'shake') continue;
    if (best === undefined || fx.remaining > best.remaining) best = fx;
  }
  if (best === undefined) return { x: 0, y: 0 };

  // Decay magnitude linearly with remaining life; round to whole cells so the
  // shake reads as a crisp 1-cell kick rather than sub-cell mush.
  const decayed = best.magnitude * (best.remaining / best.ttl);
  const amp = Math.round(decayed);
  if (amp <= 0) return { x: 0, y: 0 };

  // Deterministic alternating direction, derived from coarse quanta of elapsed
  // life (no RNG). x and y use *different* quanta (quarters vs. thirds) so their
  // signs flip out of step — the kick traces a real 2-D jitter rather than
  // sliding along the y=x diagonal.
  const elapsed = best.ttl - best.remaining;
  const xPhase = Math.floor(elapsed / (best.ttl / 4));
  const yPhase = Math.floor(elapsed / (best.ttl / 3));
  const xSign = xPhase % 2 === 0 ? 1 : -1;
  const ySign = yPhase % 2 === 0 ? 1 : -1;
  return { x: amp * xSign, y: amp * ySign };
}
