import { describe, it, expect } from 'vitest';
import {
  CHARGE_RADIUS,
  contactDamage,
  createEnemyAi,
  stepEnemy,
} from './entities.js';
import { createEnemy } from './enemy.js';
import type { Vec2 } from './state.js';

/** Walkable-everywhere predicate — the open-field default for movement tests. */
const open = (): boolean => true;

/** One tick of the 15 Hz sim loop, in seconds (matches SIM_DT = 1000 / 15). */
const TICK = 1 / 15;

describe('stepEnemy — advancing toward the player on a clock', () => {
  it('moves toward the player even with zero player input', () => {
    // Player is fixed; the enemy must still close the distance on its own.
    const enemy = createEnemy('grunt', { x: 0, y: 0 });
    const player: Vec2 = { x: 20, y: 0 };

    const { enemy: moved } = stepEnemy(enemy, createEnemyAi(), player, open, 1);
    // grunt speed 4 → ~4 tiles in a full second of budget.
    expect(moved.pos.x).toBeGreaterThan(enemy.pos.x);
  });

  it('steps diagonally — closes both axes toward the player', () => {
    const enemy = createEnemy('grunt', { x: 0, y: 0 });
    const player: Vec2 = { x: 20, y: 20 };
    const { enemy: moved } = stepEnemy(enemy, createEnemyAi(), player, open, 1);
    expect(moved.pos.x).toBeGreaterThan(0);
    expect(moved.pos.y).toBeGreaterThan(0);
    expect(moved.pos.x).toBe(moved.pos.y); // perfect diagonal toward (20,20)
  });

  it('a faster enemy outpaces a slower one over the same dt', () => {
    const player: Vec2 = { x: 50, y: 0 };
    const ai = createEnemyAi();
    const runner = stepEnemy(
      createEnemy('runner', { x: 0, y: 0 }),
      ai,
      player,
      open,
      1,
    ); // speed 8
    const brute = stepEnemy(
      createEnemy('brute', { x: 0, y: 0 }),
      ai,
      player,
      open,
      1,
    ); // speed 2
    expect(runner.enemy.pos.x).toBeGreaterThan(brute.enemy.pos.x);
  });

  it('banks sub-tile budget across ticks instead of rounding it away', () => {
    // brute speed 2 over one 15 Hz tick = 0.133 tiles < 1 → no move, but banked.
    const enemy = createEnemy('brute', { x: 0, y: 0 });
    const player: Vec2 = { x: 20, y: 0 };
    const first = stepEnemy(enemy, createEnemyAi(), player, open, TICK);
    expect(first.enemy.pos).toEqual({ x: 0, y: 0 }); // not enough budget yet
    expect(first.ai.moveBudget).toBeGreaterThan(0);

    // Keep ticking; the banked budget must eventually produce a step.
    let ai = first.ai;
    let pos = first.enemy.pos;
    let moved = false;
    for (let i = 0; i < 30 && !moved; i++) {
      const next = stepEnemy({ ...enemy, pos }, ai, player, open, TICK);
      moved = next.enemy.pos.x > pos.x;
      ai = next.ai;
      pos = next.enemy.pos;
    }
    expect(moved).toBe(true);
  });

  it('takes multiple steps in one tick when budget exceeds one tile', () => {
    // grunt speed 4 over a full second → ~4 tiles in a single call.
    const enemy = createEnemy('grunt', { x: 0, y: 0 });
    const { enemy: moved } = stepEnemy(
      enemy,
      createEnemyAi(),
      { x: 20, y: 0 },
      open,
      1,
    );
    expect(moved.pos.x).toBe(4);
  });
});

describe('stepEnemy — charge within the proximity threshold', () => {
  it('switches to charge once inside CHARGE_RADIUS of the player', () => {
    const enemy = createEnemy('grunt', { x: CHARGE_RADIUS, y: 0 });
    const { ai } = stepEnemy(enemy, createEnemyAi(), { x: 0, y: 0 }, open, 0);
    expect(ai.phase).toBe('charge');
  });

  it('stays in advance while still far from the player', () => {
    const enemy = createEnemy('grunt', { x: CHARGE_RADIUS + 5, y: 0 });
    const { ai } = stepEnemy(enemy, createEnemyAi(), { x: 0, y: 0 }, open, 0);
    expect(ai.phase).toBe('advance');
  });

  it('lunges one tile on a sub-tile budget when charging, but banks when far', () => {
    // brute speed 2 over one 15 Hz tick banks only ~0.133 tiles — well under a
    // whole tile — so without the lunge it would not move at all this tick.
    const player: Vec2 = { x: 0, y: 0 };

    // In charge range (pre-move Chebyshev dist = CHARGE_RADIUS): it must press
    // in by a full tile in this single tick despite the sub-tile budget.
    const near = createEnemy('brute', { x: CHARGE_RADIUS, y: 0 });
    const lunged = stepEnemy(near, createEnemyAi(), player, open, TICK);
    expect(lunged.ai.phase).toBe('charge');
    expect(lunged.enemy.pos.x).toBe(CHARGE_RADIUS - 1); // moved one tile in
    expect(lunged.ai.moveBudget).toBe(0); // lunge clamps the budget, never negative

    // Beyond charge range with the same sub-tile budget: it advances, so it
    // banks this tick and does NOT move — contrasting the two phases.
    const far = createEnemy('brute', { x: CHARGE_RADIUS + 1, y: 0 });
    const banked = stepEnemy(far, createEnemyAi(), player, open, TICK);
    expect(banked.ai.phase).toBe('advance');
    expect(banked.enemy.pos).toEqual({ x: CHARGE_RADIUS + 1, y: 0 }); // held station
    expect(banked.ai.moveBudget).toBeGreaterThan(0); // budget banked for later
  });
});

describe('stepEnemy — walls and walkability', () => {
  it('does not walk through a wall directly between it and the player', () => {
    // Wall is the entire column x === 1; the enemy at x:0 cannot pass to x:2.
    const blocked = (x: number): boolean => x !== 1;
    const enemy = createEnemy('grunt', { x: 0, y: 0 });
    const { enemy: moved } = stepEnemy(
      enemy,
      createEnemyAi(),
      { x: 5, y: 0 },
      blocked,
      1,
    );
    expect(moved.pos.x).toBeLessThan(1);
  });

  it('slides along a wall toward the player instead of freezing', () => {
    // Diagonal blocked at (1,1) but the vertical axis is open → slide on y.
    const isWalkable = (x: number, y: number): boolean => !(x === 1 && y === 1);
    const enemy = createEnemy('grunt', { x: 0, y: 0 });
    const { enemy: moved } = stepEnemy(
      enemy,
      createEnemyAi(),
      { x: 5, y: 5 },
      isWalkable,
      1,
    );
    expect(moved.pos).not.toEqual({ x: 0, y: 0 });
  });
});

describe('stepEnemy — determinism & purity', () => {
  it('is deterministic — identical inputs yield identical motion', () => {
    const enemy = createEnemy('runner', { x: 2, y: 9 });
    const player: Vec2 = { x: 40, y: 3 };
    const a = stepEnemy(enemy, createEnemyAi(), player, open, TICK * 7);
    const b = stepEnemy(enemy, createEnemyAi(), player, open, TICK * 7);
    expect(a).toEqual(b);
  });

  it('does not mutate the input enemy or AI state', () => {
    const enemy = createEnemy('grunt', { x: 0, y: 0 });
    const ai = createEnemyAi();
    stepEnemy(enemy, ai, { x: 9, y: 9 }, open, 1);
    expect(enemy.pos).toEqual({ x: 0, y: 0 });
    expect(ai).toEqual({ moveBudget: 0, phase: 'advance' });
  });

  it('holds station and banks nothing on a non-finite or non-positive dt', () => {
    const enemy = createEnemy('grunt', { x: 3, y: 3 });
    const ai = createEnemyAi();
    for (const dt of [0, -1, NaN, Infinity]) {
      const out = stepEnemy(enemy, ai, { x: 0, y: 0 }, open, dt);
      expect(out.enemy.pos).toEqual({ x: 3, y: 3 });
      expect(out.ai.moveBudget).toBe(0);
    }
  });
});

describe('contactDamage — standing still gets you chipped down', () => {
  it('deals the enemy atk when adjacent to the player', () => {
    const enemy = createEnemy('grunt', { x: 1, y: 0 });
    expect(contactDamage(enemy, { x: 0, y: 0 })).toBe(enemy.atk);
  });

  it('deals atk diagonally adjacent too (8-neighbourhood)', () => {
    const enemy = createEnemy('grunt', { x: 1, y: 1 });
    expect(contactDamage(enemy, { x: 0, y: 0 })).toBe(enemy.atk);
  });

  it('deals atk when occupying the player cell', () => {
    const enemy = createEnemy('brute', { x: 4, y: 4 });
    expect(contactDamage(enemy, { x: 4, y: 4 })).toBe(enemy.atk);
  });

  it('deals nothing when more than one tile away', () => {
    const enemy = createEnemy('grunt', { x: 2, y: 0 });
    expect(contactDamage(enemy, { x: 0, y: 0 })).toBe(0);
  });
});
