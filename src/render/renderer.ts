import terminalKit from 'terminal-kit';
import { type GameState, tileAt } from '../game/state.js';
import { computeCamera } from '../game/world/camera.js';
import { glyphForTile, PLAYER_GLYPH, PLAYER_COLOR } from './sprites.js';

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
          { x: sx, y: sy, attr: { color: g.color }, wrap: false, dx: 1, dy: 0 },
          g.char,
        );
      }
    }

    this.screen.put(
      {
        x: state.player.pos.x - cam.x,
        y: state.player.pos.y - cam.y,
        attr: { color: PLAYER_COLOR, bold: true },
        wrap: false,
        dx: 1,
        dy: 0,
      },
      PLAYER_GLYPH,
    );

    process.stdout.write(SYNC_ON);
    this.screen.draw({ delta: true });
    process.stdout.write(SYNC_OFF);
  }
}
