import { describe, it, expect } from 'vitest';
import { update } from './update.js';
import { createEnemy } from './enemy.js';
import { createProgression, xpForKill, xpToNext } from './progression.js';
import type { Enemy } from './enemy.js';
import type { GameState, Tile } from './state.js';

function makeState(): GameState {
  // 3x3 with a plus-shaped floor; corners are walls.
  const F: Tile = 'floor';
  const W: Tile = 'wall';
  const tiles: Tile[][] = [
    [W, F, W],
    [F, F, F],
    [W, F, W],
  ];
  return {
    world: { width: 3, height: 3, tiles, seed: 0 },
    player: { pos: { x: 1, y: 1 } },
    tick: 0,
  };
}

describe('update', () => {
  it('moves the player onto a floor tile', () => {
    const next = update(makeState(), [{ type: 'move', dx: 1, dy: 0 }]);
    expect(next.player.pos).toEqual({ x: 2, y: 1 });
  });

  it('blocks movement into a wall', () => {
    // up-left from center lands on the (0,0) corner wall → blocked
    const next = update(makeState(), [{ type: 'move', dx: -1, dy: -1 }]);
    expect(next.player.pos).toEqual({ x: 1, y: 1 });
  });

  it('increments the tick every call', () => {
    expect(update(makeState(), []).tick).toBe(1);
  });

  it('is pure — does not mutate the input state', () => {
    const before = makeState();
    update(before, [{ type: 'move', dx: 1, dy: 0 }]);
    expect(before.player.pos).toEqual({ x: 1, y: 1 });
    expect(before.tick).toBe(0);
  });

  it('advances at most one tile for a batch of same-direction intents', () => {
    // Holding "right" auto-repeats into [right, right]; the player may only
    // advance a single tile per tick, not jump two.
    const next = update(makeState(), [
      { type: 'move', dx: 1, dy: 0 },
      { type: 'move', dx: 1, dy: 0 },
    ]);
    expect(next.player.pos).toEqual({ x: 2, y: 1 });
  });

  it('applies only the valid step when a blocked intent precedes a valid one', () => {
    // up-left lands on the (0,0) corner wall (blocked); the later valid "right"
    // is the one that takes effect — and only by one tile.
    const next = update(makeState(), [
      { type: 'move', dx: -1, dy: -1 },
      { type: 'move', dx: 1, dy: 0 },
    ]);
    expect(next.player.pos).toEqual({ x: 2, y: 1 });
  });

  it('increments the tick by exactly 1 regardless of intent count', () => {
    expect(update(makeState(), []).tick).toBe(1);
    expect(
      update(makeState(), [
        { type: 'move', dx: 1, dy: 0 },
        { type: 'move', dx: 0, dy: 1 },
        { type: 'move', dx: -1, dy: 0 },
      ]).tick,
    ).toBe(1);
  });

  // --- TQ-009: kill → XP hook ------------------------------------------------

  const dead = (kind: Parameters<typeof createEnemy>[0]): Enemy => ({
    ...createEnemy(kind, { x: 1, y: 1 }),
    hp: 0,
  });

  it('removes a slain enemy (hp ≤ 0) and awards its XP to the player', () => {
    const live = createEnemy('runner', { x: 1, y: 1 });
    const state: GameState = {
      ...makeState(),
      player: { pos: { x: 1, y: 1 }, progress: createProgression() },
      enemies: [dead('grunt'), live],
    };

    const next = update(state, []);

    expect(next.enemies).toEqual([live]);
    expect(next.player.progress?.level).toBe(1);
    expect(next.player.progress?.xp).toBe(xpForKill({ maxHp: 10, atk: 2 }));
  });

  it('levels the player up when a kill crosses the XP threshold', () => {
    const brute = dead('brute');
    // Decouple from brute's concrete stats: assert the kill is worth at least
    // one level but fewer than two, so a rebalance can't silently invalidate the
    // level-2 expectation (it would trip these preconditions instead).
    const reward = xpForKill(brute);
    expect(reward).toBeGreaterThanOrEqual(xpToNext(1));
    expect(reward).toBeLessThan(xpToNext(1) + xpToNext(2));

    const state: GameState = {
      ...makeState(),
      player: { pos: { x: 1, y: 1 }, progress: createProgression() },
      enemies: [brute],
    };

    const next = update(state, []);

    expect(next.enemies).toEqual([]);
    expect(next.player.progress?.level).toBe(2);
  });

  it('defaults a fresh progression for a player that had none', () => {
    const state: GameState = { ...makeState(), enemies: [dead('grunt')] };

    const next = update(state, []);

    expect(next.player.progress?.level).toBe(1);
    expect(next.player.progress?.xp).toBe(xpForKill({ maxHp: 10, atk: 2 }));
  });

  it('keeps a non-finite-hp enemy in the world (partition is exhaustive)', () => {
    const cursed: Enemy = { ...createEnemy('grunt', { x: 1, y: 1 }), hp: NaN };
    const state: GameState = {
      ...makeState(),
      player: { pos: { x: 1, y: 1 }, progress: createProgression() },
      enemies: [dead('grunt'), cursed],
    };

    const next = update(state, []);

    // The genuinely dead grunt is removed; the NaN-hp enemy neither dies nor
    // vanishes — it stays put rather than falling through both predicates.
    expect(next.enemies).toEqual([cursed]);
  });

  it('leaves a movement-only state (no enemies) untouched by the hook', () => {
    const next = update(makeState(), []);
    expect(next.enemies).toBeUndefined();
    expect(next.player.progress).toBeUndefined();
  });

  it('is pure — does not mutate the input enemies or player', () => {
    const slain = dead('grunt');
    const progress = createProgression();
    const state: GameState = {
      ...makeState(),
      player: { pos: { x: 1, y: 1 }, progress },
      enemies: [slain],
    };

    update(state, []);

    expect(state.enemies).toEqual([slain]);
    expect(state.player.progress).toEqual(progress);
  });
});
