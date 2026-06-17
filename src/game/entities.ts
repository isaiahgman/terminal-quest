/**
 * Enemy AI stepping — the pressure that makes the game a game (prd §5/§6, F2):
 * enemies advance toward the player **on a clock, whether or not the player
 * moves**, and within a proximity threshold they stop pathing politely and
 * **charge straight in**. Stand still and the swarm closes the distance and
 * chips your hp down — "stand still and you die."
 *
 * This module is the pure-logic leaf the simulation will wire into `update()`
 * (the sequential integration step). It builds on the already-landed `Enemy`
 * data model (`enemy.ts`) and, like `combat.ts`, stays decoupled and fully
 * unit-testable: it takes the player target, a walkability predicate, and the
 * elapsed time as injected inputs rather than reaching into `GameState` or the
 * loop. The advance is **deterministic** — no `Math.random`, no I/O — so the
 * same inputs always produce the same motion (prd F2 acceptance).
 *
 * Speed is in tiles/second (matching `ENEMY_TYPES`); a per-enemy fractional
 * **move budget** accumulates `speed * dt` each tick and spends one whole tile
 * of budget per step, so a `speed: 8` runner outpaces a `speed: 2` brute on the
 * same clock regardless of the loop's tick rate. Within {@link CHARGE_RADIUS}
 * the fill rate is scaled by {@link CHARGE_SPEED_MULTIPLIER} — a faster
 * press-in that still respects each kind's relative speed.
 *
 * Purity contract: every function returns new objects and never mutates its
 * inputs (mirroring `combat.ts`).
 */

import type { Enemy } from './enemy.js';
import type { Vec2 } from './state.js';

/**
 * Chebyshev (king-move) distance, in tiles, at or within which an enemy drops
 * out of cautious advance and **charges** straight at the player. Chebyshev
 * (not Euclidean) so diagonal approach reads as "close" the same as orthogonal,
 * matching the 8-direction grid the enemies actually move on.
 */
export const CHARGE_RADIUS = 4;

/**
 * How much faster an enemy moves while charging vs. advancing: its tiles/sec
 * speed is multiplied by this inside {@link CHARGE_RADIUS}. A *multiplier* (not
 * a flat "one tile per tick") so the charge stays faster than the advance while
 * preserving each kind's relative speed and the budget's tick-rate independence
 * — a runner still out-charges a brute, and the pace doesn't change if the
 * sim's tick rate does (see TDD §12). One honest tuning knob: raise it for
 * scarier charges.
 */
export const CHARGE_SPEED_MULTIPLIER = 2;

/**
 * Per-enemy AI bookkeeping the stepper carries between ticks. Kept separate
 * from {@link Enemy} (pure stats/position data) so the model stays a
 * serializable leaf; the simulation owns one of these per live enemy.
 */
export interface EnemyAi {
  /**
   * Unspent fraction of a tile, normally in `[0, 1)`: each tick adds
   * `speed * dt` and the enemy steps once per whole tile of accumulated budget,
   * so sub-tile speeds advance smoothly across ticks instead of being rounded
   * away. Pinned at `1` (one step ready) when the enemy is blocked or already
   * on the player and can't spend it — capped there so a long block can't hoard
   * a multi-tile teleport.
   */
  moveBudget: number;
  /**
   * Current behaviour, decided from the **pre-move** proximity each step:
   * `advance` while far (greedy budgeted steps toward the player, blocked by
   * walls), `charge` once within {@link CHARGE_RADIUS} — which scales the move
   * budget's fill rate by {@link CHARGE_SPEED_MULTIPLIER} for a faster press-in
   * (see {@link stepEnemy}). Exposed so the renderer/HUD can react to a charging
   * swarm (prd §9 juice, later).
   */
  phase: 'advance' | 'charge';
}

/** A fresh AI state for a just-spawned enemy: no banked budget, advancing. */
export function createEnemyAi(): EnemyAi {
  return { moveBudget: 0, phase: 'advance' };
}

/** Chebyshev (king-move) distance in tiles between two grid cells. */
function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Sign of `n` as -1, 0, or 1 — the per-axis step toward a target. */
function step(n: number): number {
  return Math.sign(n);
}

/** One enemy after a step: its new position and updated AI bookkeeping. */
export interface EnemyStep {
  /** The enemy with `pos` advanced (a fresh object; input untouched). */
  enemy: Enemy;
  /** The AI state with budget spent and phase refreshed (fresh object). */
  ai: EnemyAi;
}

/**
 * Greedily pick the next cell toward `target` from `from`: try the full
 * diagonal/orthogonal step first, and if that cell is blocked, slide along
 * whichever single axis still closes distance — horizontal first, then
 * vertical — so a wall corner deflects an enemy along it instead of freezing
 * it. Returns `from` unchanged when already on the target or when no nearer
 * cell is walkable. Phase-agnostic: both `advance` and `charge` use the same
 * slide here; charge's extra pressure is expressed as a higher move-budget fill
 * rate in {@link stepEnemy}, not by changing cell selection.
 */
function nextCell(
  from: Vec2,
  target: Vec2,
  isWalkable: (x: number, y: number) => boolean,
): Vec2 {
  const dx = step(target.x - from.x);
  const dy = step(target.y - from.y);

  // Already on the target cell — nowhere closer to go.
  if (dx === 0 && dy === 0) return from;

  // Preferred move: the full diagonal/orthogonal step toward the player.
  if (isWalkable(from.x + dx, from.y + dy)) {
    return { x: from.x + dx, y: from.y + dy };
  }

  // Diagonal blocked: try sliding along whichever single axis still closes
  // distance (a horizontal-only or vertical-only step), horizontal first.
  if (dx !== 0 && isWalkable(from.x + dx, from.y)) {
    return { x: from.x + dx, y: from.y };
  }
  if (dy !== 0 && isWalkable(from.x, from.y + dy)) {
    return { x: from.x, y: from.y + dy };
  }

  return from;
}

/**
 * Advance one enemy by one tick of `dt` seconds toward `target`.
 *
 * The **phase** is decided up front from the enemy's **pre-move** Chebyshev
 * distance to `target`: `charge` if it is already within {@link CHARGE_RADIUS},
 * otherwise `advance`. Charging scales the move budget's fill rate by
 * {@link CHARGE_SPEED_MULTIPLIER}, so the phase drives *this* tick's motion
 * rather than merely labelling its outcome.
 *
 * Movement banks `speed * dt` (the charge multiplier folded into `speed`) into
 * the move budget, then spends whole tiles of budget stepping greedily toward
 * the player — multiple cells in one tick for a fast enemy, none for a slow one
 * whose budget hasn't reached 1 yet. Any leftover is clamped to at most one
 * ready step (`<= 1`): a blocked or already-arrived enemy that can't spend its
 * budget banks a single step, never a multi-tile hoard that would release as a
 * teleport the moment a path opens (the per-enemy twin of the loop's
 * spiral-of-death clamp; see DECISIONS.md / TDD §12).
 *
 * A non-finite or non-positive `dt` banks nothing and the enemy holds station —
 * the budget is never poisoned to `NaN` (which would freeze the enemy forever,
 * `NaN >= 1` being false). Pure: `enemy` and `ai` are never mutated.
 */
export function stepEnemy(
  enemy: Enemy,
  ai: EnemyAi,
  target: Vec2,
  isWalkable: (x: number, y: number) => boolean,
  dt: number,
): EnemyStep {
  const live = Number.isFinite(dt) && dt > 0;
  const phase: EnemyAi['phase'] =
    chebyshev(enemy.pos, target) <= CHARGE_RADIUS ? 'charge' : 'advance';

  // Charging fills the budget faster (a real, speed-respecting press-in)
  // instead of forcing a flat one-tile-per-tick lunge — see TDD §12.
  const speed =
    phase === 'charge' ? enemy.speed * CHARGE_SPEED_MULTIPLIER : enemy.speed;

  const gained = live ? speed * dt : 0;
  let budget = ai.moveBudget + gained;
  let pos: Vec2 = { x: enemy.pos.x, y: enemy.pos.y };

  // Spend whole tiles of budget, stepping toward the player each one. Stop
  // early if a step makes no progress (walled in, or already on the player) so
  // the budget banks rather than burning uselessly against a wall.
  while (budget >= 1) {
    const next = nextCell(pos, target, isWalkable);
    if (next.x === pos.x && next.y === pos.y) break;
    pos = next;
    budget -= 1;
    if (pos.x === target.x && pos.y === target.y) break;
  }

  // Clamp leftover budget to one ready step. A blocked or arrived enemy can't
  // spend it, so without this it would accumulate every tick and then dump the
  // whole hoard in a single frame when the path opens — a teleport. Capped, it
  // keeps exactly one step ready and no more.
  budget = Math.min(budget, 1);

  return {
    enemy: { ...enemy, pos },
    ai: { moveBudget: budget, phase },
  };
}

/**
 * Contact damage an enemy deals to the player this tick: its `atk` when it
 * occupies the player's cell or any of the 8 neighbours (Chebyshev distance
 * ≤ 1), otherwise 0. This is the "standing still gets you swarmed and chipped
 * down" pressure (prd §5); per the artifact, a flat per-tick contact hit is
 * sufficient here — stamina-gated, probabilistic combat lands in TQ-006/007.
 */
export function contactDamage(enemy: Enemy, playerPos: Vec2): number {
  return chebyshev(enemy.pos, playerPos) <= 1 ? enemy.atk : 0;
}
