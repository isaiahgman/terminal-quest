import terminalKit from 'terminal-kit';
import { type GameState, tileAt } from '../game/state.js';
import { computeCamera } from '../game/world/camera.js';
import { cellAttr, glyphForTile, PLAYER_GLYPH } from './sprites.js';

type Term = typeof terminalKit.terminal;

/** DEC private mode 2026 — synchronized output, so a frame composites atomically. */
const SYNC_ON = '\x1b[?2026h';
const SYNC_OFF = '\x1b[?2026l';

/**
 * Read-only renderer: draws a GameState into one full-screen ScreenBuffer and
 * flushes the delta. Never mutates state. Draws only the camera viewport, so
 * cost is proportional to the screen, not the (much larger) world.
 */
export class Renderer {
  private readonly screen: terminalKit.ScreenBuffer;

  constructor(term: Term = terminalKit.terminal) {
    this.screen = new terminalKit.ScreenBuffer({
      dst: term,
      width: term.width,
      height: term.height,
      noFill: true,
    });
  }

  render(state: GameState): void {
    const { width, height } = this.screen;
    const cam = computeCamera(
      state.player.pos,
      width,
      height,
      state.world.width,
      state.world.height,
    );

    for (let sy = 0; sy < height; sy++) {
      for (let sx = 0; sx < width; sx++) {
        const g = glyphForTile(tileAt(state.world, cam.x + sx, cam.y + sy));
        this.screen.put(
          { x: sx, y: sy, attr: cellAttr(g, false), wrap: false, dx: 1, dy: 0 },
          g.char,
        );
      }
    }

    // Enemies, drawn before the player so the player glyph stays on top when an
    // enemy shares its cell. Each carries its own glyph/color (see `enemy.ts`),
    // so the renderer stays data-driven — no per-kind switch here. Skip any that
    // fall outside the viewport.
    for (const { enemy } of state.enemies ?? []) {
      const ex = enemy.pos.x - cam.x;
      const ey = enemy.pos.y - cam.y;
      if (ex < 0 || ey < 0 || ex >= width || ey >= height) continue;
      this.screen.put(
        {
          x: ex,
          y: ey,
          attr: cellAttr({ char: enemy.glyph, color: enemy.color }, false),
          wrap: false,
          dx: 1,
          dy: 0,
        },
        enemy.glyph,
      );
    }

    this.screen.put(
      {
        x: state.player.pos.x - cam.x,
        y: state.player.pos.y - cam.y,
        attr: cellAttr(PLAYER_GLYPH, true),
        wrap: false,
        dx: 1,
        dy: 0,
      },
      PLAYER_GLYPH.char,
    );

    process.stdout.write(SYNC_ON);
    this.screen.draw({ delta: true });
    process.stdout.write(SYNC_OFF);
  }
}
