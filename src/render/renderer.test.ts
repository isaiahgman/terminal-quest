import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlayer, type GameState, type Tile } from '../game/state.js';
import { createEnemy } from '../game/enemy.js';
import { createEnemyAi } from '../game/entities.js';

/** A single put() call flattened to the fields the renderer actually sets. */
interface PutCall {
  x: number;
  y: number;
  char: string;
  color: string | undefined;
  bold: boolean;
  bgColor: string | undefined;
}

/** The terminal-kit put() options shape, narrowed to the fields we read. */
interface PutOpts {
  x: number;
  y: number;
  attr?: { color?: string; bold?: boolean; bgColor?: string };
}

/**
 * Fake ScreenBuffer standing in for terminal-kit's, exposing only the surface
 * the renderer touches: width/height, put, and draw. put() records each call so
 * tests can assert exactly what the renderer drew — glyph, colours, position,
 * and draw order — without a real terminal.
 */
class FakeScreenBuffer {
  readonly width: number;
  readonly height: number;
  readonly puts: PutCall[] = [];
  constructor(opts: { width: number; height: number }) {
    this.width = opts.width;
    this.height = opts.height;
  }
  put(opts: PutOpts, char: string): void {
    this.puts.push({
      x: opts.x,
      y: opts.y,
      char,
      color: opts.attr?.color,
      bold: opts.attr?.bold ?? false,
      bgColor: opts.attr?.bgColor,
    });
  }
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
    player: createPlayer({ x: 1, y: 1 }),
    // An enemy on the floor so render() exercises the enemy-draw path too.
    enemies: [
      { enemy: createEnemy('grunt', { x: 1, y: 0 }), ai: createEnemyAi() },
    ],
    tooTired: false,
    tick: 0,
  };
}

/**
 * A world larger than the 8x4 viewport with the player mid-world, so the camera
 * clamps to neither edge and the offset is non-zero (the case `makeState`'s 3x3
 * world can't reach). Tile (col, row) is a wall iff col === row, else floor — a
 * diagonal that makes a swapped char/color or an off-by-one camera offset
 * observable in the recorded puts. An enemy sits one cell from the player.
 */
function makeBigState(): GameState {
  const size = 20;
  const tiles: Tile[][] = [];
  for (let y = 0; y < size; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < size; x++) {
      row.push(x === y ? 'wall' : 'floor');
    }
    tiles.push(row);
  }
  return {
    world: { width: size, height: size, tiles, seed: 0 },
    player: createPlayer({ x: 10, y: 10 }),
    enemies: [
      { enemy: createEnemy('grunt', { x: 12, y: 9 }), ai: createEnemyAi() },
    ],
    tooTired: false,
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

/** The recording ScreenBuffer the Renderer constructed for itself. */
function recordedPuts(renderer: object): PutCall[] {
  return (renderer as { screen: FakeScreenBuffer }).screen.puts;
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

  it('draws each viewport cell with the tile glyph/colour at the camera offset', async () => {
    const { Renderer } = await import('./renderer.js');
    const { glyphForTile, cellAttr } = await import('./sprites.js');
    const { computeCamera } = await import('../game/world/camera.js');

    const state = makeBigState();
    const renderer = new Renderer();
    renderer.render(state);

    // The camera clamps to neither edge here, so the offset is non-zero —
    // proving the viewport actually pans into a larger world.
    const cam = computeCamera(state.player.pos, 8, 4, 20, 20);
    expect([cam.x, cam.y]).toEqual([6, 8]);

    // The first 8*4 puts are the tile pass, row-major over the viewport. Each
    // must carry the glyph + colour of the world tile under the camera. A
    // swapped char/colour, or an off-by-one in the camera offset, mismatches.
    const tilePuts = recordedPuts(renderer).slice(0, 8 * 4);
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 8; sx++) {
        const worldX = cam.x + sx;
        const worldY = cam.y + sy;
        const tile: Tile = worldX === worldY ? 'wall' : 'floor';
        const g = glyphForTile(tile);
        const attr = cellAttr(g, false);
        expect(tilePuts[sy * 8 + sx]).toEqual({
          x: sx,
          y: sy,
          char: g.char,
          color: attr.color,
          bold: false,
          bgColor: attr.bgColor,
        });
      }
    }

    // Concrete (not just self-consistent) mapping: wall vs floor differ in glyph
    // and colour, so a glyph/colour swap between them is caught.
    expect(glyphForTile('wall').char).toBe('▓');
    expect(glyphForTile('wall').color).toBe('white');
    expect(glyphForTile('floor').char).toBe('·');
    expect(glyphForTile('floor').color).toBe('gray');
  });

  it('overdraws the player (and enemies) on top of their tiles', async () => {
    const { Renderer } = await import('./renderer.js');
    const { PLAYER_GLYPH, cellAttr } = await import('./sprites.js');
    const { computeCamera } = await import('../game/world/camera.js');

    const state = makeBigState();
    const renderer = new Renderer();
    renderer.render(state);

    const puts = recordedPuts(renderer);
    const cam = computeCamera(state.player.pos, 8, 4, 20, 20);

    const playerScreenX = state.player.pos.x - cam.x;
    const playerScreenY = state.player.pos.y - cam.y;
    const playerAttr = cellAttr(PLAYER_GLYPH, true);

    // The player is drawn last, so it sits on top of the tile already drawn at
    // its cell — the overdraw the renderer relies on.
    expect(puts[puts.length - 1]).toEqual({
      x: playerScreenX,
      y: playerScreenY,
      char: PLAYER_GLYPH.char,
      color: playerAttr.color,
      bold: true,
      bgColor: playerAttr.bgColor,
    });

    // Two puts land on the player's cell: the tile pass underneath, then the
    // player on top. Confirms it overdraws rather than replacing the tile draw.
    const atPlayerCell = puts.filter(
      (p) => p.x === playerScreenX && p.y === playerScreenY,
    );
    expect(atPlayerCell).toHaveLength(2);
    expect(atPlayerCell[0]!.char).not.toBe(PLAYER_GLYPH.char);
    expect(atPlayerCell[1]!.char).toBe(PLAYER_GLYPH.char);

    // The enemy is drawn after the tiles and before the player, with its own
    // data-driven glyph/colour, at its camera-relative cell.
    const enemy = state.enemies![0]!.enemy;
    const enemyScreenX = enemy.pos.x - cam.x;
    const enemyScreenY = enemy.pos.y - cam.y;
    const enemyAttr = cellAttr(
      { char: enemy.glyph, color: enemy.color },
      false,
    );
    const atEnemyCell = puts.filter(
      (p) => p.x === enemyScreenX && p.y === enemyScreenY,
    );
    expect(atEnemyCell).toHaveLength(2);
    expect(atEnemyCell[1]).toEqual({
      x: enemyScreenX,
      y: enemyScreenY,
      char: enemy.glyph,
      color: enemyAttr.color,
      bold: false,
      bgColor: enemyAttr.bgColor,
    });
  });
});
