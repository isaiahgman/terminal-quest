import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GameState, Tile } from '../game/state.js';

/**
 * Fake ScreenBuffer standing in for terminal-kit's, exposing only the surface
 * the renderer touches: width/height, put, and draw. Capturing nothing — the
 * point is to let render() run without a real terminal so we can assert it
 * never mutates the GameState it reads.
 */
class FakeScreenBuffer {
  readonly width: number;
  readonly height: number;
  constructor(opts: { width: number; height: number }) {
    this.width = opts.width;
    this.height = opts.height;
  }
  put(): void {}
  draw(): void {}
}

vi.mock('terminal-kit', () => ({
  default: {
    terminal: { width: 8, height: 4 },
    ScreenBuffer: FakeScreenBuffer,
  },
}));

function makeState(): GameState {
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

/** Recursively freeze an object graph so any write attempt throws. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('Renderer', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never mutates the GameState it renders', async () => {
    const { Renderer } = await import('./renderer.js');

    const state = makeState();
    const snapshot = structuredClone(state);
    deepFreeze(state);

    const renderer = new Renderer();

    expect(() => {
      renderer.render(state);
    }).not.toThrow();

    expect(state).toEqual(snapshot);
  });
});
