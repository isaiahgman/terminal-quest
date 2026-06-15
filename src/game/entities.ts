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
 * same clock regardless of the loop's tick rate.
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
 * Per-enemy AI bookkeeping the stepper carries between ticks. Kept separate
 * from {@link Enemy} (pure stats/position data) so the model stays a
 * serializable leaf; the simulation owns one of these per live enemy.
 */
export interface EnemyAi {
  /**
   * Unspent fraction of a tile, in `[0, 1)`. Each tick adds `speed * dt` and
   * the enemy steps once per whole tile of accumulated budget, so sub-tile
   * speeds advance smoothly across ticks instead of being rounded away.
   */
  moveBudget: number;
  /**
   * Current behaviour, decided from the **pre-move** proximity each step:
   * `advance` while far (greedy budgeted steps toward the player, blocked by
   * walls), `charge` once within {@link CHARGE_RADIUS} — which both labels the
   * commit and drives a guaranteed one-tile lunge this tick (see
   * {@link stepEnemy}). Exposed so the renderer/HUD can react to a charging
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
 * slide here; charge's commitment is expressed as a guaranteed lunge in
 * {@link stepEnemy}, not by changing cell selection.
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
 * otherwise `advance`. The decision is made before moving so it can drive *this*
 * tick's motion rather than merely describe its outcome.
 *
 * Movement has two parts:
 * 1. **Budgeted stepping (both phases).** Banks `enemy.speed * dt` into the
 *    move budget, then spends whole tiles of budget stepping greedily toward
 *    the player — multiple cells in one tick for a fast enemy, none for a slow
 *    one whose budget hasn't reached 1 yet.
 * 2. **The charge lunge (charge phase only).** While charging, the enemy
 *    commits to a guaranteed single step toward the player this tick *even if*
 *    the budget hasn't reached a whole tile — so a slow brute that would
 *    otherwise just bank sub-tile budget instead presses in one tile per tick
 *    once you're in range. The lunge consumes up to one tile of budget but
 *    clamps at 0 (it never drives the budget negative); if budgeted stepping
 *    already moved this tick, the lunge is a no-op (no double-step).
 *
 * A non-finite or non-positive `dt` banks nothing, lunges not, and the enemy
 * holds station — the budget is never poisoned to `NaN` (which would freeze the
 * enemy forever, `NaN >= 1` being false). Pure: `enemy` and `ai` are never
 * mutated.
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

  const gained = live ? enemy.speed * dt : 0;
  let budget = ai.moveBudget + gained;
  let pos: Vec2 = { x: enemy.pos.x, y: enemy.pos.y };
  let stepped = false;

  // Spend whole tiles of budget, stepping toward the player each one. Stop
  // early if a step makes no progress (walled in) so the budget banks rather
  // than burning uselessly against a wall.
  while (budget >= 1) {
    const next = nextCell(pos, target, isWalkable);
    if (next.x === pos.x && next.y === pos.y) break;
    pos = next;
    budget -= 1;
    stepped = true;
    if (pos.x === target.x && pos.y === target.y) break;
  }

  // Charge lunge: when in range and alive this tick, guarantee one step even on
  // a sub-tile budget — but only if budgeted stepping didn't already move us
  // (no double-step) and the cell is actually reachable. Clamp the budget at 0
  // so the lunge can borrow at most a partial tile, never going negative.
  if (live && phase === 'charge' && !stepped) {
    const next = nextCell(pos, target, isWalkable);
    if (next.x !== pos.x || next.y !== pos.y) {
      pos = next;
      budget = Math.max(0, budget - 1);
    }
  }

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
 * sufficient here — stamina-gated, probabilistic combat lands in PR-006/007.
 */
export function contactDamage(enemy: Enemy, playerPos: Vec2): number {
  return chebyshev(enemy.pos, playerPos) <= 1 ? enemy.atk : 0;
}
