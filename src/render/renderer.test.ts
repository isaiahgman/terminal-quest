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

// Deterministic clock for multi-render tests: the renderer ages its fx pool
// by real performance.now() gaps, which would make two-render tests
// wall-clock-dependent without this.
let nowMs = 0;
vi.mock('node:perf_hooks', () => ({
  performance: { now: () => nowMs },
}));

vi.mock('terminal-kit', () => ({
  default: {
    // Tall enough that the world viewport survives the reserved HUD band
    // (HUD_ROWS) and still pans inside a larger world.
    terminal: { width: 8, height: 8 },
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

  it('draws the defeat banner when the run is lost (TQ-020)', async () => {
    const { Renderer } = await import('./renderer.js');
    const renderer = new Renderer();
    renderer.render({ ...makeState(), status: 'defeat' });
    const drew = recordedPuts(renderer).map((p) => p.char);
    expect(drew.some((t) => t.includes('YOU DIED'))).toBe(true);
  });

  it('draws the victory banner when the run is won (TQ-020/TQ-011)', async () => {
    const { Renderer } = await import('./renderer.js');
    const renderer = new Renderer();
    renderer.render({ ...makeState(), status: 'victory' });
    const drew = recordedPuts(renderer).map((p) => p.char);
    expect(drew.some((t) => t.includes('VICTORY'))).toBe(true);
  });

  it('draws no end banner while the run is in progress', async () => {
    const { Renderer } = await import('./renderer.js');
    const renderer = new Renderer();
    renderer.render(makeState()); // status undefined ⇒ playing
    const drew = recordedPuts(renderer).map((p) => p.char);
    expect(
      drew.some((t) => t.includes('YOU DIED') || t.includes('VICTORY')),
    ).toBe(false);
  });

  it('draws each viewport cell with the tile glyph/colour at the camera offset', async () => {
    const { Renderer } = await import('./renderer.js');
    const { glyphForTile, cellAttr } = await import('./sprites.js');
    const { computeCamera } = await import('../game/world/camera.js');
    const { HUD_ROWS } = await import('./hud.js');

    const state = makeBigState();
    const renderer = new Renderer();
    renderer.render(state);

    // The world viewport is the screen height minus the reserved HUD band.
    const playH = 8 - HUD_ROWS;

    // The camera clamps to neither edge here, so the offset is non-zero —
    // proving the viewport actually pans into a larger world.
    const cam = computeCamera(state.player.pos, 8, playH, 20, 20);
    expect([cam.x, cam.y]).toEqual([6, 8]);

    // The first 8*playH puts are the tile pass, row-major over the viewport.
    // Each must carry the glyph + colour of the world tile under the camera. A
    // swapped char/colour, or an off-by-one in the camera offset, mismatches.
    const tilePuts = recordedPuts(renderer).slice(0, 8 * playH);
    for (let sy = 0; sy < playH; sy++) {
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

  it('overdraws the player (and enemies) on their tiles, with the HUD below', async () => {
    const { Renderer } = await import('./renderer.js');
    const { PLAYER_GLYPH, cellAttr } = await import('./sprites.js');
    const { computeCamera } = await import('../game/world/camera.js');
    const { HUD_ROWS } = await import('./hud.js');

    const state = makeBigState();
    const renderer = new Renderer();
    renderer.render(state);

    const puts = recordedPuts(renderer);
    const playH = 8 - HUD_ROWS;
    const cam = computeCamera(state.player.pos, 8, playH, 20, 20);

    // The world (tiles, enemies, player) draws strictly above the HUD band, and
    // the HUD strictly within it — the two regions never overlap (acceptance:
    // "overlays without corrupting the world viewport").
    const worldPuts = puts.filter((p) => p.y < playH);
    const hudPuts = puts.filter((p) => p.y >= playH);
    expect(hudPuts.length).toBeGreaterThan(0);
    expect(hudPuts.every((p) => p.y < 8)).toBe(true);

    const playerScreenX = state.player.pos.x - cam.x;
    const playerScreenY = state.player.pos.y - cam.y;
    const playerAttr = cellAttr(PLAYER_GLYPH, true);

    // The player is the last world draw, so it sits on top of the tile already
    // drawn at its cell — the overdraw the renderer relies on. (HUD puts follow,
    // but they live in the reserved band, never over the player.)
    expect(worldPuts[worldPuts.length - 1]).toEqual({
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

    // The HUD band begins at row `playH` with the health label — confirming the
    // renderer composes the HUD into the reserved region.
    const hudTop = hudPuts.filter((p) => p.y === playH);
    expect(hudTop[0]).toMatchObject({ x: 0, y: playH, char: 'HP ' });
  });

  it('suppresses the world (and culls the player) when the terminal is too short', async () => {
    const { Renderer } = await import('./renderer.js');
    const { PLAYER_GLYPH, glyphForTile } = await import('./sprites.js');

    // A terminal shorter than the reserved HUD band: playH = max(0, 2 - 3) = 0.
    // The deliberate clamp must hold — no world cells, no player, no crash.
    const shortTerm = {
      width: 8,
      height: 2,
    } as unknown as ConstructorParameters<typeof Renderer>[0];
    const renderer = new Renderer(shortTerm);

    expect(() => {
      renderer.render(makeBigState());
    }).not.toThrow();

    const chars = new Set(recordedPuts(renderer).map((p) => p.char));
    // No tile glyphs and no player — the world pass never ran and the player was
    // culled against playH (terminal-kit clips the HUD's overflowing rows).
    expect(chars.has(glyphForTile('wall').char)).toBe(false);
    expect(chars.has(glyphForTile('floor').char)).toBe(false);
    expect(chars.has(PLAYER_GLYPH.char)).toBe(false);
    // The HUD still drew (its rows are clipped by the buffer, not skipped).
    expect(recordedPuts(renderer).length).toBeGreaterThan(0);
  });

  it('draws a floating damage number at a hit event location (TQ-015)', async () => {
    const { Renderer } = await import('./renderer.js');
    const { DAMAGE_NUMBER_COLOR } = await import('./sprites.js');
    const { HUD_ROWS } = await import('./hud.js');

    // Player at (1,1) in the 3x3 world (viewport == world, no camera offset). A
    // hit landed on the enemy at (1,0) for 7 damage — not "big", so no shake.
    const state: GameState = {
      ...makeState(),
      hitEvents: [{ pos: { x: 1, y: 0 }, amount: 7, big: false }],
    };
    const renderer = new Renderer();
    renderer.render(state);

    // The damage number's digits draw in the damage colour, in the world region
    // above the HUD band (the HUD's HP bar shares the colour but lives below
    // `playH`). With riseOffset 0 at spawn the number sits on the hit cell (1,0).
    const playH = 8 - HUD_ROWS;
    const numberPuts = recordedPuts(renderer).filter(
      (p) => p.color === DAMAGE_NUMBER_COLOR && p.y < playH,
    );
    expect(numberPuts.map((p) => p.char).join('')).toBe('7');
    expect(numberPuts[0]).toMatchObject({ x: 1, y: 0, char: '7' });
  });

  it('requests a screen shake on a big hit, offsetting the world viewport (TQ-015)', async () => {
    const { Renderer } = await import('./renderer.js');
    const { PLAYER_GLYPH } = await import('./sprites.js');
    const { computeCamera } = await import('../game/world/camera.js');
    const { HUD_ROWS } = await import('./hud.js');

    const state: GameState = {
      ...makeBigState(),
      enemies: [],
      // amount 4 ⇒ shake magnitude 1.2 ⇒ a rounded 1-cell kick at spawn.
      hitEvents: [{ pos: { x: 12, y: 9 }, amount: 4, big: true }],
    };
    const renderer = new Renderer();
    renderer.render(state);

    const puts = recordedPuts(renderer);
    const playH = 8 - HUD_ROWS;
    const cam = computeCamera(state.player.pos, 8, playH, 20, 20);

    // With a big hit the freshest shake offset is a non-zero 1-cell kick, so the
    // player draws shifted off its un-shaken screen cell. (The fx overlay draws
    // after the player now, so find the player glyph by char in the world band.)
    const worldPuts = puts.filter((p) => p.y < playH);
    const playerPut = worldPuts.filter((p) => p.char === PLAYER_GLYPH.char)[0]!;
    expect(playerPut).toBeDefined();
    const unshakenX = state.player.pos.x - cam.x;
    const unshakenY = state.player.pos.y - cam.y;
    const shifted = playerPut.x !== unshakenX || playerPut.y !== unshakenY;
    expect(shifted).toBe(true);
    // The kick is small — at most one cell on each axis.
    expect(Math.abs(playerPut.x - unshakenX)).toBeLessThanOrEqual(1);
    expect(Math.abs(playerPut.y - unshakenY)).toBeLessThanOrEqual(1);
  });

  it('draws no hit-feedback glyphs when there are no hit events (TQ-015)', async () => {
    const { Renderer } = await import('./renderer.js');
    const { DAMAGE_NUMBER_COLOR, HIT_FLASH_COLOR } =
      await import('./sprites.js');

    const { HUD_ROWS } = await import('./hud.js');
    const renderer = new Renderer();
    renderer.render(makeBigState()); // no hitEvents field

    // No fx glyphs in the world region. (The HUD below `playH` reuses the same
    // bright colours for its bars, so scope to the world viewport.)
    const playH = 8 - HUD_ROWS;
    const fxPuts = recordedPuts(renderer).filter(
      (p) =>
        p.y < playH &&
        (p.color === DAMAGE_NUMBER_COLOR || p.color === HIT_FLASH_COLOR),
    );
    expect(fxPuts).toHaveLength(0);
  });

  it('draws a weapon pickup on its tile, after the tile pass and below the player (TQ-010)', async () => {
    const { Renderer } = await import('./renderer.js');
    const { PICKUP_GLYPH, PLAYER_GLYPH, cellAttr } =
      await import('./sprites.js');

    // Pickup on the open floor at (2,1) in the 3x3 world; player at (1,1).
    const state: GameState = {
      ...makeState(),
      enemies: [],
      pickups: [{ pos: { x: 2, y: 1 }, weaponId: 'iron-sword' }],
    };
    const renderer = new Renderer();
    renderer.render(state);

    const puts = recordedPuts(renderer);
    // The 3x3 world fits the viewport with no camera offset, so world == screen.
    const atPickup = puts.filter((p) => p.x === 2 && p.y === 1);
    // Tile underneath, then the pickup glyph on top — overdraw, not replace.
    expect(atPickup).toHaveLength(2);
    const pickupAttr = cellAttr(PICKUP_GLYPH, true);
    expect(atPickup[1]).toEqual({
      x: 2,
      y: 1,
      char: PICKUP_GLYPH.char,
      color: pickupAttr.color,
      bold: true,
      bgColor: pickupAttr.bgColor,
    });
    // The pickup is not the player glyph, and the player still draws last overall.
    expect(PICKUP_GLYPH.char).not.toBe(PLAYER_GLYPH.char);
  });

  it('draws home ground in the base palette with the hearth at its center (TQ-013)', async () => {
    const { Renderer } = await import('./renderer.js');
    const { BASE_FLOOR_GLYPH, BASE_HEART_GLYPH, cellAttr } =
      await import('./sprites.js');

    // Base centered on the player's tile in the 3x3 plus world (radius 2 covers
    // the whole viewport-visible world, so every floor tile is home ground).
    const state: GameState = {
      ...makeState(),
      enemies: [],
      base: {
        pos: { x: 1, y: 1 },
        growth: { tier: 1, bossesDefeated: 0 },
      },
    };
    const renderer = new Renderer();
    renderer.render(state);

    const puts = recordedPuts(renderer);
    // The open floor at (2,1) draws in the base-floor palette (world == screen
    // here: the 3x3 world fits the viewport with no camera offset).
    const floorPut = puts.find((f) => f.x === 2 && f.y === 1);
    expect(floorPut?.char).toBe(BASE_FLOOR_GLYPH.char);
    expect(floorPut?.color).toBe(BASE_FLOOR_GLYPH.color);

    // The hearth draws over the base's center tile (under the player, who puts
    // later); walls keep their identity (no base tint on (0,0)).
    const heartAttr = cellAttr(BASE_HEART_GLYPH, true);
    const atCenter = puts.filter((f) => f.x === 1 && f.y === 1);
    expect(
      atCenter.some(
        (f) => f.char === BASE_HEART_GLYPH.char && f.color === heartAttr.color,
      ),
    ).toBe(true);
    const wallPut = puts.find((f) => f.x === 0 && f.y === 0);
    expect(wallPut?.char).not.toBe(BASE_FLOOR_GLYPH.char);
  });

  it('draws entrance down-stairs on the surface and the exit inside a dungeon (TQ-014)', async () => {
    const { Renderer } = await import('./renderer.js');
    const { ENTRANCE_GLYPH, EXIT_GLYPH } = await import('./sprites.js');

    // Surface: an entrance on the open floor at (2,1).
    const surface: GameState = {
      ...makeState(),
      enemies: [],
      entrances: [{ x: 2, y: 1 }],
    };
    const surfaceRenderer = new Renderer();
    surfaceRenderer.render(surface);
    const surfacePuts = recordedPuts(surfaceRenderer);
    expect(
      surfacePuts.some(
        (p) => p.x === 2 && p.y === 1 && p.char === ENTRANCE_GLYPH.char,
      ),
    ).toBe(true);

    // Below: the exit tile shows the way back up; no entrances drawn.
    const below: GameState = {
      ...makeState(),
      enemies: [],
      dungeon: {
        returnPos: { x: 9, y: 9 },
        exitPos: { x: 2, y: 1 },
        overworld: { world: makeState().world },
      },
    };
    const belowRenderer = new Renderer();
    belowRenderer.render(below);
    const belowPuts = recordedPuts(belowRenderer);
    expect(
      belowPuts.some(
        (p) => p.x === 2 && p.y === 1 && p.char === EXIT_GLYPH.char,
      ),
    ).toBe(true);
  });

  it('flushes live fx when the world is swapped (dungeon transition)', async () => {
    const { Renderer } = await import('./renderer.js');

    const surface: GameState = {
      ...makeState(),
      enemies: [],
      hitEvents: [{ pos: { x: 2, y: 1 }, amount: 5, big: false }],
    };
    const renderer = new Renderer();
    nowMs = 0;
    renderer.render(surface); // spawns a flash + damage number at (2,1)

    // Swap to a different World object (as a dungeon transition does), one
    // frame later — well inside the fx lifetimes.
    const below: GameState = {
      ...makeState(),
      world: { ...surface.world }, // new reference = new world
      enemies: [],
      hitEvents: [],
    };
    recordedPuts(renderer).length = 0;
    nowMs = 66;
    renderer.render(below);

    const puts = recordedPuts(renderer);
    // No phantom '*' flash and no stray '5' from the old world's coordinates.
    expect(puts.some((p) => p.char === '*')).toBe(false);
    expect(puts.some((p) => p.char === '5')).toBe(false);
  });

  it('composites the final (terminal-status) frame clean — no frozen fx/shake', async () => {
    const { Renderer } = await import('./renderer.js');

    // A big hit on the SAME frame the run ends: without the quiesce, the last
    // frame ever drawn would freeze mid-shake with a stuck flash under the
    // banner.
    const ending: GameState = {
      ...makeState(),
      enemies: [],
      status: 'defeat',
      hitEvents: [{ pos: { x: 2, y: 1 }, amount: 99, big: true }],
    };
    const renderer = new Renderer();
    nowMs = 0;
    renderer.render(ending);

    const puts = recordedPuts(renderer);
    expect(puts.some((p) => p.char === '*')).toBe(false);
    // The banner still draws (YOU DIED is present).
    const text = puts.map((p) => p.char).join('');
    expect(text).toContain('YOU DIED'.replace(/ /g, ' '));
    // Unshaken world: the wall at world (0,0) draws at screen (0,0).
    const origin = puts.find((p) => p.x === 0 && p.y === 0);
    expect(origin?.char).toBe('▓');
  });
});
