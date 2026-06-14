import { describe, it, expect } from 'vitest';
import { update } from './update.js';
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
});
